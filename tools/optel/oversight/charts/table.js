import AbstractChart from './chart.js';
import { formatRelativeDate, toHumanReadable } from '../utils.js';

function getSeverity(weight, maxWeight) {
  const pct = maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
  if (pct >= 70) return 'critical';
  if (pct >= 40) return 'high';
  if (pct >= 20) return 'medium';
  return 'low';
}

export default class TableRenderer extends AbstractChart {
  constructor(dataChunks, elems) {
    super(dataChunks, elems);
    this.sortColumn = 'weight';
    this.sortDirection = 'desc';
  }

  render() {
    const container = document.getElementById('table-container');
    if (container.querySelector('table')) return;
    const table = document.createElement('table');
    table.setAttribute('aria-label', 'Error source breakdown');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const headers = [
      { label: 'Source', sort: null },
      { label: 'Target', sort: null },
      { label: 'Last Seen', sort: 'lastSeen' },
      { label: 'Estimated Count', sort: 'weight' },
    ];

    headers.forEach(({ label, sort }) => {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      if (sort) {
        th.dataset.sort = sort;
        let ariaSort = 'none';
        if (sort === this.sortColumn) {
          ariaSort = this.sortDirection === 'asc' ? 'ascending' : 'descending';
        }
        th.setAttribute('aria-sort', ariaSort);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          if (this.sortColumn === sort) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortColumn = sort;
            this.sortDirection = 'desc';
          }
          this.draw();
        });
        th.appendChild(btn);
      } else {
        th.textContent = label;
      }
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);
    table.appendChild(document.createElement('tbody'));
    container.appendChild(table);
  }

  async draw() {
    const table = document.querySelector('#table-container table');
    if (!table) return;

    const params = new URL(window.location.href).searchParams;
    const drilldown = params.get('drilldown') || '';
    const checkpoint = drilldown.split('.')[0];
    const sourceFilters = params.getAll(`${checkpoint}.source`);
    const targetFilters = params.getAll(`${checkpoint}.target`);

    // aggregate source+target pairs across filtered bundles
    const pairs = new Map();
    this.dataChunks.filtered.forEach((bundle) => {
      bundle.events
        .filter((event) => event.checkpoint === checkpoint
          && (sourceFilters.length === 0 || sourceFilters.includes(String(event.source ?? '')))
          && (targetFilters.length === 0 || targetFilters.includes(String(event.target ?? ''))))
        .forEach((event) => {
          const source = String(event.source ?? '');
          const target = String(event.target ?? '');
          const key = `${source}\0${target}`;
          if (!pairs.has(key)) {
            pairs.set(key, {
              source, target, weight: 0, lastSeen: null,
            });
          }
          const row = pairs.get(key);
          row.weight += (bundle.weight || 1);
          const ts = new Date(bundle.timeSlot);
          if (!row.lastSeen || ts > row.lastSeen) row.lastSeen = ts;
        });
    });

    const rows = Array.from(pairs.values());

    // sort
    rows.sort((a, b) => {
      let diff;
      if (this.sortColumn === 'lastSeen') {
        diff = (a.lastSeen ? a.lastSeen.getTime() : 0)
          - (b.lastSeen ? b.lastSeen.getTime() : 0);
      } else {
        diff = a.weight - b.weight;
      }
      return this.sortDirection === 'asc' ? diff : -diff;
    });

    // update aria-sort on sortable headers
    table.querySelectorAll('th[data-sort]').forEach((th) => {
      if (th.dataset.sort === this.sortColumn) {
        th.setAttribute('aria-sort', this.sortDirection === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });

    const maxWeight = rows.reduce((max, r) => Math.max(max, r.weight), 0);

    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const severity = getSeverity(row.weight, maxWeight);
      const pct = maxWeight > 0 ? Math.round((row.weight / maxWeight) * 100) : 0;

      // Source cell — render as <a> for http/https URLs only, plain text otherwise
      const tdSource = document.createElement('td');
      try {
        const parsedSource = new URL(row.source);
        if (parsedSource.protocol === 'https:' || parsedSource.protocol === 'http:') {
          const a = document.createElement('a');
          a.href = parsedSource.href;
          a.textContent = row.source;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          tdSource.appendChild(a);
        } else {
          tdSource.textContent = row.source;
        }
      } catch {
        tdSource.textContent = row.source;
      }
      tr.appendChild(tdSource);

      // Target cell
      const tdTarget = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = row.target;
      tdTarget.appendChild(code);
      tr.appendChild(tdTarget);

      // Last Seen cell
      const tdLastSeen = document.createElement('td');
      tdLastSeen.textContent = formatRelativeDate(row.lastSeen);
      tr.appendChild(tdLastSeen);

      // Estimated Count cell — badge pill + progress bar
      const tdCount = document.createElement('td');
      tdCount.className = severity;

      const badge = document.createElement('span');
      badge.className = `count-badge ${severity}`;
      badge.textContent = toHumanReadable(row.weight);
      tdCount.appendChild(badge);

      const bar = document.createElement('div');
      bar.className = 'count-bar';
      const fill = document.createElement('div');
      fill.className = `count-bar-fill ${severity}`;
      fill.style.setProperty('--fill-width', `${pct}%`);
      bar.appendChild(fill);
      tdCount.appendChild(bar);

      tr.appendChild(tdCount);
      tbody.appendChild(tr);
    });
  }
}
