import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTileUrl, tileUrl, colorMapUrls, levelOf, MATRIX_SETS, WMTS_3857,
  extractColorMapHref, platformAgnostic, capabilitiesUrl,
  parseDirectoryIndex, bestColorMapMatch, colorMapNameCandidates,
} from '../js/gibs.js';

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

test('colormap lookups try each published version, most likely first', () => {
  const urls = colorMapUrls('MODIS_Terra_NDVI_8Day');
  assert.match(urls[0], /colormaps\/v1\.3\/MODIS_Terra_NDVI_8Day\.xml$/, 'exact id, newest version first');
  assert.ok(urls.some((u) => /colormaps\/v1\.0\//.test(u)), 'older version is still tried');
});

/* Shaped like a GIBS WMTS capabilities document. Colormap filenames do not
   reliably match layer identifiers, which is why this path exists at all. */
const CAPS = `<Contents>
  <Layer>
    <ows:Title xml:lang="en">Population Density</ows:Title>
    <ows:Identifier>GPW_Population_Density_2020</ows:Identifier>
    <ows:Metadata xlink:type="simple" xlink:role="http://earthdata.nasa.gov/gibs/metadata-type/colormap"
      xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPW_Population_Density_2020.xml"/>
  </Layer>
  <Layer>
    <ows:Title xml:lang="en">Land Surface Temperature (Day)</ows:Title>
    <ows:Identifier>MODIS_Terra_Land_Surface_Temp_Day</ows:Identifier>
    <ows:Metadata xlink:type="simple" xlink:role="http://earthdata.nasa.gov/gibs/metadata-type/colormap"
      xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.0/MODIS_Land_Surface_Temp.xml"/>
    <ows:Metadata xlink:type="simple" xlink:role="http://earthdata.nasa.gov/gibs/metadata-type/colormap"
      xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Land_Surface_Temp.xml"/>
    <TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level7</TileMatrixSet></TileMatrixSetLink>
  </Layer>
  <Layer>
    <ows:Identifier>Layer_Without_A_Palette</ows:Identifier>
  </Layer>
</Contents>`;

test('a colormap href is read out of the capabilities document', () => {
  const href = extractColorMapHref(CAPS, 'GPW_Population_Density_2020');
  assert.equal(href, 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPW_Population_Density_2020.xml');
});

test('the newest published colormap version wins', () => {
  // The MODIS entry lists v1.0 before v1.3; document order must not decide it.
  const href = extractColorMapHref(CAPS, 'MODIS_Terra_Land_Surface_Temp_Day');
  assert.match(href, /\/v1\.3\//);
});

test('a colormap whose filename does not match the layer id is still found', () => {
  // This is the real case: the layer is MODIS_Terra_..., the palette is not.
  const href = extractColorMapHref(CAPS, 'MODIS_Terra_Land_Surface_Temp_Day');
  assert.ok(!href.includes('MODIS_Terra_'), 'the palette is published under a different name');
  assert.match(href, /MODIS_Land_Surface_Temp\.xml$/);
});

test('each layer gets its own colormap, not a neighbour\'s', () => {
  assert.match(extractColorMapHref(CAPS, 'GPW_Population_Density_2020'), /GPW_/);
  assert.match(extractColorMapHref(CAPS, 'MODIS_Terra_Land_Surface_Temp_Day'), /MODIS_/);
});

test('a layer with no palette, or no such layer, returns null rather than guessing', () => {
  assert.equal(extractColorMapHref(CAPS, 'Layer_Without_A_Palette'), null);
  assert.equal(extractColorMapHref(CAPS, 'No_Such_Layer'), null);
  assert.equal(extractColorMapHref('', 'GPW_Population_Density_2020'), null);
});

test('the platform-agnostic fallback strips the satellite, and only that', () => {
  assert.equal(platformAgnostic('MODIS_Terra_Land_Surface_Temp_Day'), 'MODIS_Land_Surface_Temp_Day');
  assert.equal(platformAgnostic('MODIS_Aqua_NDVI_8Day'), 'MODIS_NDVI_8Day');
  assert.equal(platformAgnostic('VIIRS_SNPP_CorrectedReflectance_TrueColor'), 'VIIRS_CorrectedReflectance_TrueColor');
  assert.equal(platformAgnostic('GPW_Population_Density_2020'), 'GPW_Population_Density_2020', 'nothing to strip');
});

test('guessed colormap URLs cover both naming conventions across every version', () => {
  const urls = colorMapUrls('MODIS_Terra_Land_Surface_Temp_Day');
  assert.ok(urls.some((u) => u.endsWith('/v1.3/MODIS_Terra_Land_Surface_Temp_Day.xml')), 'exact id');
  assert.ok(urls.some((u) => u.endsWith('/v1.3/MODIS_Land_Surface_Temp_Day.xml')), 'platform stripped');
  assert.equal(new Set(urls).size, urls.length, 'no duplicate requests');
  // A layer with no platform to strip asks for exactly half as many URLs.
  assert.equal(colorMapUrls('GPW_Population_Density_2020').length, urls.length / 2);
});

test('an indented or line-wrapped identifier is still matched', () => {
  // A real capabilities document is pretty-printed; an exact string match on
  // "<ows:Identifier>NAME</ows:Identifier>" silently misses it.
  const wrapped = `<Contents>
    <Layer>
      <ows:Identifier>
        MODIS_Terra_Land_Surface_Temp_Day
      </ows:Identifier>
      <ows:Metadata xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.3/Some_Other_Name.xml"/>
    </Layer>
  </Contents>`;
  assert.match(extractColorMapHref(wrapped, 'MODIS_Terra_Land_Surface_Temp_Day'), /Some_Other_Name\.xml$/);
});

test('a <Layer> element carrying attributes is still bounded correctly', () => {
  const withAttrs = `<Layer xmlns="x" id="7">
      <ows:Identifier>A_Layer</ows:Identifier>
      <ows:Metadata xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.3/A.xml"/>
    </Layer>
    <Layer><ows:Identifier>B_Layer</ows:Identifier>
      <ows:Metadata xlink:href="https://gibs.earthdata.nasa.gov/colormaps/v1.3/B.xml"/></Layer>`;
  assert.match(extractColorMapHref(withAttrs, 'A_Layer'), /\/A\.xml$/);
  assert.match(extractColorMapHref(withAttrs, 'B_Layer'), /\/B\.xml$/, 'must not bleed into the previous layer');
});

test('the capabilities document is requested from the matching projection', () => {
  assert.equal(capabilitiesUrl(), `${WMTS_3857}/1.0.0/WMTSCapabilities.xml`);
});

/* ---------------------------------------------------------------------------
 * Colormap directory discovery.
 *
 * Colormap filenames do not match layer identifiers: NASA's own documentation
 * pairs the AMSRU2_* layers with AMSR_Surface_Precipitation.xml. Palettes are
 * named after the product and shared between the satellites carrying it, so
 * the filename has to be discovered rather than constructed.
 * ------------------------------------------------------------------------ */

/** Shaped like an Apache autoindex, which is what GIBS serves. */
const INDEX_HTML = `<html><head><title>Index of /colormaps/v1.3</title></head><body>
<h1>Index of /colormaps/v1.3</h1><pre><a href="../">../</a>
<a href="AIRS_Prata_SO2_Index_Day.xml">AIRS_Prata_SO2_Index_Day.xml</a>   2024-01-02  12K
<a href="AMSR_Surface_Precipitation.xml">AMSR_Surface_Precipitation.xml</a> 2024-01-02  8.0K
<a href="MODIS_Land_Surface_Temp.xml">MODIS_Land_Surface_Temp.xml</a>     2024-01-02  30K
<a href="MODIS_Land_Surface_Temp_Day.xml">MODIS_Land_Surface_Temp_Day.xml</a> 2024-01-02 30K
<a href="MODIS_Land_Surface_Temp_Night.xml">MODIS_Land_Surface_Temp_Night.xml</a> 2024-01-02 30K
<a href="MODIS_NDVI_8Day.xml">MODIS_NDVI_8Day.xml</a>                 2024-01-02  20K
<a href="GPW_Population_Density_2020.xml">GPW_Population_Density_2020.xml</a> 2024-01-02 4.0K
<a href="VIIRS_Night_Lights.xml">VIIRS_Night_Lights.xml</a>           2024-01-02  6.0K
<a href="notes.txt">notes.txt</a>
</pre></body></html>`;

test('a directory index yields every xml filename and nothing else', () => {
  const files = parseDirectoryIndex(INDEX_HTML);
  assert.equal(files.length, 8);
  assert.ok(files.includes('MODIS_Land_Surface_Temp_Day.xml'));
  assert.ok(!files.some((f) => f.endsWith('.txt')), 'non-xml links are ignored');
  assert.ok(!files.includes('../'), 'the parent link is ignored');
});

test('index parsing survives quoting, paths and empty input', () => {
  assert.deepEqual(parseDirectoryIndex(`<a href='/colormaps/v1.3/A_B.xml'>x</a>`), ['A_B.xml']);
  assert.deepEqual(parseDirectoryIndex('<a HREF="C.xml">c</a>'), ['C.xml'], 'attribute case');
  assert.deepEqual(parseDirectoryIndex('<a href="A.xml">1</a><a href="A.xml">2</a>'), ['A.xml'], 'deduplicated');
  assert.deepEqual(parseDirectoryIndex(''), []);
  assert.deepEqual(parseDirectoryIndex(null), []);
});

test('a layer is matched to the palette its product publishes', () => {
  const files = parseDirectoryIndex(INDEX_HTML);
  assert.equal(bestColorMapMatch('MODIS_Terra_Land_Surface_Temp_Day', files), 'MODIS_Land_Surface_Temp_Day.xml');
  assert.equal(bestColorMapMatch('MODIS_Aqua_Land_Surface_Temp_Day', files), 'MODIS_Land_Surface_Temp_Day.xml');
  assert.equal(bestColorMapMatch('MODIS_Terra_NDVI_8Day', files), 'MODIS_NDVI_8Day.xml');
  assert.equal(bestColorMapMatch('GPW_Population_Density_2020', files), 'GPW_Population_Density_2020.xml');
});

test('the most specific candidate wins over a shorter prefix', () => {
  // MODIS_Land_Surface_Temp.xml is also a valid subset; the day-specific
  // palette is the correct answer and must not be beaten by the shorter name.
  const files = parseDirectoryIndex(INDEX_HTML);
  assert.equal(bestColorMapMatch('MODIS_Terra_Land_Surface_Temp_Day', files), 'MODIS_Land_Surface_Temp_Day.xml');
});

test('day never matches night, in either direction', () => {
  const files = parseDirectoryIndex(INDEX_HTML);
  assert.equal(bestColorMapMatch('MODIS_Terra_Land_Surface_Temp_Night', files), 'MODIS_Land_Surface_Temp_Night.xml');
  assert.notEqual(bestColorMapMatch('MODIS_Terra_Land_Surface_Temp_Day', files), 'MODIS_Land_Surface_Temp_Night.xml');
});

test('a different product family is never borrowed from', () => {
  const files = parseDirectoryIndex(INDEX_HTML);
  // AIRS and AMSR share tokens with nothing here; VIIRS must not take a MODIS palette.
  assert.equal(bestColorMapMatch('VIIRS_SNPP_Land_Surface_Temp_Day', files), null,
    'no VIIRS temperature palette exists, so nothing is returned');
  assert.equal(bestColorMapMatch('SomeProduct_Unrelated_Layer', files), null);
});

test('an empty or missing index returns nothing rather than a wrong guess', () => {
  assert.equal(bestColorMapMatch('MODIS_Terra_NDVI_8Day', []), null);
  assert.equal(bestColorMapMatch('MODIS_Terra_NDVI_8Day', null), null);
  assert.equal(bestColorMapMatch('', ['MODIS_NDVI_8Day.xml']), null);
});

test('matching is case-insensitive about separators but not about identity', () => {
  const files = ['MODIS-Land-Surface-Temp-Day.xml'];
  assert.equal(bestColorMapMatch('MODIS_Terra_Land_Surface_Temp_Day', files), 'MODIS-Land-Surface-Temp-Day.xml');
});

/* ---------------------------------------------------------------------------
 * Progressive name candidates.
 *
 * The directory index is exact but is an HTML listing, and a static listing
 * need not carry CORS headers even where the XML files beside it do. These
 * candidates ask only for colormap documents, which are known to be reachable
 * cross-origin, so the palette is still found when the index is not readable.
 * ------------------------------------------------------------------------ */

test('the exact layer name is always tried first', () => {
  assert.equal(colorMapNameCandidates('GPW_Population_Density_2020')[0], 'GPW_Population_Density_2020');
  assert.equal(colorMapNameCandidates('MODIS_Terra_NDVI_8Day')[0], 'MODIS_Terra_NDVI_8Day');
});

test('the satellite-stripped name is tried second, being the likeliest answer', () => {
  assert.equal(colorMapNameCandidates('MODIS_Terra_Land_Surface_Temp_Day')[1], 'MODIS_Land_Surface_Temp_Day');
  assert.equal(colorMapNameCandidates('MODIS_Terra_NDVI_8Day')[1], 'MODIS_NDVI_8Day');
  assert.equal(colorMapNameCandidates('MODIS_Aqua_Land_Surface_Temp_Night')[1], 'MODIS_Land_Surface_Temp_Night');
});

test('a day layer can never reach a night palette, and vice versa', () => {
  // Tokens are only ever dropped from the end, never substituted.
  for (const name of colorMapNameCandidates('MODIS_Terra_Land_Surface_Temp_Day')) {
    assert.ok(!/night/i.test(name), `${name} must not appear for a Day layer`);
  }
  for (const name of colorMapNameCandidates('MODIS_Terra_Land_Surface_Temp_Night')) {
    assert.ok(!/_Day\b/i.test(name), `${name} must not appear for a Night layer`);
  }
});

test('candidates never shrink to a meaningless stub', () => {
  // "MODIS_Terra" names no product and could collide with anything.
  for (const name of colorMapNameCandidates('MODIS_Terra_Land_Surface_Temp_Day')) {
    assert.ok(name.split('_').length >= 3, `${name} is too short to identify a product`);
  }
});

test('the candidate list is bounded and free of duplicates', () => {
  const long = colorMapNameCandidates('VIIRS_SNPP_DayNightBand_At_Sensor_Radiance');
  assert.ok(long.length <= 8, `expected a bounded list, got ${long.length}`);
  assert.equal(new Set(long).size, long.length, 'no candidate is requested twice');
});

test('a layer with nothing to strip still yields sensible candidates', () => {
  const c = colorMapNameCandidates('GPW_Population_Density_2020');
  assert.equal(c[0], 'GPW_Population_Density_2020');
  assert.ok(c.every((n) => n.split('_').length >= 3));
  assert.equal(new Set(c).size, c.length);
});

test('empty and malformed layer names yield nothing rather than junk', () => {
  assert.deepEqual(colorMapNameCandidates(''), []);
  assert.deepEqual(colorMapNameCandidates(null), []);
  assert.deepEqual(colorMapNameCandidates('___'), []);
});

test('a two-token layer is not discarded by the minimum length rule', () => {
  const c = colorMapNameCandidates('Some_Layer');
  assert.ok(c.includes('Some_Layer'), 'the exact name must survive');
});
