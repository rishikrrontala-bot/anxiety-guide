/**
 * The Shade Debt model.
 *
 * Shade Debt is the portion of a neighbourhood's surface heat that is
 * attributable to missing vegetation, expressed in degrees Celsius. It is
 * derived from the study area's own data rather than from a fixed coefficient:
 * we regress land surface temperature against NDVI across every valid grid cell
 * to obtain that city's cooling slope, then apply it to each cell's shortfall
 * against a local vegetation target.
 *
 * Priority is Shade Debt multiplied by the people living in the cell, giving
 * degree-persons: avoidable heat weighted by who actually benefits from
 * removing it.
 */

import { median, percentile, olsRegression, theilSen } from './stats.js';

/** Default NDVI of bare soil and of full canopy (Carlson & Ripley 1997). */
export const NDVI_SOIL = 0.05;
export const NDVI_VEG = 0.86;
/** Crown area of one established street tree, square metres. */
export const CANOPY_PER_TREE_M2 = 50;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Fractional vegetation cover from NDVI.
 * Carlson, T.N. & Ripley, D.A. (1997), "On the relation between NDVI,
 * fractional vegetation cover, and leaf area index", Remote Sensing of
 * Environment 62(3), 241-252.
 */
export function fractionalVegetationCover(ndvi, ndviSoil = NDVI_SOIL, ndviVeg = NDVI_VEG) {
  if (!Number.isFinite(ndvi)) return null;
  const scaled = clamp((ndvi - ndviSoil) / (ndviVeg - ndviSoil), 0, 1);
  return scaled * scaled;
}

/**
 * Calibrate the local relationship between vegetation and surface temperature.
 * Theil-Sen supplies the slope (resistant to cloud-edge and water outliers);
 * OLS supplies R-squared so the strength of the relationship is reportable.
 */
export function calibrateCoolingSlope(cells) {
  const xs = [], ys = [];
  for (const c of cells) {
    if (Number.isFinite(c.ndvi) && Number.isFinite(c.lstDay)) { xs.push(c.ndvi); ys.push(c.lstDay); }
  }
  const robust = theilSen(xs, ys);
  const ols = olsRegression(xs, ys);
  if (!robust || !ols) return null;
  return {
    slope: robust.slope,           // degrees C per unit NDVI (expected negative)
    intercept: robust.intercept,
    r2: ols.r2,
    olsSlope: ols.slope,
    n: ols.n,
    points: xs.map((x, i) => ({ ndvi: x, lst: ys[i] })),
  };
}

/** Degrees of avoidable heat for one cell. Never negative: greener-than-target cells owe nothing. */
export function shadeDebtFor(ndvi, ndviTarget, slope) {
  if (!Number.isFinite(ndvi) || !Number.isFinite(ndviTarget) || !Number.isFinite(slope)) return null;
  if (slope >= 0) return 0; // no cooling relationship detected; claim nothing
  const gap = Math.max(0, ndviTarget - ndvi);
  return -slope * gap;
}

/** Trees required to close a cell's vegetation gap. */
export function treesToCloseGap(ndvi, ndviTarget, areaKm2, canopyPerTree = CANOPY_PER_TREE_M2) {
  const have = fractionalVegetationCover(ndvi);
  const want = fractionalVegetationCover(ndviTarget);
  if (have == null || want == null || !Number.isFinite(areaKm2)) return null;
  const gap = Math.max(0, want - have);
  return Math.round((gap * areaKm2 * 1e6) / canopyPerTree);
}

/**
 * Run the full model over a sampled grid.
 * Each input cell carries { ndvi, lstDay, lstNight, popDensity, areaKm2 } plus
 * whatever geometry the caller attached; everything is returned untouched
 * alongside the derived fields.
 */
export function analyseGrid(cells, options = {}) {
  const targetPercentile = options.targetPercentile ?? 0.75;
  const canopyPerTree = options.canopyPerTree ?? CANOPY_PER_TREE_M2;

  const calibration = calibrateCoolingSlope(cells);
  const ndviValues = cells.map((c) => c.ndvi).filter(Number.isFinite);
  const ndviTarget = ndviValues.length ? percentile(ndviValues, targetPercentile) : null;
  const nightMedian = median(cells.map((c) => c.lstNight));
  const dayMedian = median(cells.map((c) => c.lstDay));
  const slope = calibration ? calibration.slope : null;
  const havePopulation = cells.some((c) => Number.isFinite(c.popDensity));

  const scored = cells.map((c) => {
    const debt = slope != null ? shadeDebtFor(c.ndvi, ndviTarget, slope) : null;
    const population = Number.isFinite(c.popDensity) && Number.isFinite(c.areaKm2)
      ? c.popDensity * c.areaKm2 : null;
    const degreePersons = debt != null && population != null ? debt * population : null;
    return {
      ...c,
      shadeDebt: debt,
      population,
      degreePersons,
      trees: treesToCloseGap(c.ndvi, ndviTarget, c.areaKm2, canopyPerTree),
      nightExcess: Number.isFinite(c.lstNight) && nightMedian != null ? c.lstNight - nightMedian : null,
      dayExcess: Number.isFinite(c.lstDay) && dayMedian != null ? c.lstDay - dayMedian : null,
      // Day-night spread is a proxy for thermal mass: hard surfaces hold heat
      // into the night, which is when heat illness accumulates.
      thermalMass: Number.isFinite(c.lstDay) && Number.isFinite(c.lstNight) ? c.lstDay - c.lstNight : null,
    };
  });

  const rankKey = havePopulation ? 'degreePersons' : 'shadeDebt';
  const ranked = scored
    .filter((c) => Number.isFinite(c[rankKey]) && c[rankKey] > 0)
    .sort((a, b) => b[rankKey] - a[rankKey]);

  const valid = scored.filter((c) => Number.isFinite(c.lstDay));
  return {
    cells: scored,
    ranked,
    rankKey,
    calibration,
    summary: {
      ndviTarget,
      dayMedian,
      nightMedian,
      dayMax: valid.length ? Math.max(...valid.map((c) => c.lstDay)) : null,
      dayMin: valid.length ? Math.min(...valid.map((c) => c.lstDay)) : null,
      spread: valid.length ? Math.max(...valid.map((c) => c.lstDay)) - Math.min(...valid.map((c) => c.lstDay)) : null,
      validCells: valid.length,
      totalCells: cells.length,
      coverage: cells.length ? valid.length / cells.length : 0,
      havePopulation,
      maxShadeDebt: scored.reduce((m, c) => (Number.isFinite(c.shadeDebt) ? Math.max(m, c.shadeDebt) : m), 0),
      totalDegreePersons: scored.reduce((a, c) => a + (Number.isFinite(c.degreePersons) ? c.degreePersons : 0), 0),
    },
  };
}

/** Headline figures for the top N sites: trees, people reached, heat avoided. */
export function interventionTotals(ranked, topN = 5) {
  const top = ranked.slice(0, topN);
  const trees = top.reduce((a, c) => a + (Number.isFinite(c.trees) ? c.trees : 0), 0);
  const people = top.reduce((a, c) => a + (Number.isFinite(c.population) ? c.population : 0), 0);
  const degreePersons = top.reduce((a, c) => a + (Number.isFinite(c.degreePersons) ? c.degreePersons : 0), 0);
  const debts = top.map((c) => c.shadeDebt).filter(Number.isFinite);
  return {
    sites: top.length,
    trees,
    people,
    degreePersons,
    meanShadeDebt: debts.length ? debts.reduce((a, b) => a + b, 0) / debts.length : null,
    maxShadeDebt: debts.length ? Math.max(...debts) : null,
  };
}
