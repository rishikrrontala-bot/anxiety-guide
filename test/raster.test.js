import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleCell, sampleGrid, chooseZoom } from '../js/raster.js';
import { buildGrid, tileRangeForBounds, tileCount } from '../js/geo.js';

const BOUNDS = { north: 40.2, south: 40.0, east: -74.0, west: -74.2 };

/** A stitched-canvas stand-in: the sampler only reads imageData, width, height, originPx, zoom. */
function fakeRaster(grid, paint) {
  const first = grid.cells[0];
  const last = grid.cells[grid.cells.length - 1];
  const originPx = { x: first.px.x0, y: first.px.y0 };
  const width = Math.ceil(last.px.x1 - originPx.x);
  const height = Math.ceil(last.px.y1 - originPx.y);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { imageData: { data, width, height }, width, height, originPx, zoom: grid.zoom };
}

const IDENTITY_LUT = { lookup: (r, g, b, a) => (a < 8 ? null : r) };

test('a uniform raster decodes to that value in every cell', () => {
  const grid = buildGrid(BOUNDS, 9, 4);
  const raster = fakeRaster(grid, () => [120, 0, 0, 255]);
  const { values, valid, total } = sampleGrid(raster, grid, IDENTITY_LUT);
  assert.equal(valid, total);
  for (const v of values.values()) assert.equal(v, 120);
});

test('fully transparent pixels leave a cell undecoded', () => {
  const grid = buildGrid(BOUNDS, 9, 4);
  const raster = fakeRaster(grid, () => [120, 0, 0, 0]);
  const { valid } = sampleGrid(raster, grid, IDENTITY_LUT);
  assert.equal(valid, 0, 'cloud and fill must not become measurements');
});

test('a cell takes the median, so a few stray pixels cannot move it', () => {
  const grid = buildGrid(BOUNDS, 9, 8);
  // Mostly 100, with a bright stripe of 255 down the left edge.
  const raster = fakeRaster(grid, (x) => (x < 2 ? [255, 0, 0, 255] : [100, 0, 0, 255]));
  const r = sampleCell(raster, grid.cells[0], IDENTITY_LUT);
  assert.equal(r.value, 100, 'the median resists the stripe');
  assert.ok(r.valid > 0);
});

test('partially clouded cells decode from the pixels that remain', () => {
  const grid = buildGrid(BOUNDS, 9, 8);
  const raster = fakeRaster(grid, (x, y) => ((x + y) % 2 ? [90, 0, 0, 255] : [0, 0, 0, 0]));
  const r = sampleCell(raster, grid.cells[0], IDENTITY_LUT);
  assert.equal(r.value, 90);
  assert.ok(r.valid < r.samples, 'some samples were masked out');
});

test('a cell outside the raster decodes to nothing rather than reading stray memory', () => {
  const grid = buildGrid(BOUNDS, 9, 4);
  const raster = fakeRaster(grid, () => [120, 0, 0, 255]);
  const far = { ...grid.cells[0], px: { x0: 1e6, y0: 1e6, x1: 1e6 + 4, y1: 1e6 + 4, zoom: grid.zoom } };
  assert.deepEqual(sampleCell(raster, far, IDENTITY_LUT), { value: null, samples: 0, valid: 0 });
});

test('sampling cost is bounded however large the cell', () => {
  const grid = buildGrid(BOUNDS, 9, 64);
  const raster = fakeRaster(grid, () => [10, 0, 0, 255]);
  const r = sampleCell(raster, grid.cells[0], IDENTITY_LUT, 8);
  assert.ok(r.samples <= 81, `a 64px cell took ${r.samples} samples`);
});

test('chooseZoom respects the tile budget and prefers the finest zoom that fits', () => {
  const z = chooseZoom(BOUNDS, 12, 36);
  assert.ok(tileCount(tileRangeForBounds(BOUNDS, z)) <= 36);
  if (z < 12) {
    assert.ok(tileCount(tileRangeForBounds(BOUNDS, z + 1)) > 36, 'one level finer would not have fit');
  }
});

test('a tight budget still returns a usable zoom rather than failing', () => {
  const z = chooseZoom({ north: 60, south: -60, east: 170, west: -170 }, 12, 4);
  assert.ok(z >= 0 && z <= 12);
  assert.ok(tileCount(tileRangeForBounds({ north: 60, south: -60, east: 170, west: -170 }, z)) <= 4);
});
