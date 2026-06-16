/* ============================================================
   HistoryChart — reusable SVG line-chart for HA entity history.

   Replaces iframing HA's /history panel (which can't escape
   the HA sidebar without the kiosk-mode HACS integration) with
   a self-contained chart that fetches via the add-on's
   /api/ha/history proxy.

   Usage:
       HistoryChart.render(hostEl, {
           entityId: 'sensor.lerch_32_ram_usage',
           label: 'Lerch 32 · RAM',
           hours: 24,         // optional, default 24
           color: '#2563eb',  // optional, default Console blue
       });
       // later:
       HistoryChart.dispose(hostEl);

   State is held on hostEl._chart so the v1.1 range picker can
   call render() again with a different `hours` without re-mounting.
   ============================================================ */

const HistoryChart = {
    // --------------------------------------------------------
    // Public API
    // --------------------------------------------------------

    async render(host, opts) {
        if (!host) return;
        const {
            entityId,
            label = entityId || 'History',
            hours = 24,
            color = '#2563eb',
        } = opts || {};
        if (!entityId) {
            host.innerHTML = this._errorMarkup('No entity to chart');
            return;
        }

        // Abort any in-flight fetch from a previous render() on this host
        // (range picker will exercise this path repeatedly).
        if (host._chart?.abortController) {
            host._chart.abortController.abort();
        }
        const abortController = new AbortController();
        host._chart = { entityId, hours, label, color, abortController, data: null };

        host.innerHTML = this._shellMarkup(label);
        const body = host.querySelector('[data-history-body]');
        body.innerHTML = this._loadingMarkup();

        try {
            const payload = await this._fetchHistory(entityId, hours, abortController.signal);
            // Bail if a newer render() superseded us.
            if (host._chart?.abortController !== abortController) return;
            host._chart.data = payload;
            body.innerHTML = this._chartMarkup(payload, { color, hours });
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[HistoryChart] fetch failed:', e);
            body.innerHTML = this._errorMarkup(e.message || 'Failed to load history');
        }
    },

    dispose(host) {
        if (!host) return;
        if (host._chart?.abortController) host._chart.abortController.abort();
        host._chart = null;
        host.innerHTML = '';
    },

    // --------------------------------------------------------
    // Fetch
    // --------------------------------------------------------

    async _fetchHistory(entityId, hours, signal) {
        const qs = new URLSearchParams({ entity_id: entityId, hours: String(hours) });
        const resp = await fetch(DashieAuth._addonUrl(`/api/ha/history?${qs}`), { signal });
        const body = await resp.json().catch(() => null);
        if (!resp.ok) {
            throw new Error(body?.message || body?.error || `HTTP ${resp.status}`);
        }
        return body;
    },

    // --------------------------------------------------------
    // Markup
    // --------------------------------------------------------

    _shellMarkup(label) {
        return `
            <div class="history-chart">
                <div class="history-chart__toolbar">
                    <strong class="history-chart__label">${this._escape(label)}</strong>
                    <span data-history-toolbar-slot></span>
                </div>
                <div data-history-body class="history-chart__body"></div>
            </div>
        `;
    },

    _loadingMarkup() {
        return `<div class="history-chart__center">Loading history…</div>`;
    },

    _errorMarkup(msg) {
        return `<div class="history-chart__center" style="color: #b91c1c;">${this._escape(msg)}</div>`;
    },

    _chartMarkup(payload, { color, hours }) {
        const samples = Array.isArray(payload?.samples) ? payload.samples : [];
        const points = this._normalizeSamples(samples);
        if (points.length === 0) {
            return this._errorMarkup('No history data in this range');
        }
        const unit = payload?.unit || '';
        const currentStr = this._formatCurrent(payload?.current_state, unit);
        const svg = this._renderSvg(points, { color, hours, unit });
        return `
            <div class="history-chart__current">${this._escape(currentStr)}</div>
            ${svg}
        `;
    },

    // --------------------------------------------------------
    // Data normalization
    // --------------------------------------------------------

    _normalizeSamples(samples) {
        const points = [];
        for (const s of samples) {
            const ts = Date.parse(s?.last_changed || s?.last_updated || '');
            const val = parseFloat(s?.state);
            if (!Number.isFinite(ts) || !Number.isFinite(val)) continue;
            points.push({ ts, val });
        }
        points.sort((a, b) => a.ts - b.ts);
        return points;
    },

    _formatCurrent(state, unit) {
        if (state == null || state === '') return '—';
        const num = parseFloat(state);
        if (Number.isFinite(num)) {
            const rounded = Math.abs(num) >= 100 ? Math.round(num) : Math.round(num * 10) / 10;
            return unit ? `${rounded}${unit === '%' ? '' : ' '}${unit}` : String(rounded);
        }
        return String(state);
    },

    // --------------------------------------------------------
    // SVG rendering — hand-rolled line chart, no deps.
    // --------------------------------------------------------

    _renderSvg(points, { color, hours, unit }) {
        // ViewBox is virtual — SVG scales to host width.
        const W = 800, H = 280;
        const M = { top: 16, right: 16, bottom: 30, left: 50 };
        const plotW = W - M.left - M.right;
        const plotH = H - M.top - M.bottom;

        const xs = points.map(p => p.ts);
        const ys = points.map(p => p.val);
        const xMin = xs[0];
        const xMax = xs[xs.length - 1];
        const xSpan = Math.max(xMax - xMin, 1);
        const yRange = this._niceYRange(ys, unit);
        const ySpan = yRange.max - yRange.min;

        const x = ts => M.left + ((ts - xMin) / xSpan) * plotW;
        const y = v => M.top + (1 - (v - yRange.min) / ySpan) * plotH;

        const linePath = points.map((p, i) =>
            `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.val).toFixed(1)}`
        ).join(' ');

        // Y ticks: 4 evenly spaced
        const yTicks = [0, 1, 2, 3, 4].map(i => {
            const v = yRange.min + (ySpan * i / 4);
            return { v, py: y(v) };
        });

        // X ticks: 4-5 evenly spaced labels based on window size
        const xTicks = this._xTickLabels(xMin, xMax, hours).map(t => ({
            label: t.label,
            px: x(t.ts),
        }));

        const fillPath = `${linePath} L${x(xMax).toFixed(1)},${(M.top + plotH).toFixed(1)} L${x(xMin).toFixed(1)},${(M.top + plotH).toFixed(1)} Z`;
        const fillColor = this._hexToRgba(color, 0.10);

        return `
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="history-chart__svg" role="img" aria-label="History chart">
                <g class="history-chart__gridlines">
                    ${yTicks.map(t => `
                        <line x1="${M.left}" y1="${t.py.toFixed(1)}" x2="${M.left + plotW}" y2="${t.py.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
                    `).join('')}
                </g>
                <g class="history-chart__ylabels" font-size="11" fill="#6b7280" text-anchor="end">
                    ${yTicks.map(t => `
                        <text x="${M.left - 8}" y="${(t.py + 3).toFixed(1)}">${this._formatTick(t.v, unit)}</text>
                    `).join('')}
                </g>
                <g class="history-chart__xlabels" font-size="11" fill="#6b7280" text-anchor="middle">
                    ${xTicks.map(t => `
                        <text x="${t.px.toFixed(1)}" y="${H - 10}">${this._escape(t.label)}</text>
                    `).join('')}
                </g>
                <path d="${fillPath}" fill="${fillColor}" stroke="none"/>
                <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
        `;
    },

    _niceYRange(values, unit) {
        // Percent sensors get a fixed 0-100 axis so two adjacent chips
        // (RAM vs battery) read at the same scale.
        if (unit === '%') return { min: 0, max: 100 };
        let lo = Math.min(...values);
        let hi = Math.max(...values);
        if (lo === hi) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.1;
        return { min: lo - pad, max: hi + pad };
    },

    _formatTick(v, unit) {
        const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
        return unit === '%' ? `${rounded}` : (unit ? `${rounded}` : `${rounded}`);
    },

    _xTickLabels(xMin, xMax, hours) {
        const N = 5;
        const out = [];
        for (let i = 0; i < N; i++) {
            const ts = xMin + ((xMax - xMin) * i) / (N - 1);
            out.push({ ts, label: this._formatXLabel(ts, hours) });
        }
        return out;
    },

    _formatXLabel(ts, hours) {
        const d = new Date(ts);
        // Short windows: HH:MM. Longer windows: include day.
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        if (hours <= 48) return `${hh}:${mm}`;
        const m = d.toLocaleString(undefined, { month: 'short' });
        const dd = d.getDate();
        return `${m} ${dd} ${hh}:${mm}`;
    },

    _hexToRgba(hex, alpha) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex);
        if (!m) return `rgba(37, 99, 235, ${alpha})`;
        const n = parseInt(m[1], 16);
        const r = (n >> 16) & 0xff;
        const g = (n >> 8) & 0xff;
        const b = n & 0xff;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    _escape(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
};

// Lazy style injection — keeps history-chart.css from being a separate
// fetch and avoids touching every page's stylesheet for a one-off module.
(function injectStyles() {
    if (document.getElementById('history-chart-styles')) return;
    const style = document.createElement('style');
    style.id = 'history-chart-styles';
    style.textContent = `
        .history-chart { display: flex; flex-direction: column; height: 100%; min-height: 320px; }
        .history-chart__toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 0 12px; gap: 12px; }
        .history-chart__label { font-size: 15px; }
        .history-chart__body { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
        .history-chart__center { flex: 1; display: flex; align-items: center; justify-content: center; color: #6b7280; font-size: 13px; padding: 32px 16px; }
        .history-chart__current { font-size: 28px; font-weight: 600; color: #111827; padding: 4px 0 8px; }
        .history-chart__svg { width: 100%; height: 100%; max-height: 320px; display: block; }
    `;
    document.head.appendChild(style);
})();
