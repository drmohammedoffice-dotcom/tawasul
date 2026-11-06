/**
 * JWT iss/aud/kid unit checks using jsonwebtoken (Nest dependency).
 * Run: node scripts/security-jwt-claims-test.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../backend/package.json'));
const jwt = require('jsonwebtoken');

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const secretV1 = 'access-secret-v1-xxxxxxxx';
const secretV0 = 'access-secret-v0-yyyyyyyy';
const issuer = 'tawasul';
const audience = 'tawasul-api';

const token = jwt.sign(
  { sub: 'u1', type: 'access', sid: 's1', jti: 'j1', deviceId: 'd1' },
  secretV1,
  { algorithm: 'HS256', expiresIn: '5m', issuer, audience, keyid: 'v1' }
);

const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
if (header.kid === 'v1' && header.alg === 'HS256') record('sign_kid_header', 'PASS');
else record('sign_kid_header', 'FAIL', JSON.stringify(header));

try {
  const payload = jwt.verify(token, secretV1, { algorithms: ['HS256'], issuer, audience });
  if (payload.type === 'access') record('verify_iss_aud', 'PASS');
  else record('verify_iss_aud', 'FAIL');
} catch (e) {
  record('verify_iss_aud', 'FAIL', String(e.message || e));
}

try {
  jwt.verify(token, secretV1, { algorithms: ['HS256'], issuer: 'other', audience });
  record('reject_bad_iss', 'FAIL', 'should reject');
} catch {
  record('reject_bad_iss', 'PASS');
}

try {
  jwt.verify(token, secretV1, { algorithms: ['HS256'], issuer, audience: 'other' });
  record('reject_bad_aud', 'FAIL', 'should reject');
} catch {
  record('reject_bad_aud', 'PASS');
}

const ring = new Map([
  ['v1', secretV1],
  ['v0', secretV0]
]);
const oldToken = jwt.sign({ sub: 'u1', type: 'access' }, secretV0, {
  algorithm: 'HS256',
  expiresIn: '5m',
  issuer,
  audience,
  keyid: 'v0'
});
const oldKid = JSON.parse(Buffer.from(oldToken.split('.')[0], 'base64url').toString()).kid;
try {
  jwt.verify(oldToken, ring.get(oldKid), { algorithms: ['HS256'], issuer, audience });
  record('rotation_previous_kid', 'PASS');
} catch (e) {
  record('rotation_previous_kid', 'FAIL', String(e.message || e));
}

try {
  jwt.verify(oldToken, ring.get('v1'), { algorithms: ['HS256'], issuer, audience });
  record('reject_wrong_kid_secret', 'FAIL', 'should reject');
} catch {
  record('reject_wrong_kid_secret', 'PASS');
}

const expired = jwt.sign({ sub: 'u1', type: 'access' }, secretV1, {
  algorithm: 'HS256',
  expiresIn: -10,
  issuer,
  audience,
  keyid: 'v1'
});
try {
  jwt.verify(expired, secretV1, { algorithms: ['HS256'], issuer, audience });
  record('reject_expired', 'FAIL', 'should reject');
} catch {
  record('reject_expired', 'PASS');
}

const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nSummary: PASS=${results.length - fail} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
