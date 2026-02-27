import { LitElement, html, svg, nothing } from 'lit';
import { scoreColor } from '../../utils/psi.js';
import { formatDate } from '../../utils/formatDate.js';

import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./psi-chart.css', import.meta.url).pathname);
const CATEGORIES = [
  { id: 'performance', label: 'Performance', color: '#0265dc' },
  { id: 'accessibility', label: 'Accessibility', color: '#7c3aed' },
  { id: 'best-practices', label: 'Best Practices', color: '#e0598b' },
];

const Y_TICKS = [0, 25, 50, 75, 100];

/**
 * Multi-line SVG chart showing PSI category scores over the last N runs.
 *
 * @property {Array} runs - Array of { timestamp, scores: { performance, accessibility, ... } }
 * @property {number|string} width - Chart width (number or '100%')
 * @property {number} height - Chart height in px
 * @property {boolean} compact - Compact mode for smaller displays
 */
export class PsiChart extends LitElement {
  static properties = {
    runs: { type: Array },
    width: { type: String },
    height: { type: Number },
    compact: { type: Boolean },
    _measuredWidth: { state: true },
    _tooltip: { state: true },
  };

  constructor() {
    super();
    this.runs = [];
    this.width = '280';
    this.height = 120;
    this.compact = false;
    this._measuredWidth = 0;
    this._tooltip = null;
    this._resizeObserver = null;
  }

  get _isFluid() {
    return this.width === '100%';
  }

  get _svgWidth() {
    return this._isFluid ? this._measuredWidth : parseInt(this.width, 10);
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
    if (this._isFluid) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this._measuredWidth = Math.floor(entry.contentRect.width);
        }
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
  }

  firstUpdated() {
    if (this._isFluid) {
      const container = this.renderRoot.querySelector('.chart-container');
      if (container) {
        this._resizeObserver?.observe(container);
        this._measuredWidth = Math.floor(container.offsetWidth);
      }
    }
  }

  _computeLines() {
    const svgWidth = this._svgWidth;
    const chronological = [...this.runs].reverse();
    const n = chronological.length;
    const labelW = this.compact ? 20 : 28;
    const padX = 6;
    const padY = 10;
    const chartLeft = labelW + padX;
    const chartW = svgWidth - chartLeft - padX;
    const chartH = this.height - padY * 2;

    if (chartW <= 0) return { lines: [], chartLeft, chartW, chartH, padY, labelW, n: 0, chronological: [] };

    const lines = CATEGORIES.map((cat) => {
      const points = chronological.map((run, i) => {
        const score = run.scores?.[cat.id] ?? 0;
        const x = chartLeft + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
        const y = padY + chartH - (score / 100) * chartH;
        return { x, y, score, timestamp: run.timestamp };
      });
      return { ...cat, points };
    });

    return { lines, chartLeft, chartW, chartH, padY, labelW, n, chronological };
  }

  render() {
    const latest = this.runs[0] || null;
    if (!latest) return nothing;

    const svgWidth = this._svgWidth;
    const { lines, chartLeft, chartW, chartH, padY, labelW } = this._computeLines();
    const offsets = [-4.5, -1.5, 1.5, 4.5];

    return html`
      <div class="chart-container">
        ${svgWidth > 0 ? html`
          <div class="chart-wrapper">
            <svg
              width=${svgWidth}
              height=${this.height}
              viewBox="0 0 ${svgWidth} ${this.height}"
              class="chart-svg"
              aria-label="PSI score history chart"
              @mouseleave=${() => { this._tooltip = null; }}
            >
              ${Y_TICKS.map((v) => {
    const y = padY + chartH - (v / 100) * chartH;
    return svg`
                  <text
                    x=${labelW - 2}
                    y=${y + 3.5}
                    text-anchor="end"
                    font-size=${this.compact ? 8 : 10}
                    fill="currentColor"
                    opacity="0.5"
                  >${v}</text>
                  <line
                    x1=${chartLeft}
                    y1=${y}
                    x2=${chartLeft + chartW}
                    y2=${y}
                    stroke="currentColor"
                    opacity="0.15"
                    stroke-width="0.5"
                    stroke-dasharray=${v === 0 || v === 100 ? 'none' : '3,3'}
                  />
                `;
  })}

              ${lines.map((line, lineIdx) => {
    const yOff = offsets[lineIdx] || 0;
    return svg`
                  <g>
                    ${line.points.length > 1 ? svg`
                      <polyline
                        points=${line.points.map((p) => `${p.x},${p.y + yOff}`).join(' ')}
                        fill="none"
                        stroke=${line.color}
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    ` : nothing}
                    ${line.points.map((p) => svg`
                      <circle
                        cx=${p.x}
                        cy=${p.y + yOff}
                        r="4"
                        fill=${line.color}
                        style="cursor: pointer"
                        @mouseenter=${() => {
    this._tooltip = {
      x: p.x, y: p.y + yOff,
      label: line.label, score: p.score,
      color: line.color, date: formatDate(p.timestamp),
    };
  }}
                        @mouseleave=${() => { this._tooltip = null; }}
                      />
                    `)}
                  </g>
                `;
  })}
            </svg>

            ${this._tooltip ? html`
              <div class="tooltip" style="left: ${this._tooltip.x}px; top: ${this._tooltip.y - 8}px;">
                <div class="tooltip-label" style="color: ${this._tooltip.color}">
                  ${this._tooltip.label}: ${this._tooltip.score}
                </div>
                <div class="tooltip-date">${this._tooltip.date}</div>
              </div>
            ` : nothing}
          </div>
        ` : nothing}

        <div class="legend" style="gap: ${this.compact ? '4px 10px' : '4px 16px'}; font-size: ${this.compact ? '10px' : '12px'};">
          ${CATEGORIES.map((cat) => {
    const score = latest.scores?.[cat.id];
    return html`
              <span class="legend-item">
                <span class="legend-dot" style="background: ${cat.color}"></span>
                <span class="legend-label">
                  ${this.compact ? cat.label.replace('Best Practices', 'BP') : cat.label}
                </span>
                ${score != null ? html`
                  <span class="legend-score" style="color: ${scoreColor(score)}">${score}</span>
                ` : nothing}
              </span>
            `;
  })}
        </div>

        ${latest.timestamp ? html`
          <span class="timestamp" style="font-size: ${this.compact ? '10px' : '11px'}">
            Last run: ${formatDate(latest.timestamp)}
          </span>
        ` : nothing}
      </div>
    `;
  }

}

customElements.define('psi-chart', PsiChart);
