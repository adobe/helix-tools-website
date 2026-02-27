import { LitElement, html } from 'lit';
import { diffJson } from 'diff';

import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./json-diff.css', import.meta.url).pathname);

export class JsonDiff extends LitElement {
  static properties = {
    oldObj: { type: Object },
    newObj: { type: Object },
  };

  constructor() {
    super();
    this.oldObj = null;
    this.newObj = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  render() {
    const oldStr = this.oldObj != null ? JSON.stringify(this.oldObj, null, 2) : '';
    const newStr = this.newObj != null ? JSON.stringify(this.newObj, null, 2) : '';
    const parts = diffJson(oldStr, newStr);

    return html`<pre class="diff">${parts.map((part) => {
      let cls = 'unchanged';
      let prefix = ' ';
      if (part.added) { cls = 'added'; prefix = '+'; }
      else if (part.removed) { cls = 'removed'; prefix = '-'; }
      const lines = part.value.replace(/\n$/, '').split('\n');
      return lines.map((line) => html`<div class="line ${cls}"><span class="prefix">${prefix}</span>${line}</div>`);
    })}</pre>`;
  }
}

customElements.define('json-diff', JsonDiff);
