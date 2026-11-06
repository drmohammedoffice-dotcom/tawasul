/**
 * Phase 2 smoke: DM search, media message, business-only create, pins, calls ICE, block ACL.
 */
const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:3000';

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${json?.message || text.slice(0, 180)}`);
    err.status = res.status;
    throw err;
  }
  return json?.data ?? json;
}

function assert(c, m) {
  if (!c) throw new Error(m);
}

const results = [];
const pass = (n) => {
  results.push({ n, ok: true });
  console.log(`PASS  ${n}`);
};
const fail = (n, e) => {
  results.push({ n, ok: false, e: String(e?.message || e) });
  console.error(`FAIL  ${n}: ${e?.message || e}`);
};

async function register(prefix) {
  const username = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 999)}`;
  const password = 'Password123!';
  const deviceId = `p2-${username}`;
  const auth = await req('/auth/register', {
    method: 'POST',
    body: { username, password, deviceId }
  });
  return { ...auth, username, password, deviceId };
}

async function main() {
  try {
    const hr = await fetch(`${ORIGIN}/health`);
    assert(hr.ok, 'health');
    pass('api reachable');
  } catch (e) {
    fail('api reachable', e);
    process.exit(1);
  }

  let alice, bob, biz;
  try {
    alice = await register('p2a');
    bob = await register('p2b');
    biz = await register('p2biz');
    pass('register three users');
  } catch (e) {
    fail('register three users', e);
    process.exit(1);
  }

  // Switch biz to business
  try {
    await req('/business/switch', {
      method: 'POST',
      token: biz.accessToken,
      body: {
        businessName: `Biz ${Date.now()}`,
        categoryKey: 'retail_store',
        description: 'phase2'
      }
    }).catch(async (err) => {
      // category key may differ — fetch categories
      const cats = await req('/business/categories');
      const cat = cats[0];
      return req('/business/switch', {
        method: 'POST',
        token: biz.accessToken,
        body: { businessName: `Biz ${Date.now()}`, categoryKey: cat.key, description: 'phase2' }
      });
    });
    pass('business switch');
  } catch (e) {
    fail('business switch', e);
  }

  // Personal cannot create group/channel
  try {
    await req('/groups', { method: 'POST', token: alice.accessToken, body: { name: 'Nope' } });
    fail('personal create group denied', new Error('expected 403'));
  } catch (e) {
    if (e.status === 403 || String(e.message).includes('403') || String(e.message).includes('business')) {
      pass('personal create group denied');
    } else fail('personal create group denied', e);
  }
  try {
    await req('/channels', { method: 'POST', token: alice.accessToken, body: { name: 'NopeCh' } });
    fail('personal create channel denied', new Error('expected 403'));
  } catch (e) {
    if (e.status === 403 || String(e.message).includes('403') || String(e.message).includes('business')) {
      pass('personal create channel denied');
    } else fail('personal create channel denied', e);
  }

  let groupId, channelId;
  try {
    const g = await req('/groups', {
      method: 'POST',
      token: biz.accessToken,
      body: { name: `G${Date.now()}` }
    });
    groupId = g.id;
    const c = await req('/channels', {
      method: 'POST',
      token: biz.accessToken,
      body: { name: `C${Date.now()}` }
    });
    channelId = c.id;
    pass('business create group+channel');
  } catch (e) {
    fail('business create group+channel', e);
  }

  // Pins
  try {
    if (groupId) {
      await req('/messaging/pins', {
        method: 'POST',
        token: biz.accessToken,
        body: { spaceType: 'group', spaceId: groupId }
      });
      const pins = await req('/messaging/pins', { token: biz.accessToken });
      assert(pins.some((p) => p.spaceId === groupId && p.pinned), 'pin missing');
      await req(`/messaging/pins/group/${groupId}`, { method: 'DELETE', token: biz.accessToken });
      pass('pins pin/unpin');
    } else fail('pins pin/unpin', new Error('no group'));
  } catch (e) {
    fail('pins pin/unpin', e);
  }

  // Search by username / display name
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: bob.accessToken,
      body: { displayName: `BobVisible${Date.now()}` }
    });
    const bobProfile = await req('/users/me/profile', { token: bob.accessToken });
    const byUser = await req(`/search?q=${encodeURIComponent(bob.username)}`, { token: alice.accessToken });
    assert(byUser.users?.some((u) => u.id === bob.user.id || u.username === bob.username), 'username search');
    const byName = await req(`/search?q=${encodeURIComponent(bobProfile.displayName.slice(0, 8))}`, {
      token: alice.accessToken
    });
    assert(byName.users?.length >= 1, 'displayName search');
    pass('search username+displayName');
  } catch (e) {
    fail('search username+displayName', e);
  }

  // DM text
  try {
    const msg = await req('/messages', {
      method: 'POST',
      token: alice.accessToken,
      body: { receiverId: bob.user.id, encryptedContent: 'hello phase2' }
    });
    assert(msg.id, 'msg id');
    const conv = await req(`/messages/private/${bob.user.id}`, { token: alice.accessToken });
    assert(conv.some((m) => m.id === msg.id), 'in conversation');
    pass('dm send+list');
  } catch (e) {
    fail('dm send+list', e);
  }

  // Block prevents message
  try {
    await req(`/users/${bob.user.id}/block`, { method: 'POST', token: alice.accessToken });
    try {
      await req('/messages', {
        method: 'POST',
        token: alice.accessToken,
        body: { receiverId: bob.user.id, encryptedContent: 'blocked?' }
      });
      fail('block prevents dm', new Error('expected 403'));
    } catch (e) {
      if (e.status === 403 || String(e.message).includes('403')) pass('block prevents dm');
      else fail('block prevents dm', e);
    }
    await req(`/users/${bob.user.id}/block`, { method: 'DELETE', token: alice.accessToken });
  } catch (e) {
    fail('block prevents dm', e);
  }

  // ICE servers (calls infrastructure)
  try {
    const ice = await req('/calls/ice-servers', { token: alice.accessToken });
    assert(Array.isArray(ice.iceServers) && ice.iceServers.length > 0, 'iceServers');
    pass('calls ice-servers');
  } catch (e) {
    fail('calls ice-servers', e);
  }

  // Start DM call + reject
  try {
    const started = await req('/calls/dm', {
      method: 'POST',
      token: alice.accessToken,
      body: { peerUserId: bob.user.id, kind: 'audio' }
    });
    const callId = started.call?.id || started.id;
    assert(callId, 'call id');
    await req(`/calls/${callId}/reject`, { method: 'POST', token: bob.accessToken, body: {} });
    pass('dm call invite+reject');
  } catch (e) {
    fail('dm call invite+reject', e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n--- Phase 2 smoke summary ---');
  console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(` - ${f.n}: ${f.e}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
