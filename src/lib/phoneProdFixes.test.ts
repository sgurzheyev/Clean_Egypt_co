/**
 * Phone-test regressions: profile review subject, raw "Failed to fetch",
 * and first-open tooltip clamping.
 * Run: npx tsx src/lib/phoneProdFixes.test.ts
 */
import assert from 'node:assert/strict';
import { isReviewAboutProfile } from './reviewSubject.ts';
import { isBrowserNetworkFailure, userFacingRequestMessage } from './requestError.ts';
import { clampTooltipAnchor } from './visualViewport.ts';
import { presignedBrowserPutHeaders, userIdFromAccessToken } from './r2PutHeaders.ts';

const worker = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';

assert.equal(
  isReviewAboutProfile({ reviewee_id: worker, cleaner_id: worker }, worker),
  true,
  'review about the worker shows on the worker profile'
);
assert.equal(
  isReviewAboutProfile({ reviewee_id: worker, cleaner_id: worker }, client),
  false,
  'the same review does not show on the client who wrote it'
);
assert.equal(
  isReviewAboutProfile({ reviewee_id: client, cleaner_id: worker }, client),
  true,
  'worker rating the client shows on the client profile'
);
assert.equal(
  isReviewAboutProfile({ reviewee_id: client, cleaner_id: worker }, worker),
  false,
  'cleaner_id alone must not pull a client-targeted review onto the worker'
);
assert.equal(
  isReviewAboutProfile({ reviewee_id: null, cleaner_id: worker }, worker),
  true,
  'legacy cleaner_id-only row still shows on the worker'
);
assert.equal(isReviewAboutProfile({ reviewee_id: null, cleaner_id: null }, worker), false);

assert.equal(isBrowserNetworkFailure(new TypeError('Failed to fetch')), true);
assert.equal(isBrowserNetworkFailure(new TypeError('Load failed')), true);
assert.equal(
  isBrowserNetworkFailure(Object.assign(new Error('Failed to send a request to the Edge Function'), {
    name: 'FunctionsFetchError',
  })),
  true
);
assert.equal(isBrowserNetworkFailure(new Error('Insufficient tokens')), false);
assert.equal(
  userFacingRequestMessage(new TypeError('Failed to fetch'), 'Сеть оборвала запрос'),
  'Сеть оборвала запрос'
);
assert.equal(
  userFacingRequestMessage(new Error('Insufficient tokens'), 'fallback'),
  'Insufficient tokens'
);

const viewport = { left: 0, top: 0, width: 390, height: 700 };
const underNotch = clampTooltipAnchor(
  { x: 40, y: 8 },
  viewport,
  { width: 180, height: 72 },
  54
);
assert.ok(underNotch.y >= 54 + 72 + 12, `tooltip anchor stays below the notch, got y=${underNotch.y}`);
assert.ok(underNotch.x >= 180 / 2 + 8, `tooltip stays inside the left edge, got x=${underNotch.x}`);

const belowFold = clampTooltipAnchor(
  { x: 200, y: 4000 },
  viewport,
  { width: 180, height: 72 },
  0
);
assert.ok(belowFold.y <= viewport.height - 8, `tooltip anchor stays in the viewport, got y=${belowFold.y}`);

const legacySigned =
  'https://example.r2.cloudflarestorage.com/mission-photos/a.jpg?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bx-amz-meta-folder%3Bx-amz-meta-user_id';
const legacyHeaders = presignedBrowserPutHeaders({
  uploadUrl: legacySigned,
  serverHeaders: { 'Content-Type': 'image/jpeg', 'Content-Length': '400000' },
  contentType: 'image/jpeg',
  metadata: { user_id: 'user-1', folder: 'mission-photos' },
});
assert.equal(legacyHeaders['Content-Type'], 'image/jpeg');
assert.equal(legacyHeaders['x-amz-meta-user_id'], 'user-1');
assert.equal(legacyHeaders['x-amz-meta-folder'], 'mission-photos');
assert.equal(
  Object.keys(legacyHeaders).some((key) => key.toLowerCase() === 'content-length'),
  false,
  'Content-Length stays a forbidden fetch header'
);

const contentTypeOnly =
  'https://example.r2.cloudflarestorage.com/mission-photos/b.jpg?X-Amz-SignedHeaders=content-type%3Bhost';
const modernHeaders = presignedBrowserPutHeaders({
  uploadUrl: contentTypeOnly,
  serverHeaders: { 'Content-Type': 'image/jpeg' },
  contentType: 'image/jpeg',
  metadata: { user_id: 'user-1', folder: 'mission-photos' },
});
assert.equal(modernHeaders['x-amz-meta-user_id'], undefined);
assert.equal(modernHeaders['x-amz-meta-folder'], undefined);

const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
assert.equal(userIdFromAccessToken(`${header}.${payload}.sig`), 'user-1');

console.log('phoneProdFixes.test.ts ok');
