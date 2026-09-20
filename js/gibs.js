/**
 * NASA GIBS (Global Imagery Browse Services) client.
 *
 * GIBS needs no API key. What it does need is the right tile matrix set for
 * each layer, and those differ by native resolution. Rather than hard-coding
 * guesses, we probe the world tile (0/0/0) across candidate matrix sets and
 * keep the first that responds - which simultaneously confirms the layer
 * exists, confirms the matrix set, and confirms cross-origin reads are
 * permitted from this page.
 */

export const GIBS_BASE = 'https://gibs.earthdata.nasa.gov';
export const WMTS_3857 = `${GIBS_BASE}/wmts/epsg3857/best`;
export const COLORMAP_BASES = [
  `${GIBS_BASE}/colormaps/v1.3`,
  `${GIBS_BASE}/colormaps/v1.2`,
  `${GIBS_BASE}/colormaps/v1.1`,
  `${GIBS_BASE}/colormaps/v1.0`,
];

/** Matrix set names, finest first: a finer set means a sharper analysis. */
export const MATRIX_SETS = [
  'GoogleMapsCompatible_Level13',
  'GoogleMapsCompatible_Level12',
  'GoogleMapsCompatible_Level9',
  'GoogleMapsCompatible_Level8',
  'GoogleMapsCompatible_Level7',
  'GoogleMapsCompatible_Level6',
  'GoogleMapsCompatible_Level5',
  'GoogleMapsCompatible_Level3',
];

export function levelOf(matrixSet) {
  const m = /Level(\d+)$/.exec(matrixSet || '');
  return m ? Number(m[1]) : null;
}

/**
 * Build a WMTS REST tile URL.
 *
 * The TIME segment is omitted entirely when `time` is null. GIBS requires that
 * for layers with no time dimension (gridded population, for instance), and for
 * time-varying layers an omitted TIME resolves to the layer's default date -
 * which makes it the safest form to probe with.
 */
export function buildTileUrl({ layer, matrixSet, time = null, z, y, x, ext = 'png', base = WMTS_3857 }) {
  const timeSegment = time ? `${time}/` : '';
  return `${base}/${layer}/default/${timeSegment}${matrixSet}/${z}/${y}/${x}.${ext}`;
}

/** Tile URL for an already-resolved layer at a given time (null = default). */
export function tileUrl(resolved, time, z, x, y) {
  return buildTileUrl({
    layer: resolved.layer, matrixSet: resolved.matrixSet, ext: resolved.ext,
    base: resolved.urlBase || WMTS_3857, time, z, y, x,
  });
}

/**
 * Terra and Aqua (and SNPP/NOAA-20) usually share one palette, published
 * without the platform in its name. Tried as a second guess before we pay for
 * the capabilities document.
 */
export function platformAgnostic(layer) {
  return layer.replace(/_(Terra|Aqua|SNPP|NOAA20|NOAA21)_/, '_');
}

export function colorMapUrls(layer) {
  const ids = [layer];
  const stripped = platformAgnostic(layer);
  if (stripped !== layer) ids.push(stripped);
  const urls = [];
  for (const id of ids) for (const base of COLORMAP_BASES) urls.push(`${base}/${id}.xml`);
  return urls;
}

export function capabilitiesUrl() {
  return `${WMTS_3857}/1.0.0/WMTSCapabilities.xml`;
}

function colormapVersion(url) {
  const m = /\/v(\d+)\.(\d+)\//.exec(url);
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

/**
 * Pull a layer's published colormap href out of a WMTS capabilities document.
 *
 * Pure, so it is unit-tested rather than trusted. Layer identifiers are unique
 * in the document, so we locate the identifier and read the enclosing <Layer>
 * block; several colormap versions may be listed, and the newest wins.
 */
export function extractColorMapHref(xml, layer) {
  if (!xml || !layer) return null;
  // Tolerate indentation, line wrapping and a namespace prefix on Identifier.
  const idRe = new RegExp(`<(?:\\w+:)?Identifier>\\s*${layer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</(?:\\w+:)?Identifier>`);
  const hit = idRe.exec(xml);
  if (!hit) return null;
  const idx = hit.index;
  // <Layer> may carry attributes, so search for the opening tag, not a literal.
  const before = xml.slice(0, idx);
  const openRe = /<(?:\w+:)?Layer(?:\s[^>]*)?>/g;
  let start = -1, m;
  while ((m = openRe.exec(before))) start = m.index;
  const endMatch = /<\/(?:\w+:)?Layer>/.exec(xml.slice(idx));
  if (start < 0 || !endMatch) return null;
  const block = xml.slice(start, idx + endMatch.index);
  const hrefs = [...block.matchAll(/xlink:href="([^"]*\/colormaps\/[^"]*\.xml)"/g)].map((m) => m[1]);
  if (!hrefs.length) return null;
  hrefs.sort((a, b) => colormapVersion(b) - colormapVersion(a));
  return hrefs[0];
}

/* Resolved colormap URLs are small and stable; remembering them means the
   capabilities document is fetched at most once, ever, per browser. */
const CACHE_KEY = 'sd-colormap-urls-v1';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(entry) {
  try {
    const all = readCache();
    Object.assign(all, entry);
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* private browsing; the guesses still work */ }
}

let capabilitiesPromise = null;
function capabilitiesText() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = fetchWithTimeout(capabilitiesUrl(), { timeout: 60000 })
      .then((res) => {
        if (!res.ok) throw new Error(`capabilities ${res.status}`);
        return res.text();
      })
      .catch((err) => { capabilitiesPromise = null; throw err; });
  }
  return capabilitiesPromise;
}

const DEFAULT_TIMEOUT = 15000;

export async function fetchWithTimeout(url, { timeout = DEFAULT_TIMEOUT, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal, mode: 'cors', credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find a working (layer, matrixSet) pairing.
 * `candidates` is an ordered list of layer identifiers; the first layer that
 * answers on any matrix set wins, preferring the finest matrix set available.
 */
export async function resolveLayer({ candidates, time = null, ext = 'png', matrixSets = MATRIX_SETS, onProgress }) {
  const attempts = [];
  for (const layer of candidates) {
    for (const matrixSet of matrixSets) {
      const url = buildTileUrl({ layer, matrixSet, time, z: 0, y: 0, x: 0, ext });
      try {
        onProgress?.(`probing ${layer} @ ${matrixSet}`);
        const res = await fetchWithTimeout(url, { timeout: 12000 });
        if (res.ok) {
          const cors = res.headers.get('access-control-allow-origin');
          return { layer, matrixSet, ext, maxZoom: levelOf(matrixSet), cors: cors || null, attempts };
        }
        attempts.push({ layer, matrixSet, status: res.status });
      } catch (err) {
        attempts.push({ layer, matrixSet, error: String(err && err.message || err) });
      }
    }
  }
  return { layer: null, attempts };
}

async function tryColorMap(url) {
  const res = await fetchWithTimeout(url, { timeout: 15000 });
  if (!res.ok) throw new Error(String(res.status));
  return { xml: await res.text(), url };
}

/**
 * Fetch a layer's published palette.
 *
 * Colormap filenames do not reliably match layer identifiers - SEDAC's do,
 * MODIS's do not - so guessing is only the fast path. When every guess misses,
 * the layer's colormap href is read out of NASA's own capabilities document,
 * which is authoritative, and the answer is cached so the cost is paid once.
 */
export async function fetchColorMapXml(layer) {
  const errors = [];

  const cached = readCache()[layer];
  if (cached) {
    try { return await tryColorMap(cached); } catch (err) { errors.push(`cached ${cached} -> ${err.message}`); }
  }

  for (const url of colorMapUrls(layer)) {
    try {
      const hit = await tryColorMap(url);
      writeCache({ [layer]: hit.url });
      return hit;
    } catch (err) {
      errors.push(`${url} -> ${String(err && err.message || err)}`);
    }
  }

  try {
    const href = extractColorMapHref(await capabilitiesText(), layer);
    if (href) {
      const hit = await tryColorMap(href);
      writeCache({ [layer]: hit.url });
      return hit;
    }
    errors.push('capabilities listed no colormap for this layer');
  } catch (err) {
    errors.push(`capabilities -> ${String(err && err.message || err)}`);
  }

  throw new Error(`No colormap available for ${layer}: ${errors.join('; ')}`);
}
