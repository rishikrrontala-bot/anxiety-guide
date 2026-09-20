/**
 * Web Mercator (EPSG:3857) tile and pixel math.
 * Pure functions - no DOM, no network. Shared by the browser app and the test suite.
 */

export const EARTH_CIRCUMFERENCE_M = 40075016.686;
export const TILE_SIZE = 256;

/** Web Mercator cannot represent the poles; clamp to the standard limit. */
export function clampLat(lat) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

export function worldSize(zoom) {
  return TILE_SIZE * Math.pow(2, zoom);
}

/** Geographic coordinate -> absolute pixel coordinate at a given zoom. */
export function lngLatToWorldPx(lng, lat, zoom) {
  const size = worldSize(zoom);
  const x = ((lng + 180) / 360) * size;
  const sinLat = Math.sin((clampLat(lat) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size;
  return { x, y };
}

/** Absolute pixel coordinate at a given zoom -> geographic coordinate. */
export function worldPxToLngLat(x, y, zoom) {
  const size = worldSize(zoom);
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat };
}

/** Ground resolution in metres per pixel at a given latitude and zoom. */
export function metresPerPixel(lat, zoom) {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((clampLat(lat) * Math.PI) / 180)) / worldSize(zoom);
}

/**
 * Smallest zoom level at which `bounds` spans at least `minPx` pixels on its
 * shorter side, capped at `maxZoom`. Used to pick an analysis zoom that yields
 * enough grid cells for a regression without oversampling the sensor.
 */
export function zoomForBounds(bounds, minPx, maxZoom) {
  for (let z = 0; z <= maxZoom; z++) {
    const a = lngLatToWorldPx(bounds.west, bounds.north, z);
    const b = lngLatToWorldPx(bounds.east, bounds.south, z);
    if (Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) >= minPx) return z;
  }
  return maxZoom;
}

/** Inclusive XYZ tile range covering `bounds` at `zoom`. */
export function tileRangeForBounds(bounds, zoom) {
  const nw = lngLatToWorldPx(bounds.west, bounds.north, zoom);
  const se = lngLatToWorldPx(bounds.east, bounds.south, zoom);
  const n = Math.pow(2, zoom);
  const clampTile = (v) => Math.max(0, Math.min(n - 1, v));
  return {
    x0: clampTile(Math.floor(nw.x / TILE_SIZE)),
    y0: clampTile(Math.floor(nw.y / TILE_SIZE)),
    x1: clampTile(Math.floor((se.x - 1e-9) / TILE_SIZE)),
    y1: clampTile(Math.floor((se.y - 1e-9) / TILE_SIZE)),
    zoom,
  };
}

export function tileCount(range) {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}

/**
 * Build an analysis grid over `bounds`. Cell size is expressed in pixels at
 * `zoom`, so one cell maps onto a whole number of native sensor pixels.
 */
export function buildGrid(bounds, zoom, cellPx = 1) {
  const nw = lngLatToWorldPx(bounds.west, bounds.north, zoom);
  const se = lngLatToWorldPx(bounds.east, bounds.south, zoom);
  const x0 = Math.floor(nw.x), y0 = Math.floor(nw.y);
  const x1 = Math.ceil(se.x), y1 = Math.ceil(se.y);
  const cols = Math.max(1, Math.floor((x1 - x0) / cellPx));
  const rows = Math.max(1, Math.floor((y1 - y0) / cellPx));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px0 = x0 + c * cellPx, py0 = y0 + r * cellPx;
      const px1 = px0 + cellPx, py1 = py0 + cellPx;
      const a = worldPxToLngLat(px0, py0, zoom);
      const b = worldPxToLngLat(px1, py1, zoom);
      const centre = worldPxToLngLat((px0 + px1) / 2, (py0 + py1) / 2, zoom);
      cells.push({
        id: `${r}-${c}`, row: r, col: c,
        px: { x0: px0, y0: py0, x1: px1, y1: py1, zoom },
        bounds: { north: a.lat, west: a.lng, south: b.lat, east: b.lng },
        centre,
      });
    }
  }
  return { zoom, cellPx, rows, cols, cells };
}

/** Approximate ground area of a grid cell in square kilometres. */
export function cellAreaKm2(cell) {
  const mpp = metresPerPixel(cell.centre.lat, cell.px.zoom);
  const w = (cell.px.x1 - cell.px.x0) * mpp;
  const h = (cell.px.y1 - cell.px.y0) * mpp;
  return (w * h) / 1e6;
}

/**
 * Re-project a cell's pixel window from its own zoom into another zoom's pixel
 * space, so a coarse analysis grid can sample a finer-resolution layer.
 */
export function cellPxAtZoom(cell, zoom) {
  const scale = Math.pow(2, zoom - cell.px.zoom);
  return {
    x0: cell.px.x0 * scale, y0: cell.px.y0 * scale,
    x1: cell.px.x1 * scale, y1: cell.px.y1 * scale,
    zoom,
  };
}

/** Expand or shrink geographic bounds about their centre. */
export function padBounds(bounds, factor) {
  const cLat = (bounds.north + bounds.south) / 2;
  const cLng = (bounds.east + bounds.west) / 2;
  const hLat = ((bounds.north - bounds.south) / 2) * factor;
  const hLng = ((bounds.east - bounds.west) / 2) * factor;
  return {
    north: clampLat(cLat + hLat), south: clampLat(cLat - hLat),
    east: cLng + hLng, west: cLng - hLng,
  };
}
