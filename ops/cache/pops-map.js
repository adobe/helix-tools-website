import decorate from '../../blocks/availability/availability.js';

class PopsMap extends HTMLElement {
  /** @type {import('./types.js').POP[]} */
  pops = [];

  /** @type {Record<string, boolean>} */
  errored = {};

  /** @type {Record<string, string>} */
  hashes = {};

  constructor() {
    super();

    this.cdnType = this.getAttribute('data-cdn-type');

    const encodedPops = this.getAttribute('data-pops');
    if (encodedPops) {
      this.pops = JSON.parse(decodeURIComponent(encodedPops));
      this.removeAttribute('data-pops');

      // count hash occurrences
      let total = 0;
      const counts = this.pops.reduce((acc, pop) => {
        acc[pop.hash] = (acc[pop.hash] || 0) + 1;
        this.hashes[pop.pop] = pop.hash;
        total += 1;
        return acc;
      }, {});

      const threshold = total * 0.8;
      this.errored = this.pops.reduce((acc, pop) => {
        // if hash is occurs <80%, consider errored
        if (counts[pop.hash] < threshold) {
          acc[pop.pop] = true;
        }
        return acc;
      }, {});
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

    const wrapper = document.createElement('span');
    this.wrapper = wrapper;
    shadow.appendChild(wrapper);

    shadow.appendChild(this.styleLink);
    this.render();
  }

  render() {
    this.wrapper.innerHTML = /* html */`\
      <div class="block availability">
        <div>
          <div><a href="/tools/cache/global.json"></a></div>
        </div>
      </div>`;

    decorate(this.wrapper.querySelector('.block.availability'), {
      cdn: this.cdnType,
      highlight: false,
      errored: this.errored,
      hashes: this.hashes,
    });
  }
}

customElements.define('pops-map', PopsMap);
