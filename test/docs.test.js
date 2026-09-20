import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Documentation that states a number goes stale the moment the number changes,
 * and a README claiming the wrong test count quietly undermines every other
 * claim in it. So the count is asserted rather than maintained by hand.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function countTests() {
  let n = 0;
  for (const file of readdirSync(here).filter((f) => f.endsWith('.test.js'))) {
    n += (readFileSync(join(here, file), 'utf8').match(/^test\(/gm) || []).length;
  }
  return n;
}

function documentedCounts(relativePath) {
  const text = readFileSync(join(root, relativePath), 'utf8');
  return [...text.matchAll(/(\d+)\s+(?:passing\s+)?tests?\b/gi)].map((m) => Number(m[1]));
}

test('every test file is discovered by the runner glob', () => {
  const files = readdirSync(here).filter((f) => f.endsWith('.test.js'));
  assert.ok(files.length >= 8, `expected the full suite, found ${files.length} files`);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /test\/\*\.test\.js/, 'npm test must run all of them');
});

test('the README states the real number of tests', () => {
  const actual = countTests();
  const claimed = documentedCounts('README.md');
  assert.ok(claimed.length > 0, 'the README should state a test count');
  for (const n of claimed) {
    assert.equal(n, actual, `README claims ${n} tests, the suite has ${actual}`);
  }
});

test('the submission write-up states the real number of tests', () => {
  const actual = countTests();
  for (const n of documentedCounts('docs/SUBMISSION.md')) {
    assert.equal(n, actual, `SUBMISSION.md claims ${n} tests, the suite has ${actual}`);
  }
});

test('no documentation promises a live URL that is not in the repository', () => {
  // A dead link in a submission is worse than no link.
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(!/TODO|FIXME|coming soon|placeholder/i.test(readme), 'README carries no unfinished markers');
});
