import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFill, monthlyUrl, dailyUrl, parseMonthly, parseDaily, hotMonths,
  hotSeasonSeries, summariseWarming, countHotNights,
} from '../js/power.js';

function monthlyFixture({ from = 1985, to = 2024, summerBase = 30, perYear = 0.04, winter = 10 } = {}) {
  const p = {};
  for (let y = from; y <= to; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}${String(m).padStart(2, '0')}`;
      p[key] = (m >= 6 && m <= 8) ? summerBase + (y - from) * perYear : winter;
    }
  }
  return { properties: { parameter: { T2M_MAX: p } } };
}

test('POWER fill values are recognised and removed', () => {
  assert.equal(isFill(-999), true);
  assert.equal(isFill(-999.0), true);
  assert.equal(isFill(NaN), true);
  assert.equal(isFill(-12.5), false);
  const json = { properties: { parameter: { T2M: { 202601: -999, 202602: 4.5 } } } };
  const parsed = parseMonthly(json, 'T2M');
  assert.equal(parsed[2026][1], undefined, 'the fill month is dropped');
  assert.equal(parsed[2026][2], 4.5);
});

test('request URLs carry the parameters POWER expects', () => {
  const m = monthlyUrl({ lat: 40, lon: -74, start: 1985, end: 2024, parameters: ['T2M_MAX', 'TS'] });
  assert.match(m, /temporal\/monthly\/point/);
  assert.match(m, /parameters=T2M_MAX%2CTS/);
  assert.match(m, /format=JSON/);
  const d = dailyUrl({ lat: 40, lon: -74, start: '2026-06-01', end: '2026-08-31', parameters: ['T2M_MIN'] });
  assert.match(d, /start=20260601&end=20260831/, 'daily endpoints want compact dates');
});

test('daily records parse into sorted ISO dates with fills removed', () => {
  const json = { properties: { parameter: { T2M_MIN: { 20260703: 22.1, 20260701: 19.4, 20260702: -999 } } } };
  const rows = parseDaily(json, 'T2M_MIN');
  assert.deepEqual(rows.map((r) => r.date), ['2026-07-01', '2026-07-03']);
});

test('a missing parameter yields empty results rather than an exception', () => {
  assert.deepEqual(parseMonthly({}, 'T2M'), {});
  assert.deepEqual(parseDaily({ properties: {} }, 'T2M'), []);
  assert.equal(summariseWarming({}, 'T2M_MAX', 40), null);
});

test('hot months differ by hemisphere', () => {
  assert.deepEqual(hotMonths(40), [6, 7, 8]);
  assert.deepEqual(hotMonths(-33), [12, 1, 2]);
});

test('southern December is attributed to the summer it belongs to', () => {
  const json = { properties: { parameter: { T2M_MAX: {
    202012: 30, 202101: 32, 202102: 34,
    202112: 31, 202201: 33, 202202: 35,
  } } } };
  const series = hotSeasonSeries(parseMonthly(json, 'T2M_MAX'), -33);
  assert.deepEqual(series.years, [2021, 2022], 'the summer is named for the year it ends in');
  assert.equal(series.values[0], 32, '(30+32+34)/3');
});

test('an incomplete season is excluded rather than averaged short', () => {
  const json = { properties: { parameter: { T2M_MAX: { 202606: 30, 202607: 32 } } } };
  const series = hotSeasonSeries(parseMonthly(json, 'T2M_MAX'), 40);
  assert.equal(series.years.length, 0, 'two of three summer months is not a summer');
});

test('the warming summary recovers an injected trend', () => {
  const s = summariseWarming(monthlyFixture({ perYear: 0.04 }), 'T2M_MAX', 40);
  assert.ok(Math.abs(s.trend.perDecade - 0.4) < 1e-6);
  assert.deepEqual(s.span, [1985, 2024]);
  assert.ok(s.recentMean > s.baselineMean);
  assert.ok(Math.abs(s.change - (s.recentMean - s.baselineMean)) < 1e-12);
});

test('a short record is refused rather than fitted', () => {
  assert.equal(summariseWarming(monthlyFixture({ from: 2020, to: 2024 }), 'T2M_MAX', 40), null);
});

test('hot nights are counted per year against a threshold', () => {
  const rows = [
    { date: '2025-07-01', value: 22 }, { date: '2025-07-02', value: 18 },
    { date: '2026-07-01', value: 24 }, { date: '2026-07-02', value: 21 },
  ];
  const counts = countHotNights(rows, 20);
  assert.deepEqual(counts[2025], { total: 2, hot: 1 });
  assert.deepEqual(counts[2026], { total: 2, hot: 2 });
});
