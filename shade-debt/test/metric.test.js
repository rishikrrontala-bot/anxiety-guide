import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fractionalVegetationCover, shadeDebtFor, treesToCloseGap, calibrateCoolingSlope,
  analyseGrid, interventionTotals, NDVI_SOIL, NDVI_VEG,
} from '../js/metric.js';

function syntheticCity({ slope = -12, n = 60, popDensity = 4000, noise = 0 } = {}) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    const ndvi = 0.05 + (i / n) * 0.7;
    cells.push({
      id: `c${i}`,
      ndvi,
      lstDay: 48 + slope * ndvi + (noise ? ((i % 7) - 3) * noise : 0),
      lstNight: 26 + slope * 0.2 * ndvi,
      popDensity,
      areaKm2: 1,
      centre: { lat: 40 + i * 0.001, lng: -74 - i * 0.001 },
      bounds: { north: 40.01, south: 40, east: -74, west: -74.01 },
    });
  }
  return cells;
}

test('fractional vegetation cover spans exactly zero to one', () => {
  assert.equal(fractionalVegetationCover(NDVI_SOIL), 0);
  assert.equal(fractionalVegetationCover(NDVI_VEG), 1);
  assert.equal(fractionalVegetationCover(-1), 0, 'below bare soil is clamped');
  assert.equal(fractionalVegetationCover(2), 1, 'above full canopy is clamped');
  assert.equal(fractionalVegetationCover(null), null);
});

test('fractional vegetation cover is non-linear, as the source formula requires', () => {
  const mid = (NDVI_SOIL + NDVI_VEG) / 2;
  assert.ok(Math.abs(fractionalVegetationCover(mid) - 0.25) < 1e-9, 'the midpoint is squared, not halved');
});

test('shade debt is never negative', () => {
  assert.equal(shadeDebtFor(0.9, 0.6, -10), 0, 'a greener-than-target cell owes nothing');
  assert.ok(shadeDebtFor(0.2, 0.6, -10) > 0);
});

test('shade debt is exactly the gap times the measured slope', () => {
  assert.ok(Math.abs(shadeDebtFor(0.2, 0.6, -10) - 4) < 1e-9);
});

test('no claim is made when vegetation does not cool this place', () => {
  assert.equal(shadeDebtFor(0.2, 0.6, 0.5), 0, 'a positive slope means the model stays silent');
  assert.equal(shadeDebtFor(null, 0.6, -10), null);
});

test('the calibration recovers the true cooling slope from a synthetic city', () => {
  const cal = calibrateCoolingSlope(syntheticCity({ slope: -12 }));
  assert.ok(Math.abs(cal.slope - (-12)) < 0.2, `got ${cal.slope}`);
  assert.ok(cal.r2 > 0.99);
  assert.equal(cal.points.length, 60);
});

test('the calibration survives noise without losing the signal', () => {
  const cal = calibrateCoolingSlope(syntheticCity({ slope: -8, noise: 0.6 }));
  assert.ok(Math.abs(cal.slope - (-8)) < 1.5, `got ${cal.slope}`);
});

test('tree counts scale with the area to be covered', () => {
  const small = treesToCloseGap(0.1, 0.6, 1);
  const large = treesToCloseGap(0.1, 0.6, 4);
  assert.ok(large > small);
  assert.ok(Math.abs(large / small - 4) < 1e-6);
  assert.equal(treesToCloseGap(0.9, 0.6, 1), 0, 'nothing to plant above the target');
});

test('the full analysis ranks by people exposed, not heat alone', () => {
  const cells = syntheticCity({ n: 40 });
  // The barest cell has the most heat to lose but almost nobody living in it.
  cells[0].popDensity = 1;
  const result = analyseGrid(cells);
  assert.equal(result.rankKey, 'degreePersons');
  assert.notEqual(result.ranked[0].id, cells[0].id, 'an empty hot cell must not top the list');
  const top = result.ranked[0];
  assert.ok(top.degreePersons > 0 && top.population > 0);
});

test('without population the analysis falls back to heat and says so', () => {
  const cells = syntheticCity().map((c) => ({ ...c, popDensity: null }));
  const result = analyseGrid(cells);
  assert.equal(result.rankKey, 'shadeDebt');
  assert.equal(result.summary.havePopulation, false);
  assert.ok(result.ranked.length > 0);
});

test('summary figures describe the grid that was actually decoded', () => {
  const cells = syntheticCity({ n: 30 });
  cells[0].lstDay = null;          // a clouded cell
  cells[1].lstDay = null;
  const result = analyseGrid(cells);
  assert.equal(result.summary.totalCells, 30);
  assert.equal(result.summary.validCells, 28);
  assert.ok(Math.abs(result.summary.coverage - 28 / 30) < 1e-9);
  assert.ok(result.summary.spread > 0);
});

test('night excess is measured against the local median, both signs', () => {
  const result = analyseGrid(syntheticCity({ n: 20 }));
  const excesses = result.cells.map((c) => c.nightExcess).filter(Number.isFinite);
  assert.ok(Math.max(...excesses) > 0 && Math.min(...excesses) < 0);
});

test('an entirely clouded grid degrades instead of throwing', () => {
  const cells = syntheticCity({ n: 10 }).map((c) => ({ ...c, lstDay: null, ndvi: null }));
  const result = analyseGrid(cells);
  assert.equal(result.calibration, null);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.summary.validCells, 0);
});

test('intervention totals sum only the top sites', () => {
  const result = analyseGrid(syntheticCity({ n: 40 }));
  const five = interventionTotals(result.ranked, 5);
  const ten = interventionTotals(result.ranked, 10);
  assert.equal(five.sites, 5);
  assert.ok(ten.trees >= five.trees);
  assert.ok(five.maxShadeDebt >= five.meanShadeDebt);
});
