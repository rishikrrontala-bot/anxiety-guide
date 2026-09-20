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

/* ---------------------------------------------------------------------------
 * Real GIBS documents.
 *
 * Everything above tests the parser against fixtures written by hand, which
 * proves only that it matches its own assumptions. These are unmodified files
 * published by NASA, so they catch the failure the hand-written ones cannot:
 * the published format differing from what the parser expects.
 * ------------------------------------------------------------------------ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('a real NASA continuous palette parses, with its units', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(fixture('GHRSST_Sea_Surface_Temperature_Anomalies.xml')));
  assert.ok(primary, 'a palette was found');
  assert.ok(primary.entries.length > 40, `expected a full ramp, got ${primary.entries.length}`);
  assert.equal(primary.units, '°C', 'units come from the document, not a guess');
});

test('every colour in a real NASA palette round-trips to its own value', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(fixture('GHRSST_Sea_Surface_Temperature_Anomalies.xml')));
  const lut = buildLookup(primary);
  for (const entry of primary.entries) {
    assert.equal(lut.lookup(entry.r, entry.g, entry.b, 255), entry.value,
      `rgb(${entry.r},${entry.g},${entry.b}) did not decode back to ${entry.value}`);
  }
});

test('a real palette produces physically sensible values', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(fixture('GHRSST_Sea_Surface_Temperature_Anomalies.xml')));
  const values = primary.entries.map((e) => e.value);
  const min = Math.min(...values), max = Math.max(...values);
  assert.ok(min > -60 && max < 60, `anomalies in degrees C should be a small range, got ${min}..${max}`);
  assert.ok(values.every((v) => Number.isFinite(v)));
});

test('a real multi-block document yields the data palette, not the no-data stub', () => {
  const maps = parseColorMapXml(fixture('ColorMap_v1.2_Sample.xml'));
  assert.ok(maps.length > 1, 'the document really does carry several blocks');
  const primary = pickPrimaryColorMap(maps);
  assert.ok(primary.entries.length > 0);
  assert.ok(maps.some((m) => m.entries.length < primary.entries.length), 'a smaller block was passed over');
});

test('no-data entries in a real document decode to nothing', () => {
  const primary = pickPrimaryColorMap(parseColorMapXml(fixture('GHRSST_Sea_Surface_Temperature_Anomalies.xml')));
  const lut = buildLookup(primary);
  assert.ok(primary.transparentKeys.size > 0, 'the document marks some entries as no-data');
  for (const key of primary.transparentKeys) {
    const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
    assert.equal(lut.lookup(r, g, b, 255), null, 'a no-data colour must never become a measurement');
  }
});
