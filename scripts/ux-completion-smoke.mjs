/**
 * Live API coverage for UX completion phase (comments, graph lists, stories media,
 * groups/channels list+ACL). Honest PASS/FAIL only.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '') {
  const status = ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL';
  results.push({ name, status, detail });
  console.log(`${status} - ${name}${detail ? ` | ${detail}` : ''}`);
}

async function req(pathname, { method = 'GET', token, body, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (raw) return { res, text, json };
  if (!res.ok) {
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 200);
    throw new Error(`${method} ${pathname} -> ${res.status} ${msg}`);
  }
  return json?.data ?? json;
}

function uniq(p) {
  return `${p}_${Date.now()}_${Math.floor(Math.random() * 999)}`;
}

async function register(username) {
  const deviceId = `web-${uniq('d')}`;
  const data = await req('/auth/register', {
    method: 'POST',
    body: { username, password: 'password123', deviceId }
  });
  return {
    token: data.accessToken,
    refresh: data.refreshToken,
    id: data.user.id,
    username,
    deviceId
  };
}

async function uploadPng(token, purpose = 'post') {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: 't.png',
      mimeType: 'image/png',
      mediaType: 'image',
      sizeBytes: png.length,
      purpose,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 't.png');
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `http://127.0.0.1:3000${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  await req('/media/complete', { method: 'POST', token, body: { mediaId: ticket.media.id } });
  return ticket.media.id;
}

async function main() {
  const a = await register(uniq('uxa'));
  const b = await register(uniq('uxb'));
  const stranger = await register(uniq('uxs'));

  // Comments list + delete authz
  try {
    const mediaId = await uploadPng(a.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: 'ux-comments', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    await req(`/users/${a.id}/follow`, { method: 'POST', token: b.token });
    const c1 = await req(`/posts/${post.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'hello' }
    });
    const listed = await req(`/posts/${post.id}/comments`, { token: a.token });
    const { res: strangerDel } = await req(`/posts/${post.id}/comments/${c1.id}`, {
      method: 'DELETE',
      token: stranger.token,
      raw: true
    });
    await req(`/posts/${post.id}/comments/${c1.id}`, { method: 'DELETE', token: a.token });
    const after = await req(`/posts/${post.id}/comments`, { token: a.token });
    record(
      'ux.comments-list-delete',
      Array.isArray(listed) &&
        listed.some((c) => c.id === c1.id) &&
        strangerDel.status >= 400 &&
        !after.some((c) => c.id === c1.id),
      `list=${listed.length} strangerDel=${strangerDel.status} after=${after.length}`
    );
  } catch (e) {
    record('ux.comments-list-delete', false, e.message);
  }

  // Followers / following lists + privacy
  try {
    await req(`/users/${b.id}/follow`, { method: 'POST', token: a.token });
    const followers = await req(`/users/${b.username}/followers`, { token: a.token });
    const following = await req(`/users/${a.username}/following`, { token: a.token });
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: true }
    });
    const { res: privDenied } = await req(`/users/${a.username}/followers`, {
      token: stranger.token,
      raw: true
    });
    record(
      'ux.followers-following-privacy',
      Array.isArray(followers) &&
        followers.some((u) => u.id === a.id) &&
        Array.isArray(following) &&
        following.some((u) => u.id === b.id) &&
        privDenied.status === 403,
      `followers=${followers.length} following=${following.length} privateList=${privDenied.status}`
    );
  } catch (e) {
    record('ux.followers-following-privacy', false, e.message);
  }

  // Stories secureUrl + view gate
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: false }
    });
    const mediaId = await uploadPng(a.token, 'story');
    const story = await req('/stories', {
      method: 'POST',
      token: a.token,
      body: { mediaId }
    });
    const feedSelf = await req('/stories/feed', { token: a.token });
    const mine = feedSelf.find((s) => s.id === story.id);
    const { res: viewDenied } = await req(`/stories/${story.id}/view`, {
      method: 'POST',
      token: stranger.token,
      raw: true
    });
    await req(`/users/${a.id}/follow`, { method: 'POST', token: b.token });
    await req(`/stories/${story.id}/view`, { method: 'POST', token: b.token });
    record(
      'ux.stories-secure-and-gate',
      Boolean(mine?.media?.secureUrl) && viewDenied.status === 403,
      `secureUrl=${Boolean(mine?.media?.secureUrl)} strangerView=${viewDenied.status}`
    );
  } catch (e) {
    record('ux.stories-secure-and-gate', false, e.message);
  }

  // Groups list + member ACL (business account required to create)
  try {
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.items?.[0] || cats?.[0];
    const catKey = cat?.key || cat?.id || 'retail_store';
    await req('/business/switch', {
      method: 'POST',
      token: a.token,
      body: {
        businessName: `UX Biz ${Date.now()}`,
        categoryKey: catKey,
        description: 'ux-smoke'
      }
    });
    const group = await req('/groups', {
      method: 'POST',
      token: a.token,
      body: { name: `g-${uniq('n')}` }
    });
    const mine = await req('/groups', { token: a.token });
    const { res: strangerMembers } = await req(`/groups/${group.id}/members`, {
      token: stranger.token,
      raw: true
    });
    await req(`/groups/${group.id}/members`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const members = await req(`/groups/${group.id}/members`, { token: b.token });
    await req(`/groups/${group.id}/messages`, {
      method: 'POST',
      token: b.token,
      body: { encryptedContent: 'hi-group' }
    });
    record(
      'ux.groups-list-members-acl',
      mine.some((g) => g.id === group.id) &&
        strangerMembers.status === 403 &&
        members.some((m) => m.userId === b.id),
      `listed=${mine.length} stranger=${strangerMembers.status} members=${members.length}`
    );
  } catch (e) {
    record('ux.groups-list-members-acl', false, e.message);
  }

  // Channels list + member cannot post
  try {
    const channel = await req('/channels', {
      method: 'POST',
      token: a.token,
      body: { name: `c-${uniq('n')}` }
    });
    await req(`/channels/${channel.id}/subscriptions`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const { res: memberPost } = await req(`/channels/${channel.id}/messages`, {
      method: 'POST',
      token: b.token,
      body: { encryptedContent: 'nope' },
      raw: true
    });
    await req(`/channels/${channel.id}/messages`, {
      method: 'POST',
      token: a.token,
      body: { encryptedContent: 'owner-ok' }
    });
    const list = await req('/channels', { token: b.token });
    record(
      'ux.channels-list-post-acl',
      list.some((c) => c.id === channel.id) && memberPost.status === 403,
      `listed=${list.length} memberPost=${memberPost.status}`
    );
  } catch (e) {
    record('ux.channels-list-post-acl', false, e.message);
  }

  // Private post comment still denied
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: true }
    });
    const mediaId = await uploadPng(a.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: 'priv', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    const { res } = await req(`/posts/${post.id}/comments`, {
      method: 'POST',
      token: stranger.token,
      body: { body: 'no' },
      raw: true
    });
    record('ux.private-comment-denied', res.status === 403, `status=${res.status}`);
  } catch (e) {
    record('ux.private-comment-denied', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nUX COMPLETION SUMMARY passed=${passed} failed=${failed} total=${results.length}`);
  const dest = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'docs',
    'social-platform',
    '_ux-completion-results.json'
  );
  writeFileSync(dest, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`wrote ${dest}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
