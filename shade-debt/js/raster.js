/**
 * Browser-side raster sampling.
 *
 * Fetches GIBS tiles, stitches them into one canvas, reads the pixels back,
 * and inverts each pixel through the layer's published palette to recover a
 * physical value. Pixels whose colour is a no-data or transparent palette
 * entry - cloud, fill, ocean - decode to null, which is how the cloud mask
 * falls out of the method for free.
 */

import { tileRangeForBounds, tileCount, cellPxAtZoom, TILE_SIZE } from './geo.js';
import { tileUrl } from './gibs.js';
import { median } from './stats.js';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Load one tile as a drawable bitmap.
 * The fetch path is preferred because a blob is same-origin once created and
 * can never taint the canvas. The <img crossorigin> path is the fallback for
 * environments where fetch is blocked but image loading is not.
 */
export async function loadTile(url, { timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    if (res.status === 404) return { bitmap: null, missing: true, method: 'fetch' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) return { bitmap: null, missing: true, method: 'fetch' };
    const bitmap = await createImageBitmap(blob);
    return { bitmap, missing: false, method: 'fetch' };
  } catch (fetchErr) {
    try {
      const bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });
      return { bitmap, missing: false, method: 'img-cors' };
    } catch {
      throw fetchErr;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Highest zoom at or below `maxZoom` whose tile count for `bounds` fits the budget. */
export function chooseZoom(bounds, maxZoom, maxTiles) {
  for (let z = maxZoom; z >= 0; z--) {
    if (tileCount(tileRangeForBounds(bounds, z)) <= maxTiles) return z;
  }
  return 0;
}

/**
 * Fetch every tile covering `bounds` at `zoom` and return the stitched pixels.
 * Missing tiles (no observation for that date) leave transparent gaps rather
 * than failing the whole request.
 */
export async function stitchTiles({ bounds, zoom, urlFor, maxTiles = 36, concurrency = 6, onProgress }) {
  const range = tileRangeForBounds(bounds, zoom);
  const count = tileCount(range);
  if (count > maxTiles) throw new Error(`Tile budget exceeded (${count} > ${maxTiles})`);
  const width = (range.x1 - range.x0 + 1) * TILE_SIZE;
  const height = (range.y1 - range.y0 + 1) * TILE_SIZE;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);

  const jobs = [];
  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) jobs.push({ tx, ty });
  }

  let loaded = 0, missing = 0, method = null;
  const errors = [];
  await pool(jobs, concurrency, async ({ tx, ty }) => {
    try {
      const { bitmap, missing: isMissing, method: m } = await loadTile(urlFor({ z: zoom, x: tx, y: ty }));
      method ||= m;
      if (isMissing || !bitmap) { missing++; return; }
      ctx.drawImage(bitmap, (tx - range.x0) * TILE_SIZE, (ty - range.y0) * TILE_SIZE);
      bitmap.close?.();
      loaded++;
      onProgress?.(loaded, jobs.length);
    } catch (err) {
      errors.push(String(err && err.message || err));
      missing++;
    }
  });

  if (!loaded) {
    const detail = errors.length ? ` (${errors[0]})` : '';
    throw new Error(`No tiles could be loaded${detail}`);
  }

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (err) {
    throw new Error('Canvas is tainted: the tile server did not permit a cross-origin pixel read.');
  }

  return {
    imageData, width, height,
    originPx: { x: range.x0 * TILE_SIZE, y: range.y0 * TILE_SIZE },
    zoom, tiles: jobs.length, loaded, missing, method, errors,
  };
}

/**
 * Decode one grid cell from stitched pixels.
 * Samples on a stride so a large cell costs the same as a small one, and takes
 * the median so a few mixed-boundary pixels cannot move the result.
 */
export function sampleCell(stitched, cell, lut, maxSamplesPerSide = 8) {
  const win = cellPxAtZoom(cell, stitched.zoom);
  const x0 = Math.max(0, Math.floor(win.x0 - stitched.originPx.x));
  const y0 = Math.max(0, Math.floor(win.y0 - stitched.originPx.y));
  const x1 = Math.min(stitched.width, Math.ceil(win.x1 - stitched.originPx.x));
  const y1 = Math.min(stitched.height, Math.ceil(win.y1 - stitched.originPx.y));
  if (x1 <= x0 || y1 <= y0) return { value: null, samples: 0, valid: 0 };

  const stepX = Math.max(1, Math.floor((x1 - x0) / maxSamplesPerSide));
  const stepY = Math.max(1, Math.floor((y1 - y0) / maxSamplesPerSide));
  const data = stitched.imageData.data;
  const values = [];
  let samples = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * stitched.width + x) * 4;
      samples++;
      const v = lut.lookup(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (v != null) values.push(v);
    }
  }
  return { value: values.length ? median(values) : null, samples, valid: values.length };
}

export function sampleGrid(stitched, grid, lut) {
  const values = new Map();
  let valid = 0;
  for (const cell of grid.cells) {
    const r = sampleCell(stitched, cell, lut);
    if (r.value != null) { values.set(cell.id, r.value); valid++; }
  }
  return { values, valid, total: grid.cells.length };
}

/**
 * Sample one layer across several dates and composite per cell.
 *
 * This is the cloud-screening step: each date contributes only its decodable
 * pixels, and the per-cell median across dates suppresses both cloud edges and
 * single-day weather anomalies. A date that returns nothing is skipped rather
 * than failing the analysis.
 */
export async function compositeLayer({ resolved, lut, grid, bounds, dates, maxTiles = 36, onProgress, transform }) {
  const perCell = new Map();
  const used = [];
  const skipped = [];
  const zoom = chooseZoom(bounds, resolved.maxZoom ?? 7, maxTiles);

  for (const date of dates) {
    // `null` means "the layer's default time", used by layers with no time dimension.
    try {
      onProgress?.({ phase: 'fetch', date: date || 'default' });
      const stitched = await stitchTiles({
        bounds, zoom, maxTiles,
        urlFor: ({ z, x, y }) => tileUrl(resolved, date, z, x, y),
      });
      const { values, valid } = sampleGrid(stitched, grid, lut);
      if (!valid) { skipped.push({ date, reason: 'no decodable pixels' }); continue; }
      for (const [id, v] of values) {
        const out = transform ? transform(v) : v;
        if (out == null || !Number.isFinite(out)) continue;
        let list = perCell.get(id);
        if (!list) { list = []; perCell.set(id, list); }
        list.push(out);
      }
      used.push({ date: date || 'default', valid, coverage: valid / grid.cells.length, tiles: stitched.loaded, missing: stitched.missing, method: stitched.method });
      onProgress?.({ phase: 'done', date: date || 'default', coverage: valid / grid.cells.length });
    } catch (err) {
      skipped.push({ date: date || 'default', reason: String(err && err.message || err) });
      onProgress?.({ phase: 'skip', date: date || 'default', reason: String(err && err.message || err) });
    }
  }

  const composited = new Map();
  for (const [id, list] of perCell) {
    const m = median(list);
    if (m != null) composited.set(id, m);
  }
  return { values: composited, used, skipped, zoom, observations: used.length };
}
