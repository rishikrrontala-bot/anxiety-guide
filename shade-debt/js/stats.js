/**
 * Statistics for the heat/vegetation model.
 * Pure functions - no DOM, no network.
 */

export function finiteOnly(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function mean(values) {
  const v = finiteOnly(values);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function median(values) {
  const v = finiteOnly(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Linear-interpolated percentile, p in [0,1]. */
export function percentile(values, p) {
  const v = finiteOnly(values).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const idx = (v.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return v[lo];
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export function stdDev(values) {
  const v = finiteOnly(values);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Ordinary least squares. Returns null when the inputs cannot support a fit. */
export function olsRegression(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

/**
 * Theil-Sen estimator: the median of all pairwise slopes.
 * Resistant to the outliers that cloud edges and water bodies introduce into
 * satellite grids, where OLS would be dragged off by a handful of pixels.
 * Large inputs are strided down to keep the pair count tractable.
 */
export function theilSen(xs, ys, maxPoints = 600) {
  let pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return null;
  if (pairs.length > maxPoints) {
    const stride = pairs.length / maxPoints;
    const sampled = [];
    for (let i = 0; i < maxPoints; i++) sampled.push(pairs[Math.floor(i * stride)]);
    pairs = sampled;
  }
  const slopes = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const dx = pairs[j][0] - pairs[i][0];
      if (dx === 0) continue;
      slopes.push((pairs[j][1] - pairs[i][1]) / dx);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(pairs.map(([x, y]) => y - slope * x));
  return { slope, intercept, n: pairs.length, pairs: slopes.length };
}

/** Min-max normalisation to [0,1]; a flat input maps to 0. */
export function normalise(values) {
  const v = finiteOnly(values);
  if (!v.length) return values.map(() => null);
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo;
  return values.map((x) => (Number.isFinite(x) ? (span === 0 ? 0 : (x - lo) / span) : null));
}

/**
 * Least-squares trend per decade for an annual series.
 * Used on NASA POWER records to report how fast a location is warming.
 */
export function trendPerDecade(years, values) {
  const fit = olsRegression(years, values);
  if (!fit) return null;
  return { perDecade: fit.slope * 10, perYear: fit.slope, r2: fit.r2, n: fit.n, intercept: fit.intercept };
}
