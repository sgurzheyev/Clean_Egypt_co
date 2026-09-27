/**
 * Leftover RUSH proxies stay until Paranoic has its own.
 * They must stay self-contained (no ./_lib import) so Vercel does not crash on boot.
 * Run: npx tsx api/liveCraftProxy.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryAdsbNearby } from './adsb-nearby.ts';
import { mergeAdsbAircraft, pickAdsbAircraftList } from './_lib/adsbNearbyFetch.ts';
import { queryAisNearby } from './ais-nearby.ts';

const here = dirname(fileURLToPath(import.meta.url));

function noRelativeImports(file: string) {
  const src = readFileSync(join(here, file), 'utf8');
  const relativeImports = src
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line) && /from\s+['"]\.\//.test(line));
  assert.equal(relativeImports.length, 0, `${file} must not import ./_lib`);
  return src;
}

noRelativeImports('adsb-nearby.ts');
noRelativeImports('ais-nearby.ts');
noRelativeImports('opensky-states.ts');

assert.equal(pickAdsbAircraftList({ ac: [{ hex: 'abc' }] }).length, 1);
assert.equal(pickAdsbAircraftList({ aircraft: [{ hex: 'def' }] }).length, 1);
const merged = mergeAdsbAircraft([
  [{ hex: 'AAA', flight: 'ONE' }, { hex: 'bbb', flight: 'TWO' }],
  [{ hex: 'aaa', flight: 'DUP' }],
]);
assert.equal(merged.length, 2);

const boom = async () => {
  throw new Error('network down');
};
const empty = await queryAdsbNearby(30.04, 31.23, 150, boom as unknown as typeof fetch, 50);
assert.equal(empty.ac.length, 0);
assert.equal(empty.source, 'none');
assert.equal(typeof empty.error, 'string');

const missingKey = await queryAisNearby(
  { lamin: 40.9, lomin: 28.8, lamax: 41.3, lomax: 29.2 },
  ''
);
assert.equal(missingKey.ships.length, 0);
assert.equal(missingKey.error, 'need-key');

console.log('live craft proxy tests ok');
