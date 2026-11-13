/* eslint-env node */
import { readFileSync } from 'node:fs';

const SPEC = JSON.parse(readFileSync(new URL('../fixtures/aem-admin-api-spec.json', import.meta.url), 'utf8'));
const BASE = new URL(SPEC.servers[0].url).origin;
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head'];

// `{path}` spans segments (e.g. /live/a/b.html); every other param is one segment.
function compile(template) {
  const names = [];
  const source = template.replace(/\{(\w+)\}|[^{]+/g, (part, name) => {
    if (!name) return part.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    names.push(name);
    return name === 'path' ? '(.+)' : '([^/]+)';
  });
  return { names, regex: new RegExp(`^${source}$`) };
}

const ROUTES = Object.entries(SPEC.paths).map(([template, ops]) => ({
  template,
  ...compile(template),
  literalLength: template.replace(/\{\w+\}/g, '').length,
  ops: Object.fromEntries(METHODS.filter((m) => ops[m]).map((m) => [m, ops[m]])),
}));

function matchRoute(pathname) {
  return ROUTES
    .map((route) => ({ route, match: route.regex.exec(pathname) }))
    .filter(({ match }) => match)
    .sort((a, b) => b.route.literalLength - a.route.literalLength)[0];
}

function toResponse(result) {
  if (result instanceof Response) return result;
  const { status = 200, body = null, headers = {} } = result;
  const isJson = body !== null && typeof body === 'object';
  return new Response(isJson ? JSON.stringify(body) : body, {
    status,
    headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...headers },
  });
}

function readBody(init) {
  if (init.body === undefined || init.body === null) return undefined;
  const text = typeof init.body === 'string' ? init.body : String(init.body);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * In-process fake of the Helix 6 admin API (https://api.aem.live), routed by the
 * OpenAPI spec in tests/fixtures/aem-admin-api-spec.json.
 *
 * - Unmatched path -> 404, wrong method -> 405; both are recorded in `violations`.
 * - Every response is declared per test with `respond()`. A routed operation with no declared
 *   response returns 501 and is recorded in `violations`; nothing is generated from the spec.
 * - Request and response bodies are NOT schema-validated.
 *
 * @example
 * const api = createMockAemApi();
 * beforeEach(() => api.install());
 * afterEach(() => api.uninstall());
 * api.respond('getJob', { status: 202, body: { state: 'stopped' } });
 * // ... exercise code ...
 * assert.deepEqual(api.violations, []);
 */
export default function createMockAemApi() {
  const realFetch = global.fetch;
  const responses = new Map();
  const counts = new Map();
  const state = { calls: [], violations: [] };

  async function handle(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toLowerCase();
    const call = {
      method: method.toUpperCase(),
      url: url.href,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init.headers)),
      body: readBody(init),
    };
    state.calls.push(call);

    const found = matchRoute(url.pathname);
    if (!found) {
      state.violations.push({ ...call, reason: 'path not in spec' });
      return toResponse({ status: 404, headers: { 'x-error': 'mock: path not in spec' } });
    }
    const operation = found.route.ops[method];
    if (!operation) {
      state.violations.push({
        ...call,
        reason: `${call.method} not allowed for ${found.route.template}`,
      });
      return toResponse({ status: 405, headers: { 'x-error': 'mock: method not in spec' } });
    }

    call.operationId = operation.operationId;
    call.template = found.route.template;
    call.pathParams = Object.fromEntries(
      found.route.names.map((name, i) => [name, found.match[i + 1]]),
    );

    const declared = responses.get(operation.operationId);
    if (declared === undefined) {
      state.violations.push({ ...call, reason: `no response declared for ${call.operationId}` });
      return toResponse({ status: 501, headers: { 'x-error': 'mock: no response declared' } });
    }
    if (!Array.isArray(declared)) return toResponse(declared);
    const index = counts.get(call.operationId) || 0;
    counts.set(call.operationId, index + 1);
    return toResponse(declared[Math.min(index, declared.length - 1)]);
  }

  return {
    get calls() { return state.calls; },
    get violations() { return state.violations; },
    /**
     * @param {string} operationId
     * @param {object|object[]} response `{status, body, headers}`, or a list of them returned
     *   one per call in order (the last one repeats)
     */
    respond(operationId, response) {
      responses.set(operationId, response);
      counts.delete(operationId);
    },
    reset() {
      responses.clear();
      counts.clear();
      state.calls = [];
      state.violations = [];
    },
    install() {
      global.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input.url;
        if (new URL(href).origin !== BASE) {
          throw new Error(`mock-aem-api: unexpected request to ${href}`);
        }
        return handle(input, init);
      };
    },
    uninstall() { global.fetch = realFetch; },
  };
}
