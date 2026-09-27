/**
 * Run: npx tsx src/lib/freeGarbagePin.test.ts
 */
import assert from 'node:assert/strict';
import { freeGarbagePinExpired, FREE_GARBAGE_PIN_LIFE_MS } from './freeGarbagePin.ts';
import {
  filterMissionsByServiceTypes,
  parseServiceTypeSelection,
} from './missionServiceFilter.ts';

const now = Date.parse('2026-09-27T12:00:00Z');

assert.equal(
  freeGarbagePinExpired(
    {
      is_report: true,
      status: 'reported',
      current_funding: 0,
      crowdfunding_expires_at: '2026-09-20T12:00:00Z',
    },
    now
  ),
  true
);

assert.equal(
  freeGarbagePinExpired(
    {
      is_report: true,
      status: 'reported',
      current_funding: 0,
      created_at: new Date(now - FREE_GARBAGE_PIN_LIFE_MS - 1000).toISOString(),
    },
    now
  ),
  true
);

assert.equal(
  freeGarbagePinExpired(
    {
      is_report: true,
      status: 'reported',
      current_funding: 5,
      crowdfunding_expires_at: '2026-09-01T00:00:00Z',
    },
    now
  ),
  false
);

assert.equal(
  freeGarbagePinExpired(
    {
      is_report: false,
      status: 'available',
      current_funding: 0,
      created_at: '2020-01-01T00:00:00Z',
    },
    now
  ),
  false
);

assert.deepEqual(parseServiceTypeSelection('car_detailing,nope,windows_facades,car_detailing'), [
  'car_detailing',
  'windows_facades',
]);
assert.deepEqual(parseServiceTypeSelection(''), []);

const missions = [
  { service_type: 'car_detailing', id: 'a' },
  { service_type: 'windows_facades', id: 'b' },
  { service_type: 'junk_removal', id: 'c' },
];
assert.equal(filterMissionsByServiceTypes(missions, []).length, 3);
assert.deepEqual(
  filterMissionsByServiceTypes(missions, ['car_detailing']).map((m) => m.id),
  ['a']
);
assert.deepEqual(
  filterMissionsByServiceTypes(missions, ['car_detailing', 'windows_facades']).map((m) => m.id),
  ['a', 'b']
);

console.log('freeGarbagePin.test.ts ok');
