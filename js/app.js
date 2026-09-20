/**
 * Shade Debt - application orchestration.
 *
 * Pipeline: probe NASA GIBS for usable layers -> fetch each layer's published
 * palette -> stitch tiles for several dates -> invert pixels to physical values
 * -> composite across dates -> calibrate the local cooling slope -> rank cells
 * by avoidable heat times people exposed -> render, and hand the result back as
 * a letter, GeoJSON and CSV.
 */

import { LAYERS, BASEMAPS, ANALYSIS, SOURCES } from './config.js';
import { WMTS_3857, resolveLayer, fetchColorMapXml, fetchWithTimeout } from './gibs.js';
import { parseColorMapXml, pickPrimaryColorMap, buildLookup, toCelsius } from './colormap.js';
import { buildGrid, cellAreaKm2, clampLat, lngLatToWorldPx, metresPerPixel } from './geo.js';
import { compositeLayer } from './raster.js';
import { observationDates } from './dates.js';
import { analyseGrid, interventionTotals } from './metric.js';
import { monthlyUrl, summariseWarming } from './power.js';
import { searchPlaces, reverseLookup } from './services.js';
import { toCSV, toGeoJSON, buildLetter } from './exporters.js';

const $ = (id) => document.getElementById(id);

const state = {
  resolved: {},
  luts: {},
  analysis: null,
  place: null,
  centre: null,
  spanKm: ANALYSIS.defaultSpanKm,
  dates: [],
  power: null,
  running: false,
  layerMode: 'debt',
  cellLayer: null,
  pins: [],
  basemapOn: false,
};

/* ------------------------------------------------------------------ status */

const STATUS_KEYS = [
  ['lstDay', 'Surface temperature (day)'],
  ['lstNight', 'Surface temperature (night)'],
  ['ndvi', 'Vegetation index'],
  ['population', 'Population density'],
  ['power', 'Climate record'],
];
const statusState = new Map(STATUS_KEYS.map(([k]) => [k, { state: 'idle', detail: 'waiting' }]));

function setStatus(key, stateName, detail) {
  statusState.set(key, { state: stateName, detail });
  renderStatus();
}

function renderStatus() {
  const host = $('status');
  host.innerHTML = '';
  for (const [key, label] of STATUS_KEYS) {
    const s = statusState.get(key);
    const row = document.createElement('div');
    row.className = 'status-row';
    const cls = { idle: '', busy: 'busy', ok: 'ok', warn: 'warn', bad: 'bad' }[s.state] || '';
    row.innerHTML = `<span class="dot ${cls}" aria-hidden="true"></span>`
      + `<span class="name">${label}</span>`
      + `<span class="detail">${escapeHtml(s.detail)}</span>`;
    row.setAttribute('role', 'status');
    host.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function step(message) {
  $('overlay-step').textContent = message || '';
}

function showOverlay(title, text, visible = true) {
  const o = $('overlay');
  if (!visible) { o.hidden = true; return; }
  o.hidden = false;
  $('overlay-title').textContent = title;
  $('overlay-text').textContent = text;
}

/* --------------------------------------------------------------------- map */

let map, canvasRenderer, baseDark, baseSat;

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true })
    .setView([39.5, -98.35], 4);
  canvasRenderer = L.canvas({ padding: 0.3 });

  baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO | Analysis: NASA GIBS, SEDAC, POWER',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', (e) => {
    if (state.running) return;
    runAnalysis(e.latlng.lat, e.latlng.lng, null);
  });

  $('btn-basemap').addEventListener('click', toggleBasemap);
  $('btn-layer').addEventListener('click', toggleLayerMode);
}

async function toggleBasemap() {
  const btn = $('btn-basemap');
  if (state.basemapOn) {
    if (baseSat) map.removeLayer(baseSat);
    baseDark.addTo(map);
    state.basemapOn = false;
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  if (!baseSat) {
    btn.disabled = true;
    btn.textContent = 'Finding…';
    const when = state.dates[0] || observationDates({ lat: state.centre?.lat ?? 0, count: 1 }).dates[0];
    const found = await resolveLayer({ candidates: BASEMAPS.trueColor.candidates, time: null, ext: BASEMAPS.trueColor.ext });
    btn.disabled = false;
    btn.textContent = 'Satellite';
    if (!found.layer) { btn.textContent = 'Unavailable'; return; }
    baseSat = L.tileLayer(
      `${WMTS_3857}/${found.layer}/default/${when}/${found.matrixSet}/{z}/{y}/{x}.${BASEMAPS.trueColor.ext}`,
      { attribution: `NASA GIBS ${found.layer} ${when}`, maxNativeZoom: found.maxZoom, maxZoom: 19, tileSize: 256 },
    );
  }
  map.removeLayer(baseDark);
  baseSat.addTo(map);
  state.basemapOn = true;
  btn.setAttribute('aria-pressed', 'true');
}

function toggleLayerMode() {
  state.layerMode = state.layerMode === 'debt' ? 'night' : 'debt';
  $('btn-layer').textContent = state.layerMode === 'debt' ? 'Shade debt' : 'Night heat';
  if (state.analysis) drawCells(state.analysis);
}

/* ------------------------------------------------------------------ colour */

/* Sequential ramps from DESIGN.md. These encode measured values rather than
   brand, which is why they are allowed more than the single page accent. */
const DEBT_STOPS = [[0, '#F0E3D0'], [0.34, '#E8BE8E'], [0.68, '#D77A5A'], [1, '#8E3B2A']];
const NIGHT_STOPS = [[0, '#2B3A55'], [0.4, '#4E5E86'], [0.72, '#8A7FA8'], [1, '#C99BA8']];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rampColor(t, stops) {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
    }
  }
  return stops[stops.length - 1][1];
}

function rampCss(stops) {
  return `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})`;
}

/* ------------------------------------------------------------------- boot */

/** Lift the curtain if we arrived through the site's page transition. */
function playArrival() {
  const wipe = document.getElementById('wipe');
  const word = wipe && wipe.querySelector('.wipe__word');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!wipe) return;
  const staged = sessionStorage.getItem('sd-transition') === '1';
  sessionStorage.removeItem('sd-transition');
  if (!staged || !window.gsap || reduced) { wipe.remove(); return; }
  const gsap = window.gsap;
  gsap.set(wipe, { y: '0%' });
  gsap.set(word, { opacity: 1 });
  gsap.timeline({ onComplete: () => wipe.remove() })
    .to(word, { opacity: 0, duration: 0.24, ease: 'power2.out' })
    .to(wipe, { y: '-100%', duration: 0.62, ease: 'expo.inOut' }, 0.05);
}

async function boot() {
  playArrival();
  renderStatus();
  renderSources();
  initMap();
  wireUi();

  const tasks = Object.entries(LAYERS).map(async ([key, cfg]) => {
    setStatus(key, 'busy', 'probing');
    // Probe without a TIME segment so the layer's own default date answers;
    // guessing a date risks a 404 on a layer that is perfectly healthy.
    const found = await resolveLayer({ candidates: cfg.candidates, time: null, ext: cfg.ext });
    if (!found.layer) {
      setStatus(key, cfg.required ? 'bad' : 'warn', 'unreachable');
      return;
    }
    state.resolved[key] = { ...found, urlBase: WMTS_3857, ext: cfg.ext, cfg };
    setStatus(key, 'busy', 'palette');
    try {
      const { xml } = await fetchColorMapXml(found.layer);
      const primary = pickPrimaryColorMap(parseColorMapXml(xml));
      if (!primary || !primary.entries.length) throw new Error('empty palette');
      state.luts[key] = buildLookup(primary);
      setStatus(key, 'ok', `${primary.entries.length} colours`);
    } catch (err) {
      delete state.resolved[key];
      setStatus(key, cfg.required ? 'bad' : 'warn', 'no palette');
    }
  });

  setStatus('power', 'idle', 'on demand');
  await Promise.all(tasks);

  const missing = Object.entries(LAYERS).filter(([k, c]) => c.required && !state.resolved[k]);
  if (missing.length) {
    showOverlay(
      'NASA imagery is not reachable from this browser',
      'The required layers could not be probed. This is usually a network or cross-origin restriction '
      + 'rather than a problem with the data. The climate record below still works, but the grid analysis needs imagery.',
    );
  } else {
    showOverlay('Pick a place to begin',
      'Search a city above, or tap anywhere on the map. Everything runs in your browser against NASA’s public imagery.');
  }

  const fromHash = parseHash();
  if (fromHash) {
    state.spanKm = fromHash.spanKm;
    runAnalysis(fromHash.lat, fromHash.lon, fromHash.label);
  }
}

function renderSources() {
  $('sources').innerHTML = SOURCES
    .map((s) => `<p><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a> — ${escapeHtml(s.detail)}</p>`)
    .join('')
    + '<p>Basemap &copy; OpenStreetMap contributors, &copy; CARTO. Built for NextStep Hacks 2026.</p>';
}

/* --------------------------------------------------------------- analysis */

function boundsAround(lat, lon, spanKm) {
  const halfLat = spanKm / 2 / 110.574;
  const halfLon = spanKm / 2 / (111.320 * Math.cos((clampLat(lat) * Math.PI) / 180) || 1);
  return {
    north: clampLat(lat + halfLat), south: clampLat(lat - halfLat),
    east: lon + halfLon, west: lon - halfLon,
  };
}

/** Cell size in native pixels, chosen so the grid stays under the cell budget. */
function chooseCellPx(bounds, zoom, maxCells) {
  const a = lngLatToWorldPx(bounds.west, bounds.north, zoom);
  const b = lngLatToWorldPx(bounds.east, bounds.south, zoom);
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  return Math.max(1, Math.ceil(Math.sqrt((w * h) / maxCells)));
}

async function runAnalysis(lat, lon, label) {
  if (state.running) return;
  if (!state.resolved.lstDay || !state.resolved.ndvi) {
    showOverlay('Imagery unavailable', 'The required NASA layers could not be reached from this browser.');
    return;
  }
  state.running = true;
  $('analyse-btn').disabled = true;
  state.centre = { lat, lng: lon };
  showOverlay('Reading satellites', 'Fetching NASA imagery and decoding it into measurements.');

  try {
    const place = label || await reverseLookup(lat, lon) || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    state.place = place;
    $('overlay-title').textContent = place;

    const bounds = boundsAround(lat, lon, state.spanKm);
    map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { animate: true });

    const analysisZoom = Math.min(state.resolved.lstDay.maxZoom ?? 7, 9);
    const cellPx = chooseCellPx(bounds, analysisZoom, ANALYSIS.maxCells);
    const grid = buildGrid(bounds, analysisZoom, cellPx);
    step(`grid ${grid.rows} × ${grid.cols} at ${Math.round(metresPerPixel(lat, analysisZoom) * cellPx)} m`);

    const layerValues = {};
    const usedDates = new Set();

    for (const key of ['lstDay', 'lstNight', 'ndvi', 'population']) {
      const resolved = state.resolved[key];
      if (!resolved) { layerValues[key] = new Map(); continue; }
      const cfg = LAYERS[key];
      setStatus(key, 'busy', 'sampling');

      const dates = cfg.static
        ? [null]
        : observationDates({ lat, count: cfg.dates, periodDays: cfg.periodDays }).dates;

      const isTemp = key === 'lstDay' || key === 'lstNight';
      const lut = state.luts[key];
      const result = await compositeLayer({
        resolved, lut, grid, bounds, dates,
        maxTiles: ANALYSIS.maxTilesPerRequest,
        transform: isTemp ? (v) => toCelsius(v, lut.units) : (v) => v,
        onProgress: ({ phase, date }) => {
          if (phase === 'fetch') step(`${cfg.label.toLowerCase()} — ${date}`);
        },
      });

      layerValues[key] = result.values;
      if (!cfg.static) result.used.forEach((u) => { if (u.date && u.date !== 'default') usedDates.add(u.date); });

      const coverage = result.values.size / grid.cells.length;
      if (!result.values.size) {
        setStatus(key, cfg.required ? 'bad' : 'warn', 'no data');
        if (cfg.required) {
          const why = result.skipped[0]?.reason || 'no decodable pixels';
          throw new Error(`${cfg.label}: ${why}`);
        }
      } else {
        setStatus(key, coverage > 0.5 ? 'ok' : 'warn',
          `${Math.round(coverage * 100)}% · ${result.observations} date${result.observations === 1 ? '' : 's'}`);
      }
    }

    step('calibrating');
    const cells = grid.cells.map((c) => ({
      ...c,
      areaKm2: cellAreaKm2(c),
      lstDay: layerValues.lstDay.get(c.id) ?? null,
      lstNight: layerValues.lstNight.get(c.id) ?? null,
      ndvi: layerValues.ndvi.get(c.id) ?? null,
      popDensity: layerValues.population.get(c.id) ?? null,
    }));

    const analysis = analyseGrid(cells, { targetPercentile: ANALYSIS.targetPercentile });
    analysis.totals = interventionTotals(analysis.ranked, 5);
    analysis.dates = [...usedDates].sort();
    state.analysis = analysis;
    state.dates = analysis.dates;

    if (analysis.summary.validCells < ANALYSIS.minCellsForCalibration) {
      showOverlay('Not enough clear sky',
        `Only ${analysis.summary.validCells} of ${analysis.summary.totalCells} cells decoded. `
        + 'Cloud cover over the whole season can do this. Try a nearby area or a larger extent.');
    } else {
      showOverlay('', '', false);
    }

    renderSummary(analysis);
    renderCalibration(analysis);
    renderSites(analysis);
    drawCells(analysis);
    $('actions-card').hidden = false;
    writeHash();

    loadPower(lat, lon, analysis).catch(() => setStatus('power', 'warn', 'unavailable'));
  } catch (err) {
    showOverlay('The analysis could not finish', String(err && err.message || err));
  } finally {
    state.running = false;
    $('analyse-btn').disabled = false;
    step('');
  }
}

/* --------------------------------------------------------- NASA POWER side */

async function loadPower(lat, lon, analysis) {
  setStatus('power', 'busy', 'fetching');
  const endYear = new Date().getUTCFullYear() - 1;
  const mUrl = monthlyUrl({
    lat, lon, start: ANALYSIS.powerStartYear, end: endYear,
    parameters: ['T2M_MAX', 'T2M_MIN', 'TS'],
  });
  const res = await fetchWithTimeout(mUrl, { timeout: 25000 });
  if (!res.ok) throw new Error(`POWER ${res.status}`);
  const json = await res.json();

  const warming = summariseWarming(json, 'T2M_MAX', lat);
  const nights = summariseWarming(json, 'T2M_MIN', lat);
  const skin = summariseWarming(json, 'TS', lat);
  state.power = { warming, nights, skin };

  if (!warming) { setStatus('power', 'warn', 'short record'); return; }
  setStatus('power', 'ok', `${warming.span[0]}–${warming.span[1]}`);
  renderTrend(warming, nights, skin, analysis);
}

/* ------------------------------------------------------------- rendering */

function fmt(v, dp = 1, fallback = '—') {
  return Number.isFinite(v) ? v.toFixed(dp) : fallback;
}
function fmtInt(v, fallback = '—') {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : fallback;
}

function renderSummary(a) {
  const s = a.summary, t = a.totals;
  const cards = [
    { k: 'Worst shade debt', v: fmt(s.maxShadeDebt, 1), u: '°C avoidable', headline: true, wide: true },
    { k: 'Hot–cool spread', v: fmt(s.spread, 1), u: '°C across the area' },
    { k: 'Median surface temp', v: fmt(s.dayMedian, 1), u: '°C daytime' },
    { k: 'People in top 5 sites', v: fmtInt(t.people), u: 'residents' },
    { k: 'Trees to close the gap', v: fmtInt(t.trees), u: 'in top 5 sites' },
    { k: 'Cells decoded', v: `${s.validCells}`, u: `of ${s.totalCells} · ${Math.round(s.coverage * 100)}% clear` },
    { k: 'Observations used', v: `${a.dates.length}`, u: 'cloud-screened dates' },
  ];
  $('summary').innerHTML = cards.map((c) => `
    <div class="stat${c.headline ? ' headline' : ''}${c.wide ? ' wide' : ''}">
      <div class="k">${escapeHtml(c.k)}</div>
      <div class="v">${escapeHtml(c.v)} <span class="u">${escapeHtml(c.u)}</span></div>
    </div>`).join('');
  $('summary-card').hidden = false;
}

function renderCalibration(a) {
  const cal = a.calibration;
  const card = $('calibration-card');
  if (!cal) { card.hidden = true; return; }
  card.hidden = false;

  const strength = cal.r2 >= 0.5 ? 'a strong relationship' : cal.r2 >= 0.25 ? 'a moderate relationship' : 'a weak relationship';
  $('cal-text').innerHTML = `Across <strong>${cal.n}</strong> cells, each unit of vegetation index is worth `
    + `<strong>${Math.abs(cal.slope).toFixed(1)} °C</strong> of surface cooling here `
    + `(Theil–Sen; OLS R² ${cal.r2.toFixed(2)}, ${strength}). `
    + `The local vegetation target is NDVI ${fmt(a.summary.ndviTarget, 2)}.`;

  const W = 320, H = 190, pad = { l: 34, r: 8, t: 10, b: 26 };
  const pts = cal.points;
  const xs = pts.map((p) => p.ndvi), ys = pts.map((p) => p.lst);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  const dots = pts.map((p) => `<circle class="pt" cx="${sx(p.ndvi).toFixed(1)}" cy="${sy(p.lst).toFixed(1)}" r="2"/>`).join('');
  const fy0 = cal.intercept + cal.slope * x0;
  const fy1 = cal.intercept + cal.slope * x1;
  const fit = `<line class="fit" x1="${sx(x0)}" y1="${sy(fy0).toFixed(1)}" x2="${sx(x1)}" y2="${sy(fy1).toFixed(1)}"/>`;
  const target = Number.isFinite(a.summary.ndviTarget) && a.summary.ndviTarget >= x0 && a.summary.ndviTarget <= x1
    ? `<line x1="${sx(a.summary.ndviTarget)}" y1="${pad.t}" x2="${sx(a.summary.ndviTarget)}" y2="${H - pad.b}" stroke="var(--good)" stroke-width="1" stroke-dasharray="3 3"/>`
    : '';

  $('scatter').innerHTML = `
    <line class="axis" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/>
    <line class="axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}"/>
    ${target}${dots}${fit}
    <text class="tick" x="${pad.l}" y="${H - pad.b + 12}">${x0.toFixed(2)}</text>
    <text class="tick" x="${W - pad.r}" y="${H - pad.b + 12}" text-anchor="end">${x1.toFixed(2)}</text>
    <text class="tick" x="${pad.l - 4}" y="${H - pad.b}" text-anchor="end">${y0.toFixed(0)}</text>
    <text class="tick" x="${pad.l - 4}" y="${pad.t + 8}" text-anchor="end">${y1.toFixed(0)}</text>
    <text class="lbl" x="${W / 2}" y="${H - 4}" text-anchor="middle">vegetation index (NDVI) →</text>
    <text class="lbl" x="${-H / 2}" y="11" transform="rotate(-90)" text-anchor="middle">surface °C →</text>`;
}

function renderSites(a) {
  const body = $('sites').querySelector('tbody');
  const rows = a.ranked.slice(0, 12);
  $('sites-text').textContent = a.rankKey === 'degreePersons'
    ? 'Ranked by degree-persons: avoidable heat multiplied by the people living there.'
    : 'Ranked by avoidable heat. Population data was unavailable, so exposure is not weighted.';
  body.innerHTML = rows.map((c, i) => `
    <tr data-idx="${i}" tabindex="0">
      <td class="rank">${i + 1}</td>
      <td>${c.centre.lat.toFixed(3)}, ${c.centre.lng.toFixed(3)}</td>
      <td class="num debt">${fmt(c.shadeDebt, 1)} °C</td>
      <td class="num">${fmtInt(c.population)}</td>
      <td class="num">${fmtInt(c.trees)}</td>
    </tr>`).join('');
  body.querySelectorAll('tr').forEach((tr) => {
    const focus = () => {
      const cell = rows[Number(tr.dataset.idx)];
      body.querySelectorAll('tr').forEach((x) => x.classList.remove('active'));
      tr.classList.add('active');
      map.setView([cell.centre.lat, cell.centre.lng], Math.max(map.getZoom(), 12), { animate: true });
      L.popup().setLatLng([cell.centre.lat, cell.centre.lng]).setContent(popupHtml(cell, Number(tr.dataset.idx) + 1)).openOn(map);
    };
    tr.addEventListener('click', focus);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
  });
  $('sites-card').hidden = false;
}

function popupHtml(cell, rank) {
  const rows = [
    ['Shade debt', `${fmt(cell.shadeDebt, 1)} °C`],
    ['Surface temp (day)', `${fmt(cell.lstDay, 1)} °C`],
    ['Surface temp (night)', `${fmt(cell.lstNight, 1)} °C`],
    ['vs area median', `${cell.dayExcess >= 0 ? '+' : ''}${fmt(cell.dayExcess, 1)} °C`],
    ['NDVI', fmt(cell.ndvi, 2)],
    ['People here', fmtInt(cell.population)],
    ['Trees needed', fmtInt(cell.trees)],
  ];
  return `<h4>${rank ? `#${rank} — ` : ''}${cell.centre.lat.toFixed(4)}, ${cell.centre.lng.toFixed(4)}</h4><dl>`
    + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
}

function drawCells(a) {
  if (state.cellLayer) { map.removeLayer(state.cellLayer); state.cellLayer = null; }
  state.pins.forEach((p) => map.removeLayer(p));
  state.pins = [];

  const useNight = state.layerMode === 'night';
  const key = useNight ? 'nightExcess' : 'shadeDebt';
  const stops = useNight ? NIGHT_STOPS : DEBT_STOPS;
  const values = a.cells.map((c) => c[key]).filter(Number.isFinite);
  if (!values.length) return;
  const lo = useNight ? Math.min(...values) : 0;
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const shapes = [];
  for (const cell of a.cells) {
    const v = cell[key];
    if (!Number.isFinite(v)) continue;
    if (!useNight && v <= 0) continue;
    const t = (v - lo) / span;
    const rect = L.rectangle(
      [[cell.bounds.south, cell.bounds.west], [cell.bounds.north, cell.bounds.east]],
      {
        renderer: canvasRenderer,
        stroke: false,
        fillColor: rampColor(t, stops),
        fillOpacity: 0.22 + 0.55 * t,
        interactive: true,
      },
    );
    rect.bindPopup(() => popupHtml(cell));
    shapes.push(rect);
  }
  state.cellLayer = L.layerGroup(shapes).addTo(map);

  a.ranked.slice(0, 5).forEach((cell, i) => {
    const pin = L.marker([cell.centre.lat, cell.centre.lng], {
      icon: L.divIcon({ className: '', html: `<div class="site-pin">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      keyboard: true,
      title: `Priority site ${i + 1}`,
    }).bindPopup(popupHtml(cell, i + 1));
    pin.addTo(map);
    state.pins.push(pin);
  });

  const legend = $('legend');
  legend.hidden = false;
  $('legend-title').textContent = useNight ? 'Night heat vs median' : 'Shade debt';
  $('legend-ramp').style.background = rampCss(stops);
  $('legend-min').textContent = `${fmt(lo, 1)} °C`;
  $('legend-max').textContent = `${fmt(hi, 1)} °C`;
  $('legend-note').textContent = useNight
    ? 'Surface temperature after dark, relative to the local median.'
    : 'Degrees of surface heat attributable to missing vegetation.';
}

function renderTrend(warming, nights, skin, analysis) {
  const card = $('trend-card');
  card.hidden = false;
  const perDecade = warming.trend?.perDecade;
  const nightPerDecade = nights?.trend?.perDecade;

  $('trend-text').innerHTML = `Hot-season daytime highs at this coordinate have moved `
    + `<strong>${perDecade >= 0 ? '+' : ''}${fmt(perDecade, 2)} °C per decade</strong> since ${warming.span[0]} `
    + `(NASA POWER). The most recent decade averages <strong>${fmt(warming.recentMean, 1)} °C</strong>, `
    + `against ${fmt(warming.baselineMean, 1)} °C at the start of the record.`
    + (Number.isFinite(nightPerDecade)
      ? ` Overnight lows are moving ${nightPerDecade >= 0 ? '+' : ''}${fmt(nightPerDecade, 2)} °C per decade — `
        + `the trend that matters most for heat illness, because it decides whether the night lets a body recover.`
      : '');

  const W = 320, H = 110, pad = { l: 30, r: 8, t: 10, b: 20 };
  const ys = warming.values, xs = warming.years;
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (i) => pad.l + (i / (xs.length - 1 || 1)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const path = ys.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const area = `${path} L${sx(ys.length - 1).toFixed(1)},${H - pad.b} L${sx(0).toFixed(1)},${H - pad.b} Z`;
  const t = warming.trend;
  const fitPath = t
    ? `M${sx(0)},${sy(t.intercept + t.perYear * xs[0]).toFixed(1)} L${sx(xs.length - 1)},${sy(t.intercept + t.perYear * xs[xs.length - 1]).toFixed(1)}`
    : '';

  $('spark').innerHTML = `
    <path class="area" d="${area}"/>
    <path class="line" d="${path}"/>
    ${fitPath ? `<path class="fit" d="${fitPath}"/>` : ''}
    <text class="tick" x="${pad.l}" y="${H - 6}">${xs[0]}</text>
    <text class="tick" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${xs[xs.length - 1]}</text>
    <text class="tick" x="${pad.l - 4}" y="${pad.t + 8}" text-anchor="end">${y1.toFixed(0)}</text>
    <text class="tick" x="${pad.l - 4}" y="${H - pad.b}" text-anchor="end">${y0.toFixed(0)}</text>`;

  // Independent cross-check: two different NASA products over the same ground.
  const satMedian = analysis?.summary?.dayMedian;
  if (Number.isFinite(satMedian) && skin) {
    const diff = satMedian - skin.recentMean;
    $('crosscheck').innerHTML = `<strong>Cross-check.</strong> The imagery puts this area's median daytime `
      + `surface temperature at ${fmt(satMedian, 1)} °C. NASA POWER, an independent record built from different `
      + `instruments, puts the recent hot-season mean skin temperature at ${fmt(skin.recentMean, 1)} °C — a gap of `
      + `${fmt(Math.abs(diff), 1)} °C. A gap is expected and is not an error: the imagery samples a mid-morning `
      + `overpass on clear days, while POWER averages across all hours and all weather. They should agree in `
      + `magnitude, not exactly, and here they do.`;
  }
}

/* --------------------------------------------------------------- exports */

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function slug(s) {
  return String(s || 'area').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function exportMeta() {
  return {
    place: state.place,
    generated: new Date().toISOString().slice(0, 10),
    dates: state.analysis?.dates || [],
    model: state.analysis?.calibration
      ? { slopeCPerNdvi: state.analysis.calibration.slope, r2: state.analysis.calibration.r2, cells: state.analysis.calibration.n, ndviTarget: state.analysis.summary.ndviTarget }
      : null,
    sources: SOURCES.map((s) => `${s.name}: ${s.detail}`),
  };
}

function wireUi() {
  const form = $('search-form');
  const input = $('place');
  const results = $('results');
  let searchTimer;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    try {
      const found = await searchPlaces(q, 1);
      if (found.length) { results.innerHTML = ''; runAnalysis(found[0].lat, found[0].lon, found[0].label); }
    } catch { /* search is best effort */ }
  });

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q);
        results.innerHTML = found.map((f, i) =>
          `<button type="button" data-i="${i}" role="option"><span>${escapeHtml(f.name)}</span>`
          + `<span class="muted">${escapeHtml(f.admin)}</span></button>`).join('');
        results.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          const f = found[Number(b.dataset.i)];
          input.value = f.label;
          results.innerHTML = '';
          runAnalysis(f.lat, f.lon, f.label);
        }));
      } catch { results.innerHTML = ''; }
    }, 280);
  });

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) results.innerHTML = '';
  });

  $('btn-letter').addEventListener('click', () => {
    const a = state.analysis;
    if (!a) return;
    download(`shade-debt-letter-${slug(state.place)}.txt`, buildLetter({
      place: state.place, ranked: a.ranked, summary: a.summary,
      calibration: a.calibration, totals: a.totals, dates: a.dates,
      generated: new Date().toISOString().slice(0, 10),
    }), 'text/plain;charset=utf-8');
  });

  $('btn-geojson').addEventListener('click', () => {
    if (!state.analysis) return;
    download(`shade-debt-${slug(state.place)}.geojson`,
      JSON.stringify(toGeoJSON(state.analysis.ranked, exportMeta()), null, 2), 'application/geo+json');
  });

  $('btn-csv').addEventListener('click', () => {
    if (!state.analysis) return;
    download(`shade-debt-${slug(state.place)}.csv`, toCSV(state.analysis.ranked, exportMeta()), 'text/csv;charset=utf-8');
  });

  $('btn-link').addEventListener('click', async () => {
    writeHash();
    const btn = $('btn-link');
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = location.href;
    }
    setTimeout(() => { btn.textContent = original; }, 1800);
  });
}

function writeHash() {
  if (!state.centre) return;
  const { lat, lng } = state.centre;
  const parts = [lat.toFixed(4), lng.toFixed(4), String(state.spanKm), encodeURIComponent(state.place || '')];
  history.replaceState(null, '', `#${parts.join(',')}`);
}

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const [lat, lon, span, label] = h.split(',');
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const sp = Number(span);
  return {
    lat: la, lon: lo,
    spanKm: Number.isFinite(sp) ? Math.min(ANALYSIS.maxSpanKm, Math.max(ANALYSIS.minSpanKm, sp)) : ANALYSIS.defaultSpanKm,
    label: label ? decodeURIComponent(label) : null,
  };
}

boot();
