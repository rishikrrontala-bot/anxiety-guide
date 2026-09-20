/**
 * Shade Debt — site motion.
 *
 * Two page-wide behaviours and no more: a masked per-line text reveal, and one
 * pinned section. Everything else on this page is static by choice.
 *
 * The scatter demonstration and the decoded tiles are not mock-ups: they call
 * the same modules the analysis uses, so what the page claims about the method
 * is executed in front of the reader.
 */

import { LAYERS } from './config.js';
import { resolveLayer, fetchColorMapXml, tileUrl, WMTS_3857 } from './gibs.js';
import { parseColorMapXml, pickPrimaryColorMap, buildLookup, toCelsius } from './colormap.js';
import { lngLatToWorldPx, TILE_SIZE } from './geo.js';
import { loadTile } from './raster.js';
import { observationDates } from './dates.js';
import { olsRegression, theilSen, median } from './stats.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGsap = Boolean(gsap && ScrollTrigger);

if (hasGsap) gsap.registerPlugin(ScrollTrigger);

/* ------------------------------------------------------------ smooth scroll */

function initLenis() {
  if (reduced || typeof window.Lenis !== 'function') return null;
  const lenis = new window.Lenis({ duration: 1.05, smoothWheel: true, touchMultiplier: 1.6 });
  if (hasGsap) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  return lenis;
}

/* --------------------------------------------------------- line splitting */

/**
 * Flatten an element to word spans, measure where the browser actually broke
 * the lines, then regroup those words into masked line containers.
 *
 * Emphasis elements are flattened too - their words carry an `is-em` class so
 * the styling survives without an inline element straddling a line boundary,
 * which would make the mask impossible.
 */
function splitIntoLines(el) {
  if (el.dataset.split === 'done') return Array.from(el.querySelectorAll('.rl__i'));

  if (!el.dataset.originalHtml) el.dataset.originalHtml = el.innerHTML;
  el.innerHTML = el.dataset.originalHtml;

  const words = [];
  const walk = (node, emphasis) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); continue; }
          const span = document.createElement('span');
          span.className = emphasis ? 'w is-em' : 'w';
          span.textContent = part;
          frag.appendChild(span);
          words.push(span);
        }
        node.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child, emphasis || child.tagName === 'EM' || child.tagName === 'I');
      }
    }
  };
  walk(el, false);
  if (!words.length) return [];

  // Group by the vertical position the browser gave each word.
  const lines = [];
  let currentTop = null;
  for (const word of words) {
    const top = Math.round(word.offsetTop);
    if (currentTop === null || Math.abs(top - currentTop) > 2) {
      lines.push([]);
      currentTop = top;
    }
    lines[lines.length - 1].push(word);
  }

  const fragment = document.createDocumentFragment();
  const inners = [];
  for (const line of lines) {
    const mask = document.createElement('span');
    mask.className = 'rl';
    const inner = document.createElement('span');
    inner.className = 'rl__i';
    line.forEach((word, i) => {
      if (i) inner.appendChild(document.createTextNode(' '));
      inner.appendChild(word);
    });
    mask.appendChild(inner);
    fragment.appendChild(mask);
    inners.push(inner);
  }
  el.innerHTML = '';
  el.appendChild(fragment);
  el.dataset.split = 'done';
  return inners;
}

function initReveals() {
  const targets = Array.from(document.querySelectorAll('[data-reveal]'));
  const fades = Array.from(document.querySelectorAll('[data-fade]'));

  if (!hasGsap || reduced) return; // markup is already in its final state

  for (const el of targets) {
    const inners = splitIntoLines(el);
    if (!inners.length) continue;
    gsap.set(inners, { yPercent: 105 });
    gsap.to(inners, {
      yPercent: 0,
      duration: 0.88,
      ease: 'expo.out',
      stagger: 0.06,
      delay: parseFloat(el.dataset.revealDelay || '0'),
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      onComplete() { inners.forEach((i) => { i.style.willChange = 'auto'; }); },
    });
  }

  for (const el of fades) {
    gsap.set(el, { opacity: 0, y: 18 });
    gsap.to(el, {
      opacity: 1, y: 0, duration: 0.8, ease: 'expo.out',
      delay: parseFloat(el.dataset.revealDelay || '0'),
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
    });
  }

  // Re-measure line breaks when the column width actually changes.
  let lastWidth = window.innerWidth;
  let timer;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastWidth) < 40) return;
    lastWidth = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const el of targets) {
        el.dataset.split = '';
        const inners = splitIntoLines(el);
        gsap.set(inners, { yPercent: 0 });
      }
      ScrollTrigger.refresh();
    }, 220);
  }, { passive: true });
}

/* ------------------------------------------------------- pinned section */

function initPinnedMeasures(globe) {
  const section = document.getElementById('measures');
  const pin = document.getElementById('measures-pin');
  const steps = Array.from(document.querySelectorAll('.step'));
  if (!section || !pin || !steps.length) return;

  const activate = (index) => {
    steps.forEach((s, i) => s.classList.toggle('is-active', i === index));
  };

  if (!hasGsap || reduced) {
    steps.forEach((s) => s.classList.add('is-active'));
    return;
  }

  activate(0);
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: '+=220%',
    pin,
    pinSpacing: true,
    anticipatePin: 1,
    onUpdate(self) {
      const index = Math.min(steps.length - 1, Math.floor(self.progress * steps.length));
      activate(index);
    },
  });

  if (globe) {
    ScrollTrigger.create({
      trigger: document.body,
      start: 'top top',
      endTrigger: section,
      end: 'bottom bottom',
      onUpdate(self) { globe.setProgress(self.progress); },
    });
    ScrollTrigger.create({
      trigger: section,
      start: 'bottom 40%',
      onEnter() { globe.setPaused(true); },
      onLeaveBack() { globe.setPaused(false); },
    });
  }
}

/* ------------------------------------------------------------ the globe */

async function initGlobe() {
  const stage = document.getElementById('globe-stage');
  if (!stage || document.documentElement.classList.contains('no-webgl')) return null;
  try {
    const { mountGlobe } = await import('./globe.js');
    const globe = await mountGlobe(stage, { rim: '#E9CBB8' });
    stage.classList.add('is-ready');
    return globe;
  } catch (err) {
    // No imagery, no globe. The hero is designed to stand on type alone.
    document.documentElement.classList.add('no-webgl');
    return null;
  }
}

/* ------------------------------------------------ live decoded NASA tiles */

const TILE_DEMO = { lat: 34.05, lon: -118.24, zoom: 6 }; // Los Angeles basin

function tileIndexFor(lat, lon, zoom) {
  const px = lngLatToWorldPx(lon, lat, zoom);
  return { x: Math.floor(px.x / TILE_SIZE), y: Math.floor(px.y / TILE_SIZE) };
}

function drawToCanvas(canvasId, bitmap) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
}

function decodeMedian(bitmap, lut, transform) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const values = [];
  const step = Math.max(1, Math.floor(width / 48));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const v = lut.lookup(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (v == null) continue;
      const out = transform ? transform(v) : v;
      if (Number.isFinite(out)) values.push(out);
    }
  }
  return median(values);
}

async function initTiles() {
  const caption = document.getElementById('tiles-caption');
  const specs = [
    { key: 'lstDay', canvas: 'tile-lst', value: 'val-lst', unit: '°C', dp: 1, temp: true },
    { key: 'ndvi', canvas: 'tile-ndvi', value: 'val-ndvi', unit: 'NDVI', dp: 2, temp: false },
    { key: 'population', canvas: 'tile-pop', value: 'val-pop', unit: '/km²', dp: 0, temp: false },
  ];
  let anySucceeded = false;

  await Promise.all(specs.map(async (spec) => {
    const el = document.getElementById(spec.value);
    const cfg = LAYERS[spec.key];
    try {
      const found = await resolveLayer({ candidates: cfg.candidates, time: null, ext: cfg.ext });
      if (!found.layer) throw new Error('layer unreachable');
      const { xml } = await fetchColorMapXml(found.layer);
      const palette = pickPrimaryColorMap(parseColorMapXml(xml));
      if (!palette || !palette.entries.length) throw new Error('no palette');
      const lut = buildLookup(palette);

      const date = cfg.static ? null : observationDates({ lat: TILE_DEMO.lat, count: 1, periodDays: cfg.periodDays }).dates[0];
      const zoom = Math.min(found.maxZoom ?? TILE_DEMO.zoom, TILE_DEMO.zoom);
      const { x, y } = tileIndexFor(TILE_DEMO.lat, TILE_DEMO.lon, zoom);
      const resolved = { ...found, ext: cfg.ext, urlBase: WMTS_3857 };
      const { bitmap } = await loadTile(tileUrl(resolved, date, zoom, x, y));
      if (!bitmap) throw new Error('no tile');

      drawToCanvas(spec.canvas, bitmap);
      const value = decodeMedian(bitmap, lut, spec.temp ? (v) => toCelsius(v, lut.units) : null);
      bitmap.close?.();

      if (el) {
        el.dataset.state = 'ok';
        el.textContent = value == null ? 'no data' : `${value.toFixed(spec.dp)} ${spec.unit}`;
      }
      anySucceeded = true;
    } catch {
      if (el) { el.dataset.state = 'pending'; el.textContent = 'unavailable'; }
    }
  }));

  if (caption && !anySucceeded) {
    caption.textContent = 'These panels are empty because NASA’s tile service could not be reached from this '
      + 'network. Nothing has been substituted in its place.';
  } else if (caption && anySucceeded) {
    caption.textContent = 'Live NASA tiles, fetched and decoded by this page while you read it — the median value '
      + 'under each panel was recovered from those pixels, not stored here.';
  }
}

/* --------------------------------------- Theil-Sen demonstration (section 5) */

const PLOT = { w: 640, h: 400, pad: { l: 42, r: 18, t: 18, b: 34 }, trueSlope: -10, intercept: 40 };

function makeBaseline() {
  // Deterministic pseudo-noise, so the demonstration looks the same every visit.
  let seed = 20260920;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const x = 0.05 + (i / 63) * 0.78;
    pts.push({ x, y: PLOT.intercept + PLOT.trueSlope * x + (rand() - 0.5) * 1.6, outlier: false });
  }
  return pts;
}

function initPlot() {
  const host = document.getElementById('plot');
  const svg = document.getElementById('plot-svg');
  if (!host || !svg) return;

  let points = makeBaseline();
  const elTrue = document.getElementById('r-true');
  const elOls = document.getElementById('r-ols');
  const elTs = document.getElementById('r-ts');
  const elNote = document.getElementById('r-note');
  if (elTrue) elTrue.textContent = PLOT.trueSlope.toFixed(1).replace('-', '−');

  const xs = () => points.map((p) => p.x);
  const ys = () => points.map((p) => p.y);

  function draw() {
    const { w, h, pad } = PLOT;
    const yAll = ys();
    const yMin = Math.min(...yAll, 28), yMax = Math.max(...yAll, 44);
    const sx = (x) => pad.l + x * (w - pad.l - pad.r);
    const sy = (y) => h - pad.b - ((y - yMin) / (yMax - yMin || 1)) * (h - pad.t - pad.b);

    const ols = olsRegression(xs(), ys());
    const ts = theilSen(xs(), ys());

    const dots = points.map((p) =>
      `<circle class="plot__pt${p.outlier ? ' plot__pt--out' : ''}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.outlier ? 5 : 3.5}"/>`
    ).join('');

    const lineFor = (fit, cls) => {
      if (!fit) return '';
      const y0 = fit.intercept, y1 = fit.intercept + fit.slope;
      return `<line class="${cls}" x1="${sx(0)}" y1="${sy(y0).toFixed(1)}" x2="${sx(1)}" y2="${sy(y1).toFixed(1)}"/>`;
    };

    svg.innerHTML = `
      <line class="plot__axis" x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}"/>
      <line class="plot__axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}"/>
      ${dots}
      ${lineFor(ols, 'plot__ols')}
      ${lineFor(ts, 'plot__ts')}`;

    const fmt = (v) => (v == null ? '—' : v.toFixed(1).replace('-', '−'));
    if (elOls) elOls.textContent = fmt(ols ? ols.slope : null);
    if (elTs) elTs.textContent = fmt(ts ? ts.slope : null);

    if (elNote) {
      const outliers = points.filter((p) => p.outlier).length;
      if (!outliers) {
        elNote.textContent = 'Clean data: both estimators agree. Add outliers and watch them part company.';
      } else if (ols && ts) {
        const olsErr = Math.abs(ols.slope - PLOT.trueSlope);
        const tsErr = Math.abs(ts.slope - PLOT.trueSlope);
        elNote.textContent = `${outliers} outlier${outliers === 1 ? '' : 's'}: least squares is off by `
          + `${olsErr.toFixed(1)}, the robust estimator by ${tsErr.toFixed(1)}. `
          + 'This is why the analysis uses Theil–Sen.';
      }
    }
  }

  function addOutlierAt(clientX, clientY) {
    const rect = host.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.98, (clientX - rect.left) / rect.width));
    const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const yAll = ys();
    const yMin = Math.min(...yAll, 28), yMax = Math.max(...yAll, 44);
    const y = yMax - frac * (yMax - yMin);
    points.push({ x, y, outlier: true });
    draw();
  }

  let dragging = false;
  host.addEventListener('pointerdown', (e) => {
    dragging = true;
    host.setPointerCapture?.(e.pointerId);
    addOutlierAt(e.clientX, e.clientY);
  });
  host.addEventListener('pointermove', (e) => { if (dragging) addOutlierAt(e.clientX, e.clientY); });
  host.addEventListener('pointerup', () => { dragging = false; });
  host.addEventListener('pointercancel', () => { dragging = false; });

  host.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') { points = makeBaseline(); draw(); }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      points.push({ x: 0.15 + Math.random() * 0.3, y: 56 + Math.random() * 10, outlier: true });
      draw();
    }
  });

  document.getElementById('plot-outlier')?.addEventListener('click', () => {
    points.push({ x: 0.15 + Math.random() * 0.3, y: 56 + Math.random() * 10, outlier: true });
    draw();
  });
  document.getElementById('plot-reset')?.addEventListener('click', () => { points = makeBaseline(); draw(); });

  draw();
}

/* ------------------------------------------------------ page transition */

function initTransition() {
  const wipe = document.getElementById('wipe');
  const word = wipe?.querySelector('.wipe__word');

  // Arriving from the other page: lift the curtain rather than cutting to content.
  if (wipe && hasGsap && !reduced && sessionStorage.getItem('sd-transition') === '1') {
    sessionStorage.removeItem('sd-transition');
    gsap.set(wipe, { y: '0%' });
    gsap.set(word, { opacity: 1 });
    gsap.timeline()
      .to(word, { opacity: 0, duration: 0.24, ease: 'power2.out' })
      .to(wipe, { y: '-100%', duration: 0.62, ease: 'expo.inOut' }, 0.05);
  }

  for (const link of document.querySelectorAll('[data-transition]')) {
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const href = link.getAttribute('href');
      if (!href) return;
      if (!wipe || !hasGsap || reduced) { sessionStorage.setItem('sd-transition', '1'); return; }
      e.preventDefault();
      sessionStorage.setItem('sd-transition', '1');
      gsap.timeline({ onComplete: () => { window.location.href = href; } })
        .set(wipe, { y: '100%' })
        .set(word, { opacity: 0 })
        .to(wipe, { y: '0%', duration: 0.52, ease: 'expo.inOut' })
        .to(word, { opacity: 1, duration: 0.2, ease: 'power2.out' }, '-=0.18');
    });
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  initLenis();
  initTransition();
  initReveals();
  initPlot();

  // Everything above is first-paint critical. The heavy work waits.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(() => { initTiles(); });

  const globe = await initGlobe();
  initPinnedMeasures(globe);
  if (hasGsap) ScrollTrigger.refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
