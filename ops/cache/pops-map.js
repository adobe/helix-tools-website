import decorate from '../../blocks/availability/availability.js';

/** Cached region mapping; fetched from JSON so it can be updated without code changes */
let regionMappingCache = null;

async function getRegionMapping() {
  if (regionMappingCache) return regionMappingCache;
  try {
    const res = await fetch('/ops/cache/aws-regions.json');
    if (res.ok) {
      regionMappingCache = await res.json();
    }
  } catch {
    /* ignore */
  }
  return regionMappingCache ?? {};
}

class PopsMap extends HTMLElement {
  /** @type {import('./types.js').POP[]} */
  pops = [];

  /** @type {Record<string, boolean>} */
  errored = {};

  /** @type {Record<string, string>} */
  hashes = {};

  /** @type {Record<string, boolean>} */
  headerMismatch = {};

  /** @type {Record<string, string[]>} */
  headerMismatchFields = {};

  constructor() {
    super();

    this.cdnType = this.getAttribute('data-cdn-type');

    const encodedPops = this.getAttribute('data-pops');
    if (encodedPops) {
      this.pops = JSON.parse(decodeURIComponent(encodedPops));
      this.removeAttribute('data-pops');

      // count hash occurrences (only when pops have hash, e.g. Fastly)
      const popsWithHash = this.pops.filter((p) => p.hash);
      if (popsWithHash.length > 0) {
        let total = 0;
        const counts = popsWithHash.reduce((acc, pop) => {
          acc[pop.hash] = (acc[pop.hash] || 0) + 1;
          this.hashes[pop.pop] = pop.hash;
          total += 1;
          return acc;
        }, {});

        const threshold = total * 0.8;
        this.errored = this.pops.reduce((acc, pop) => {
          if (pop.hash && counts[pop.hash] < threshold) {
            acc[pop.pop] = true;
          }
          return acc;
        }, {});
      }

      // compare last-modified and content-length with live.headers
      const encodedLiveHeaders = this.getAttribute('data-live-headers');
      if (encodedLiveHeaders) {
        try {
          const liveHeaders = JSON.parse(decodeURIComponent(encodedLiveHeaders));
          this.removeAttribute('data-live-headers');
          const liveLastMod = String(liveHeaders['last-modified'] ?? liveHeaders.last_modified ?? '').trim();
          const liveContentLen = String(liveHeaders['content-length'] ?? liveHeaders.content_length ?? '').trim();
          this.pops.forEach((pop) => {
            const resHeaders = pop.response?.headers ?? {};
            const popLastMod = String(resHeaders['last-modified'] ?? resHeaders.last_modified ?? '').trim();
            const popContentLen = String(resHeaders['content-length'] ?? resHeaders.content_length ?? '').trim();
            const fields = [];
            if (liveLastMod && popLastMod !== liveLastMod) fields.push('last-modified');
            if (liveContentLen && popContentLen !== liveContentLen) fields.push('content-length');
            if (fields.length) {
              this.headerMismatch[pop.pop] = true;
              this.headerMismatchFields[pop.pop] = fields;
              const code = pop.pop.split('-')[0]?.toLowerCase();
              if (code) {
                this.headerMismatch[code] = true;
                this.headerMismatch[code.toUpperCase()] = true;
                this.headerMismatchFields[code] = fields;
                this.headerMismatchFields[code.toUpperCase()] = fields;
              }
            }
          });
        } catch {
          /* ignore parse errors */
        }
      }
    }
  }

  get styleLink() {
    /* eslint-disable no-underscore-dangle */
    if (!this._styleLink) {
      this._styleLink = document.createElement('link');
      this._styleLink.setAttribute('rel', 'stylesheet');
      this._styleLink.setAttribute('href', '/blocks/availability/availability.css');
    }
    return this._styleLink;
    /* eslint-enable no-underscore-dangle */
  }

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.appendChild(this.styleLink);

    const wrapper = document.createElement('div');
    wrapper.className = 'pops-map-wrapper';
    this.wrapper = wrapper;
    shadow.appendChild(wrapper);

    this.render(); // async; no await - render updates DOM when ready
  }

  async render() {
    this.wrapper.innerHTML = /* html */`\
      <div class="block availability">
        <div>
          <div><a href="/ops/cache/aws-regions.json"></a></div>
        </div>
      </div>`;

    const popCodes = new Set(this.pops.map((p) => p.pop?.toLowerCase()).filter(Boolean));
    const popResponses = Object.fromEntries(
      this.pops.map((p) => {
        const code = p.pop?.toLowerCase();
        const slim = {
          pop: p.pop,
          region: p.region,
          error: p.error,
          status: p.response?.status,
          headers: p.response?.headers,
          response: p.response,
        };
        return [code, slim];
      }).filter(([k]) => k),
    );

    // Use region mapping when pops have region (both CDN and Live return same format)
    let regionLocations;
    let regionPopsData;
    if (this.pops.some((p) => p.region)) {
      const mapping = await getRegionMapping();
      const pairs = this.pops
        .filter((p) => p.region && mapping[p.region])
        .map((p) => {
          const loc = mapping[p.region];
          const slim = {
            pop: p.pop,
            region: p.region,
            error: p.error,
            status: p.response?.status,
            headers: p.response?.headers,
            response: p.response,
          };
          const headerMismatch = this.headerMismatch[p.pop];
          const mismatchFields = this.headerMismatchFields[p.pop] ?? [];
          return [
            {
              Code: p.pop,
              City: loc.city,
              Latitude: loc.lat,
              Longitude: loc.long,
            },
            slim,
            headerMismatch,
            mismatchFields,
          ];
        });
      regionLocations = pairs.map(([loc]) => loc);
      regionPopsData = pairs.map(([, resp, hm, mf]) => ({
        popResponse: resp,
        headerMismatch: hm,
        mismatchFields: mf ?? [],
      }));
    }

    decorate(this.wrapper.querySelector('.block.availability'), {
      cdn: this.cdnType,
      highlight: false,
      errored: this.errored,
      hashes: this.hashes,
      headerMismatch: this.headerMismatch,
      headerMismatchFields: this.headerMismatchFields,
      popCodes,
      popResponses,
      ...(regionLocations?.length ? { regionLocations, regionPopsData } : {}),
    });
  }
}

customElements.define('pops-map', PopsMap);
