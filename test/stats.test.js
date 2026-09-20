import test from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile, mean, stdDev, olsRegression, theilSen, normalise, trendPerDecade } from '../js/stats.js';

test('summary statistics ignore nulls and NaN', () => {
  const messy = [1, null, 2, undefined, NaN, 3, 4];
  assert.equal(median(messy), 2.5);
  assert.equal(mean(messy), 2.5);
  assert.equal(median([]), null);
  assert.equal(mean([null]), null);
});

test('median handles odd and even counts', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('percentile interpolates and clamps', () => {
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
  assert.equal(percentile([1, 2, 3, 4], 1), 4);
  assert.equal(percentile([1, 2, 3, 4], 0.75), 3.25);
  assert.equal(percentile([1, 2, 3, 4], 2), 4, 'out-of-range p is clamped');
  assert.equal(percentile([7], 0.5), 7);
});

test('standard deviation needs at least two points', () => {
  assert.equal(stdDev([5]), null);
  assert.ok(Math.abs(stdDev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01);
});

test('OLS recovers a known line exactly', () => {
  const fit = olsRegression([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]);
  assert.ok(Math.abs(fit.slope - 2) < 1e-12);
  assert.ok(Math.abs(fit.intercept - 1) < 1e-12);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-12);
  assert.equal(fit.n, 5);
});

test('a fit is refused when there is nothing to fit', () => {
  assert.equal(olsRegression([1, 2], [1, 2]), null, 'too few points');
  assert.equal(olsRegression([1, 1, 1, 1], [1, 2, 3, 4]), null, 'no variance in x');
  assert.equal(theilSen([1, 1, 1], [1, 2, 3]), null);
});

test('Theil-Sen holds the true slope where OLS is dragged off by outliers', () => {
  // Clean line y = -10x + 40, then four cloud-contaminated cells.
  const xs = [], ys = [];
  for (let i = 0; i < 40; i++) { xs.push(i / 40); ys.push(40 - 10 * (i / 40)); }
  for (const x of [0.1, 0.2, 0.3, 0.4]) { xs.push(x); ys.push(140); }

  const ols = olsRegression(xs, ys);
  const robust = theilSen(xs, ys);

  assert.ok(Math.abs(robust.slope - (-10)) < 0.5, `robust slope was ${robust.slope}`);
  assert.ok(Math.abs(ols.slope - (-10)) > 5, 'OLS is meaningfully wrong here, which is why we use Theil-Sen');
});

test('Theil-Sen strides down large inputs instead of exploding', () => {
  const xs = [], ys = [];
  for (let i = 0; i < 5000; i++) { xs.push(i); ys.push(3 * i + 7); }
  const started = Date.now();
  const fit = theilSen(xs, ys, 200);
  assert.ok(Math.abs(fit.slope - 3) < 1e-9);
  assert.ok(fit.n <= 200);
  assert.ok(Date.now() - started < 2000);
});

test('normalisation maps to the unit interval and survives a flat input', () => {
  assert.deepEqual(normalise([0, 5, 10]), [0, 0.5, 1]);
  assert.deepEqual(normalise([4, 4, 4]), [0, 0, 0]);
  assert.deepEqual(normalise([1, null, 3]), [0, null, 1]);
});

test('a per-decade trend is ten times the per-year slope', () => {
  const years = [], values = [];
  for (let y = 1990; y <= 2020; y++) { years.push(y); values.push(20 + (y - 1990) * 0.03); }
  const t = trendPerDecade(years, values);
  assert.ok(Math.abs(t.perDecade - 0.3) < 1e-9);
  assert.ok(Math.abs(t.perYear - 0.03) < 1e-9);
});
