import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInterval, parseColorMapXml, pickPrimaryColorMap, buildLookup, toCelsius, rgbKey,
} from '../js/colormap.js';

/** Shaped like a real GIBS ColorMap document, including the no-data entry. */
const LST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ColorMaps>
  <ColorMap title="No Data" units="">
    <Entries>
      <ColorMapEntry rgb="0,0,0" transparent="true" sourceValue="[0,1)" value="[0,1)" ref="0"/>
    </Entries>
  </ColorMap>
  <ColorMap title="Land Surface Temperature (Day)" units="K">
    <Legend type="continuous" minLabel="&lt; 255 K" maxLabel="&gt; 320 K">
      <LegendEntry rgb="6,0,110" tooltip="255 K" id="1"/>
    </Legend>
    <Entries>
      <ColorMapEntry rgb="0,0,0" transparent="true" sourceValue="[-9999,-9999]" value="[-9999,-9999]" ref="0"/>
      <ColorMapEntry rgb="6,0,110" transparent="false" sourceValue="[280,281)" value="[280,281)" ref="1"/>
      <ColorMapEntry rgb="120,0,80" transparent="false" sourceValue="[300,301)" value="[300,301)" ref="2"/>
      <ColorMapEntry rgb="255,200,0" transparent="false" sourceValue="[320,321)" value="[320,321)" ref="3"/>
    </Entries>
  </ColorMap>
</ColorMaps>`;

test('value intervals parse in every form GIBS emits', () => {
  assert.deepEqual(parseInterval('[280,281)'), { min: 280, max: 281, representative: 280.5 });
  assert.deepEqual(parseInterval('[5,5]'), { min: 5, max: 5, representative: 5 });
  assert.equal(parseInterval('(-INF,0]').representative, 0);
  assert.equal(parseInterval('[10,+INF)').representative, 10);
  assert.equal(parseInterval('42').representative, 42);
  assert.equal(parseInterval(''), null);
  assert.equal(parseInterval(null), null);
  assert.equal(parseInterval('nonsense'), null);
});

test('the enclosing <ColorMaps> element is not mistaken for a palette', () => {
  const maps = parseColorMapXml(LST_XML);
  assert.equal(maps.length, 2, 'exactly the two ColorMap elements');
});

test('legend entries are ignored, only ColorMapEntry becomes data', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(LST_XML));
  assert.equal(primary.entries.length, 3);
  assert.equal(primary.units, 'K');
});

test('the richest palette wins over a no-data stub', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(LST_XML));
  assert.match(primary.title, /Land Surface Temperature/);
});

test('transparent and no-data entries become the mask, not values', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(LST_XML));
  assert.ok(primary.transparentKeys.has(rgbKey(0, 0, 0)));
  const lut = buildLookup(primary);
  assert.equal(lut.lookup(0, 0, 0, 255), null, 'the no-data colour decodes to nothing');
});

test('an exact palette colour decodes to its interval midpoint', () => {
  const lut = buildLookup(pickPrimaryColorMap(parseColorMapXml(LST_XML)));
  assert.equal(lut.lookup(6, 0, 110, 255), 280.5);
  assert.equal(lut.lookup(255, 200, 0, 255), 320.5);
});

test('a slightly resampled colour snaps to the nearest palette entry', () => {
  const lut = buildLookup(pickPrimaryColorMap(parseColorMapXml(LST_XML)));
  assert.equal(lut.lookup(8, 2, 112, 255), 280.5, 'small drift still decodes');
});

test('a colour far from every palette entry decodes to nothing', () => {
  const lut = buildLookup(pickPrimaryColorMap(parseColorMapXml(LST_XML)), 100);
  assert.equal(lut.lookup(0, 255, 0, 255), null, 'an unrelated colour is not forced to a value');
});

test('fully transparent pixels decode to nothing whatever their colour', () => {
  const lut = buildLookup(pickPrimaryColorMap(parseColorMapXml(LST_XML)));
  assert.equal(lut.lookup(6, 0, 110, 0), null);
});

test('units drive the Kelvin conversion', () => {
  assert.ok(Math.abs(toCelsius(300, 'K') - 26.85) < 1e-6);
  assert.equal(toCelsius(26.85, 'C'), 26.85);
  assert.ok(Math.abs(toCelsius(300, '') - 26.85) < 1e-6, 'missing units fall back to magnitude');
  assert.equal(toCelsius(26.85, ''), 26.85, 'a plausible Celsius value is left alone');
  assert.equal(toCelsius(null, 'K'), null);
});

test('NDVI palettes pass through untouched', () => {
  const xml = `<ColorMaps><ColorMap title="NDVI" units="">
    <Entries>
      <ColorMapEntry rgb="10,10,10" transparent="false" value="[-0.2,-0.1)"/>
      <ColorMapEntry rgb="0,200,0" transparent="false" value="[0.8,0.9)"/>
    </Entries></ColorMap></ColorMaps>`;
  const lut = buildLookup(pickPrimaryColorMap(parseColorMapXml(xml)));
  assert.ok(Math.abs(lut.lookup(0, 200, 0, 255) - 0.85) < 1e-9);
  assert.equal(toCelsius(0.85, ''), 0.85);
});
