import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsv, toCSV, toGeoJSON, buildLetter } from '../js/exporters.js';
import { analyseGrid, interventionTotals } from '../js/metric.js';

function fixture(n = 30) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    const ndvi = 0.05 + (i / n) * 0.7;
    cells.push({
      id: `c${i}`, ndvi,
      lstDay: 48 - 12 * ndvi, lstNight: 26 - 3 * ndvi,
      popDensity: 4200, areaKm2: 1.1,
      centre: { lat: 40.7 + i * 0.01, lng: -74.1 - i * 0.01 },
      bounds: { north: 40.71 + i * 0.01, south: 40.7 + i * 0.01, east: -74.1 - i * 0.01, west: -74.11 - i * 0.01 },
    });
  }
  const a = analyseGrid(cells);
  a.totals = interventionTotals(a.ranked, 5);
  return a;
}

test('CSV escaping covers commas, quotes and newlines', () => {
  assert.equal(escapeCsv('plain'), 'plain');
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsv('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCsv(null), '');
  assert.equal(escapeCsv(0), '0', 'zero is a value, not an absence');
});

test('a place name containing a comma cannot break the CSV', () => {
  const csv = toCSV(fixture().ranked, { place: 'Newark, New Jersey' });
  assert.ok(csv.includes('"Newark, New Jersey"'));
});

test('CSV has one header row and one row per site', () => {
  const a = fixture();
  const lines = toCSV(a.ranked, {}).split('\n').filter((l) => !l.startsWith('#'));
  assert.equal(lines.length, a.ranked.length + 1);
  assert.match(lines[0], /^Rank,Latitude,Longitude,Shade debt/);
  assert.equal(lines[1].split(',')[0], '1', 'ranks start at one');
});

test('GeoJSON is valid: closed rings, coordinates in lon,lat order', () => {
  const a = fixture();
  const gj = toGeoJSON(a.ranked, { place: 'Test' });
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, a.ranked.length);
  const ring = gj.features[0].geometry.coordinates[0];
  assert.equal(ring.length, 5, 'four corners plus the repeated closing point');
  assert.deepEqual(ring[0], ring[4], 'the ring is closed');
  assert.ok(ring[0][0] < -70 && ring[0][1] > 40, 'longitude first, then latitude');
});

test('GeoJSON carries the provenance a reviewer would ask for', () => {
  const gj = toGeoJSON(fixture().ranked, {
    place: 'Test', generated: '2026-09-20', dates: ['2026-07-01'],
    model: { slopeCPerNdvi: -12, r2: 0.8 }, sources: ['NASA GIBS'],
  });
  assert.equal(gj.metadata.place, 'Test');
  assert.deepEqual(gj.metadata.sourceDates, ['2026-07-01']);
  assert.equal(gj.metadata.model.slopeCPerNdvi, -12);
  assert.match(gj.metadata.note, /not air temperature/i, 'the caveat travels with the data');
});

test('numbers are rounded for humans, not dumped at full float precision', () => {
  const props = toGeoJSON(fixture().ranked, {}).features[0].properties;
  assert.equal(String(props.shadeDebt).split('.')[1]?.length <= 2, true);
  assert.equal(Number.isInteger(props.population), true);
  assert.equal(Number.isInteger(props.trees), true);
});

test('the letter states the measured numbers rather than generic prose', () => {
  const a = fixture();
  const letter = buildLetter({
    place: 'Newark, New Jersey', ranked: a.ranked, summary: a.summary,
    calibration: a.calibration, totals: a.totals,
    dates: ['2026-06-01', '2026-08-15'], generated: '2026-09-20',
  });
  assert.match(letter, /Newark, New Jersey/);
  assert.match(letter, /2026-09-20/);
  assert.match(letter, /Theil-Sen/);
  assert.match(letter, /2 cloud-screened satellite observations \(2026-06-01 to 2026-08-15\)/);
  assert.match(letter, new RegExp(a.ranked[0].centre.lat.toFixed(4)), 'the top site coordinate appears');
  assert.match(letter, /Shade debt: \d+\.\d C/);
});

test('the letter keeps its honesty section', () => {
  const a = fixture();
  const letter = buildLetter({ place: 'X', ranked: a.ranked, summary: a.summary, calibration: a.calibration, totals: a.totals });
  assert.match(letter, /warmer than the air temperature/);
  assert.match(letter, /about one kilometre/);
  assert.match(letter, /neighbourhoods rather than individual\nstreets/);
});

test('the letter degrades gracefully when calibration failed', () => {
  const a = fixture();
  const letter = buildLetter({ place: 'X', ranked: a.ranked, summary: a.summary, calibration: null, totals: a.totals });
  assert.match(letter, /could not be calibrated/);
  assert.ok(!letter.includes('undefined'));
  assert.ok(!letter.includes('NaN'));
});

test('exports survive an empty ranking without producing junk', () => {
  const letter = buildLetter({ place: 'Nowhere', ranked: [], summary: {}, calibration: null, totals: null });
  assert.ok(!letter.includes('undefined'));
  assert.ok(!letter.includes('NaN'));
  assert.equal(toGeoJSON([], {}).features.length, 0);
  assert.equal(toCSV([], {}).split('\n').length, 1, 'header only');
});
