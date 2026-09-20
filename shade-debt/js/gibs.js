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
export const COLORMAP_BASES = [`${GIBS_BASE}/colormaps/v1.3`, `${GIBS_BASE}/colormaps/v1.0`];

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

export function colorMapUrls(layer) {
  return COLORMAP_BASES.map((base) => `${base}/${layer}.xml`);
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

/** Fetch and parse a layer's published palette, trying each colormap version. */
export async function fetchColorMapXml(layer) {
  const errors = [];
  for (const url of colorMapUrls(layer)) {
    try {
      const res = await fetchWithTimeout(url, { timeout: 12000 });
      if (res.ok) return { xml: await res.text(), url };
      errors.push(`${url} -> ${res.status}`);
    } catch (err) {
      errors.push(`${url} -> ${String(err && err.message || err)}`);
    }
  }
  throw new Error(`No colormap available for ${layer}: ${errors.join('; ')}`);
}
