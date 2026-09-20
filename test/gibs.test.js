import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTileUrl, tileUrl, colorMapUrls, levelOf, MATRIX_SETS, WMTS_3857 } from '../js/gibs.js';

test('a time-varying layer gets a TIME segment', () => {
  const url = buildTileUrl({
    layer: 'MODIS_Terra_Land_Surface_Temp_Day', matrixSet: 'GoogleMapsCompatible_Level7',
    time: '2026-08-01', z: 7, y: 48, x: 37, ext: 'png',
  });
  assert.equal(url,
    `${WMTS_3857}/MODIS_Terra_Land_Surface_Temp_Day/default/2026-08-01/GoogleMapsCompatible_Level7/7/48/37.png`);
});

test('a layer with no time dimension omits the TIME segment entirely', () => {
  // GIBS rejects a TIME segment on layers that have no time dimension, so the
  // URL must be built without one rather than with a placeholder.
  const url = buildTileUrl({
    layer: 'GPW_Population_Density_2020', matrixSet: 'GoogleMapsCompatible_Level7',
    time: null, z: 0, y: 0, x: 0, ext: 'png',
  });
  assert.equal(url, `${WMTS_3857}/GPW_Population_Density_2020/default/GoogleMapsCompatible_Level7/0/0/0.png`);
  assert.ok(!url.includes('//GoogleMaps'), 'no empty path segment is left behind');
  assert.ok(!url.includes('default/default'));
});

test('the WMTS path puts row before column, as the standard requires', () => {
  const url = buildTileUrl({ layer: 'L', matrixSet: 'M', time: null, z: 5, y: 11, x: 22, ext: 'png' });
  assert.ok(url.endsWith('/5/11/22.png'), 'z / row(y) / col(x)');
});

test('tileUrl carries a resolved layer through unchanged', () => {
  const resolved = { layer: 'L', matrixSet: 'GoogleMapsCompatible_Level9', ext: 'jpg', urlBase: WMTS_3857 };
  assert.equal(tileUrl(resolved, '2026-01-01', 3, 1, 2),
    `${WMTS_3857}/L/default/2026-01-01/GoogleMapsCompatible_Level9/3/2/1.jpg`);
  assert.equal(tileUrl(resolved, null, 3, 1, 2),
    `${WMTS_3857}/L/default/GoogleMapsCompatible_Level9/3/2/1.jpg`);
});

test('matrix set levels parse, and the probe order runs finest first', () => {
  assert.equal(levelOf('GoogleMapsCompatible_Level9'), 9);
  assert.equal(levelOf('GoogleMapsCompatible_Level13'), 13);
  assert.equal(levelOf('nonsense'), null);
  const levels = MATRIX_SETS.map(levelOf);
  assert.deepEqual(levels, [...levels].sort((a, b) => b - a), 'finest resolution is tried first');
});

test('colormap lookups try each published version', () => {
  const urls = colorMapUrls('MODIS_Terra_NDVI_8Day');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /colormaps\/v1\.3\/MODIS_Terra_NDVI_8Day\.xml$/);
  assert.match(urls[1], /colormaps\/v1\.0\//);
});
