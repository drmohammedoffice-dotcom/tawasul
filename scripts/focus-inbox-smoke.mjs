/**
 * Smoke: unified Focus inbox + mutes + call history + contacts.
 * Usage: node scripts/focus-inbox-smoke.mjs
 * Requires API on :3000 and env SMOKE_USER / SMOKE_PASS (or defaults).
 */
const API = process.env.API_BASE || 'http://127.0.0.1:3000';
const user = process.env.SMOKE_USER || 'mohammed';
const pass = process.env.SMOKE_PASS || 'Password123!';

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${json?.message || JSON.stringify(json)}`);
  }
  return json?.data ?? json;
}

async function main() {
  const login = await req('/auth/login', {
    method: 'POST',
    body: { username: user, password: pass, deviceId: 'focus-smoke' }
  });
  const token = login.accessToken || login.tokens?.accessToken;
  if (!token) throw new Error('no access token');

  const inbox = await req('/messaging/inbox?limit=20', { token });
  if (!Array.isArray(inbox)) throw new Error('inbox not array');
  console.log('inbox rows', inbox.length);

  const contacts = await req('/contacts/suggested', { token });
  if (!Array.isArray(contacts)) throw new Error('contacts not array');
  console.log('contacts', contacts.length);

  const history = await req('/calls/history?filter=all', { token });
  if (!Array.isArray(history)) throw new Error('history not array');
  console.log('calls', history.length);

  console.log('focus-inbox-smoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
