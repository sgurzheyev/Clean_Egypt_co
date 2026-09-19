/**
 * Wave I / SEC-4: helper membership/size checks + requireUser 401 without JWT.
 * Handlers import the same helper; Vercel resolves extensionless paths (Node ESM does not).
 * Run: node --experimental-strip-types scripts/sec4-api-auth-selftest.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractBearerToken,
  isMissionMember,
  isOversizedBase64,
  isOversizedText,
  IMAGE_MAX_BASE64_CHARS,
  TRANSLATE_MAX_CHARS,
  requireUser,
  requireMissionMember,
} from '../api/_lib/requireUser.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mockReq({ method = 'POST', headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

function mockRes() {
  const out = { statusCode: 0, jsonBody: null };
  const res = {
    status(code) {
      out.statusCode = code;
      return res;
    },
    json(payload) {
      out.jsonBody = payload;
      return out;
    },
  };
  res._out = out;
  return res;
}

assert(extractBearerToken(mockReq()) === null, 'missing auth');
assert(extractBearerToken(mockReq({ headers: { authorization: 'Bearer abc.def' } })) === 'abc.def', 'bearer parse');
assert(extractBearerToken(mockReq({ headers: { authorization: ['Bearer tok'] } })) === 'tok', 'array header');
assert(isOversizedText('a'.repeat(TRANSLATE_MAX_CHARS + 1)), 'text over max');
assert(!isOversizedText('short'), 'short text ok');
assert(isOversizedBase64('x'.repeat(IMAGE_MAX_BASE64_CHARS + 1)), 'b64 over max');
assert(isMissionMember('u1', { creator_id: 'u1', cleaner_id: null }), 'creator member');
assert(isMissionMember('c1', { creator_id: 'u1', cleaner_id: 'c1' }), 'cleaner member');
assert(!isMissionMember('stranger', { creator_id: 'u1', cleaner_id: 'c1' }), 'stranger not member');

const unauth = mockRes();
const gated = await requireUser(mockReq(), unauth);
assert(gated === null && unauth._out.statusCode === 401, `requireUser expected 401, got ${unauth._out.statusCode}`);

const memberRes = mockRes();
const member = await requireMissionMember(mockReq({ body: { missionId: 'x' } }), memberRes, 'x');
assert(member === null && memberRes._out.statusCode === 401, 'requireMissionMember unauthenticated must 401 before service-role');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mustGate = [
  ['api/translate.ts', 'requireUser'],
  ['api/moderate-mission-image.ts', 'requireUser'],
  ['api/moderate-mission-photo-safety.ts', 'requireUser'],
  ['api/analyze-mission.ts', 'requireMissionMember'],
  ['api/notify-mission-submitted.ts', 'requireMissionMember'],
  ['api/notify-dispute.ts', 'requireMissionMember'],
];
for (const [rel, symbol] of mustGate) {
  const src = readFileSync(join(root, rel), 'utf8');
  assert(src.includes(symbol), `${rel} must call ${symbol}`);
  assert(src.includes('./_lib/requireUser'), `${rel} must import shared helper`);
}

const cron = readFileSync(join(root, 'api/process-expired-crowdfunding.ts'), 'utf8');
assert(!cron.includes('requireUser'), 'expiry cron must stay secret-gated, not user JWT');
assert(cron.includes('provided !== expectedSecret'), 'expiry cron must keep secret equality');

console.log('sec4-api-auth-selftest: ok');
