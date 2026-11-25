/* eslint-env node */
import { readFileSync } from 'node:fs';
import Ajv2019 from 'ajv/dist/2019.js';

const SPEC = JSON.parse(readFileSync(new URL('../fixtures/aem-admin-api-spec.json', import.meta.url), 'utf8'));
const BASE = new URL(SPEC.servers[0].url).origin;
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head'];

// The spec's schemas carry their own $id/$schema, which would re-base the
// `#/components/schemas/...` refs between them; drop those so refs resolve against our root.
function withoutIds(node) {
  if (Array.isArray(node)) return node.map(withoutIds);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node)
    .filter(([key]) => !['$id', '$schema', '$comment'].includes(key))
    .map(([key, value]) => [key, withoutIds(value)]));
}

const SCHEMAS = withoutIds(SPEC.components.schemas);
// Formats are not checked; the spec's structure (types, required keys, enums, patterns) is.
const ajv = new Ajv2019({ strict: false, validateFormats: false, allErrors: true });
const validators = new Map();

// Config routes whose `{path}` addresses a property of the named parent config schema.
const CONFIG_SUB_ROUTES = {
  '/{org}/config/{path}': 'org',
  '/{org}/sites/{site}/config/{path}': 'site',
  '/{org}/profiles/{profile}/config/{path}': 'profile',
};
const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];

function deref(node) {
  let current = node;
  while (current?.$ref) current = SCHEMAS[current.$ref.split('/').pop()];
  return current;
}

function childSchema(node, key) {
  const parent = deref(node);
  if (parent?.properties?.[key]) return parent.properties[key];
  return Object.entries(parent?.patternProperties || {})
    .find(([pattern]) => new RegExp(pattern).test(key))?.[1];
}

function validatorFor(parent, segments, node) {
  const key = `${parent}:${segments.join('/')}`;
  if (!validators.has(key)) {
    validators.set(key, ajv.compile({ ...node, components: { schemas: SCHEMAS } }));
  }
  return validators.get(key);
}

// SPEC GAP: the spec only describes the stored `users` array, where `id` is required.
// H6 accepts a single new user without an id and assigns it server-side.
function newUserValidator() {
  if (!validators.has('new-user')) {
    const { required, ...user } = SCHEMAS.user;
    validators.set('new-user', ajv.compile({
      ...user,
      required: required.filter((key) => key !== 'id'),
      components: { schemas: SCHEMAS },
    }));
  }
  return validators.get('new-user');
}

// The suffix (`.json`, `.txt`) is stripped as the H5 client does; the spec does not say
// whether H6 accepts it.
function configSegments(path) {
  return path.split('/').filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .map((segment, i, all) => (i === all.length - 1 ? segment.replace(/\.[^./]+$/, '') : segment));
}

function checkConfigPath(template, path, method, body) {
  const parent = CONFIG_SUB_ROUTES[template];
  if (!parent) return null;
  const segments = configSegments(path);
  const label = segments.join('/');
  if (!childSchema(SCHEMAS[parent], segments[0])) {
    return { status: 404, reason: `config path "${segments[0]}" is not a property of the ${parent} config` };
  }
  // SPEC GAP: H6 addresses a single org user as `users/{id}`; the spec has no such path.
  const isUserById = parent === 'org' && segments[0] === 'users' && segments.length === 2;
  const node = isUserById ? SCHEMAS.user : segments.reduce(
    (current, segment) => current && childSchema(current, segment),
    SCHEMAS[parent],
  );
  if (!node) {
    return { status: 404, reason: `config path "${label}" cannot be resolved in the ${parent} config` };
  }
  if (!WRITE_METHODS.includes(method) || body === undefined) return null;
  const isNewUser = parent === 'org' && label === 'users' && !Array.isArray(body);
  const validate = isNewUser ? newUserValidator() : validatorFor(parent, segments, node);
  if (validate(body)) return null;
  return { status: 400, reason: `body does not match ${label}: ${ajv.errorsText(validate.errors)}` };
}

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
 * - Config sub-routes (`.../config/{path}`): the first `{path}` segment must be a property of the
 *   org/site/profile config schema, nested segments must resolve through it, and write bodies are
 *   validated against that property's schema. Failures are recorded in `violations` (404/400).
 *   SPEC GAP rules (behavior the spec does not describe): a single user POSTed to org `users` is
 *   validated without `id` (assigned server-side), and `users/{id}` addresses one org user.
 * - Other request and response bodies are NOT schema-validated.
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

    const configProblem = checkConfigPath(
      found.route.template,
      call.pathParams.path,
      call.method,
      call.body,
    );
    if (configProblem) {
      state.violations.push({ ...call, reason: configProblem.reason });
      return toResponse({ status: configProblem.status, headers: { 'x-error': `mock: ${configProblem.reason}` } });
    }

    const declared = responses.get(call.operationId);
    if (declared === undefined) {
      state.violations.push({ ...call, reason: `no response declared for ${call.operationId}` });
      return toResponse({ status: 501, headers: { 'x-error': 'mock: no response declared' } });
    }
    if (typeof declared === 'function') return toResponse(declared(call));
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
     * @param {object|object[]|function(object): object} response `{status, body, headers}`, a
     *   list of them returned one per call in order (the last one repeats), or a function of the
     *   recorded call (e.g. to answer by `call.query`)
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
          state.violations.push({ url: href, reason: 'non-H6 origin' });
          throw new Error(`mock-aem-api: unexpected request to ${href}`);
        }
        return handle(input, init);
      };
    },
    uninstall() { global.fetch = realFetch; },
  };
}
