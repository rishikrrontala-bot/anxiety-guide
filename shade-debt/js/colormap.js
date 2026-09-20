/**
 * NASA GIBS colormap inversion.
 *
 * GIBS serves science layers as pre-coloured PNG tiles. NASA publishes the exact
 * palette for each layer as a ColorMap XML document, mapping every RGB triplet
 * back to the physical value interval it represents. Parsing that document lets
 * us recover physical values (degrees, NDVI, persons/km2) from rendered pixels
 * entirely client-side.
 *
 * The parser is regex-based rather than DOM-based so the same code runs in the
 * browser and under Node for testing.
 */

const COLORMAP_BLOCK = /<ColorMap\b([^>]*)>([\s\S]*?)<\/ColorMap>/g;
const ENTRY = /<ColorMapEntry\b([^>]*?)\/?>/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(s) {
  const out = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(s))) out[m[1]] = m[2];
  return out;
}

function parseNumber(token) {
  const t = String(token).trim();
  if (/^[+]?INF$/i.test(t)) return Infinity;
  if (/^-INF$/i.test(t)) return -Infinity;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * GIBS value intervals look like "[12,13)", "(-INF,0]" or a bare "42".
 * Returns {min, max, representative} or null when unparseable.
 */
export function parseInterval(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const bracketed = s.match(/^([[(])\s*([^,]+?)\s*,\s*([^)\]]+?)\s*([)\]])$/);
  if (bracketed) {
    const min = parseNumber(bracketed[2]);
    const max = parseNumber(bracketed[3]);
    if (min === null || max === null) return null;
    let representative;
    if (Number.isFinite(min) && Number.isFinite(max)) representative = (min + max) / 2;
    else if (Number.isFinite(min)) representative = min;
    else if (Number.isFinite(max)) representative = max;
    else return null;
    return { min, max, representative };
  }
  const single = parseNumber(s);
  if (single === null || !Number.isFinite(single)) return null;
  return { min: single, max: single, representative: single };
}

function parseRgb(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map((p) => Number(p.trim()));
  if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return { r: parts[0] & 255, g: parts[1] & 255, b: parts[2] & 255 };
}

export function rgbKey(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

/**
 * Parse a GIBS ColorMap XML document into one or more palettes.
 * Entries flagged transparent (or carrying a no-data interval) become the
 * cloud / fill mask rather than values.
 */
export function parseColorMapXml(xml) {
  const maps = [];
  COLORMAP_BLOCK.lastIndex = 0;
  let block;
  while ((block = COLORMAP_BLOCK.exec(xml))) {
    const head = parseAttrs(block[1]);
    const body = block[2];
    const entries = [];
    const transparentKeys = new Set();
    ENTRY.lastIndex = 0;
    let e;
    while ((e = ENTRY.exec(body))) {
      const a = parseAttrs(e[1]);
      const rgb = parseRgb(a.rgb);
      if (!rgb) continue;
      const key = rgbKey(rgb.r, rgb.g, rgb.b);
      const isTransparent = String(a.transparent).toLowerCase() === 'true';
      const interval = parseInterval(a.value != null ? a.value : a.sourceValue);
      if (isTransparent || !interval) {
        transparentKeys.add(key);
        continue;
      }
      entries.push({ ...rgb, key, value: interval.representative, min: interval.min, max: interval.max });
    }
    maps.push({
      title: head.title || '',
      units: head.units || '',
      entries,
      transparentKeys,
    });
  }
  return maps;
}

/**
 * Of several palettes in one document, the richest one is the data palette.
 *
 * Real GIBS documents declare no-data in a *separate* ColorMap block, titled
 * "No Data", which carries a single transparent entry. Reading only the data
 * block would leave that colour unmasked, and a fill pixel would then be
 * nearest-matched to a real temperature. So the mask is the union of every
 * block's transparent entries, minus any colour the chosen palette genuinely
 * uses for data — masking is the safe direction, but not at the cost of
 * discarding valid measurements.
 */
export function pickPrimaryColorMap(maps) {
  if (!maps || !maps.length) return null;
  const primary = maps.reduce((best, m) => (m.entries.length > (best ? best.entries.length : -1) ? m : best), null);
  if (!primary) return null;

  const dataKeys = new Set(primary.entries.map((e) => e.key));
  const masked = new Set();
  for (const map of maps) {
    for (const key of map.transparentKeys) {
      if (!dataKeys.has(key)) masked.add(key);
    }
  }
  return { ...primary, transparentKeys: masked };
}

/**
 * Build a fast RGB -> value lookup table.
 * `nearestTolerance` is the maximum squared RGB distance still accepted as a
 * match, which absorbs the slight colour drift PNG resampling can introduce.
 */
export function buildLookup(colorMap, nearestTolerance = 900) {
  const exact = new Map();
  for (const e of colorMap.entries) {
    if (!exact.has(e.key)) exact.set(e.key, e.value);
  }
  const palette = colorMap.entries;
  const cache = new Map();
  const transparent = colorMap.transparentKeys || new Set();

  function lookup(r, g, b, a = 255) {
    if (a < 8) return null;
    const key = rgbKey(r, g, b);
    if (transparent.has(key)) return null;
    const hit = exact.get(key);
    if (hit !== undefined) return hit;
    if (cache.has(key)) return cache.get(key);
    let bestVal = null;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = p.r - r, dg = p.g - g, db = p.b - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; bestVal = p.value; if (d === 0) break; }
    }
    const result = bestDist <= nearestTolerance ? bestVal : null;
    cache.set(key, result);
    return result;
  }

  return {
    lookup,
    units: colorMap.units,
    title: colorMap.title,
    size: palette.length,
    range: palette.length
      ? { min: Math.min(...palette.map((p) => p.value)), max: Math.max(...palette.map((p) => p.value)) }
      : null,
  };
}

/**
 * Normalise a palette value to degrees Celsius.
 * Units come from NASA's own metadata; the magnitude check is a guard for
 * layers that omit the attribute (Kelvin values are never below 100).
 */
export function toCelsius(value, units) {
  if (value == null) return null;
  const u = String(units || '').trim().toLowerCase();
  if (u === 'k' || u.startsWith('kelvin')) return value - 273.15;
  if (u === 'c' || u.startsWith('celsius') || u.includes('°c')) return value;
  return value > 100 ? value - 273.15 : value;
}
