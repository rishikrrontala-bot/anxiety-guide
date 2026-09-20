import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lngLatToWorldPx, worldPxToLngLat, metresPerPixel, tileRangeForBounds, tileCount,
  buildGrid, cellAreaKm2, cellPxAtZoom, clampLat, zoomForBounds, padBounds,
} from '../js/geo.js';

test('the projection round-trips', () => {
  for (const [lng, lat] of [[0, 0], [-74.006, 40.7128], [139.69, 35.69], [18.42, -33.92]]) {
    const px = lngLatToWorldPx(lng, lat, 10);
    const back = worldPxToLngLat(px.x, px.y, 10);
    assert.ok(Math.abs(back.lng - lng) < 1e-6, `lng ${lng} -> ${back.lng}`);
    assert.ok(Math.abs(back.lat - lat) < 1e-6, `lat ${lat} -> ${back.lat}`);
  }
});

test('latitude is clamped to the Mercator limit', () => {
  assert.ok(clampLat(90) < 85.06);
  assert.ok(clampLat(-90) > -85.06);
});

test('zoom 0 is one 256px tile covering the world', () => {
  const p = lngLatToWorldPx(0, 0, 0);
  assert.equal(p.x, 128);
  assert.ok(Math.abs(p.y - 128) < 1e-9);
});

test('ground resolution matches the MODIS thermal footprint at zoom 7', () => {
  // GIBS serves 1 km products on GoogleMapsCompatible_Level7; the analysis
  // relies on one grid cell being roughly one sensor pixel.
  const m = metresPerPixel(40, 7);
  assert.ok(m > 800 && m < 1200, `expected ~1 km, got ${m}`);
});

test('resolution halves with each zoom level', () => {
  assert.ok(Math.abs(metresPerPixel(0, 5) / metresPerPixel(0, 6) - 2) < 1e-9);
});

test('tile ranges cover the requested bounds and stay in the world', () => {
  const bounds = { north: 40.9, south: 40.5, east: -73.7, west: -74.3 };
  const r = tileRangeForBounds(bounds, 10);
  assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0);
  assert.ok(tileCount(r) >= 1);
  const whole = tileRangeForBounds({ north: 85, south: -85, east: 180, west: -180 }, 2);
  assert.equal(tileCount(whole), 16);
});

test('a grid tiles its bounds without gaps or overlaps', () => {
  const bounds = { north: 40.8, south: 40.4, east: -73.8, west: -74.2 };
  const grid = buildGrid(bounds, 9, 2);
  assert.equal(grid.cells.length, grid.rows * grid.cols);
  const first = grid.cells[0];
  const second = grid.cells[1];
  assert.equal(first.px.x1, second.px.x0, 'adjacent cells share an edge');
  assert.ok(first.bounds.north > first.bounds.south);
  assert.ok(first.centre.lat < first.bounds.north && first.centre.lat > first.bounds.south);
});

test('cell area is plausible and shrinks toward the poles', () => {
  const equator = buildGrid({ north: 0.2, south: -0.2, east: 0.2, west: -0.2 }, 7, 1).cells[0];
  const high = buildGrid({ north: 60.2, south: 59.8, east: 0.2, west: -0.2 }, 7, 1).cells[0];
  const a = cellAreaKm2(equator);
  assert.ok(a > 0.5 && a < 3, `equatorial 1 km cell was ${a} km2`);
  assert.ok(cellAreaKm2(high) < a, 'Mercator cells shrink on the ground at high latitude');
});

test('a cell window reprojects cleanly into a finer zoom', () => {
  const cell = buildGrid({ north: 40.2, south: 40.0, east: -74.0, west: -74.2 }, 7, 1).cells[0];
  const finer = cellPxAtZoom(cell, 9);
  assert.equal(finer.zoom, 9);
  assert.equal(finer.x1 - finer.x0, (cell.px.x1 - cell.px.x0) * 4, 'two zoom levels = 4x the pixels');
});

test('zoomForBounds finds a zoom giving at least the requested pixel span', () => {
  const bounds = { north: 40.3, south: 40.0, east: -73.9, west: -74.2 };
  const z = zoomForBounds(bounds, 32, 12);
  const a = lngLatToWorldPx(bounds.west, bounds.north, z);
  const b = lngLatToWorldPx(bounds.east, bounds.south, z);
  assert.ok(Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) >= 32);
});

test('padBounds scales about the centre', () => {
  const b = { north: 1, south: -1, east: 2, west: -2 };
  const p = padBounds(b, 2);
  assert.equal(p.north, 2);
  assert.equal(p.west, -4);
});
