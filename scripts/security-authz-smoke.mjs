/**
 * Authorization / IDOR smoke checks (lab only).
 * Requires two existing users' tokens via env:
 *   USER_A_TOKEN, USER_B_TOKEN, USER_A_ID, MEDIA_ID_OWNED_BY_A (optional)
 * Usage: node scripts/security-authz-smoke.mjs
 */
const API = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const tokenA = process.env.USER_A_TOKEN || '';
const tokenB = process.env.USER_B_TOKEN || '';
const userA = process.env.USER_A_ID || '';
const mediaA = process.env.MEDIA_ID_OWNED_BY_A || '';

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  if (!tokenA || !tokenB) {
    record('preflight.tokens', 'SKIP', 'Set USER_A_TOKEN and USER_B_TOKEN');
    printSummary();
    process.exit(0);
  }

  // B must not hit A account settings
  try {
    const res = await fetch(`${API}/accounts/settings`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    // Settings returns B's own data — ensure it is not A's id when userA known
    const body = await res.json().catch(() => ({}));
    const id = body?.data?.id || body?.data?.user?.id;
    if (userA && id && id === userA) {
      record('idor.account_settings', 'FAIL', 'B received A identity');
    } else if (res.ok) {
      record('idor.account_settings', 'PASS', `status=${res.status}`);
    } else {
      record('idor.account_settings', 'SKIP', `status=${res.status}`);
    }
  } catch (e) {
    record('idor.account_settings', 'SKIP', String(e?.message || e));
  }

  // Private media without token
  if (mediaA) {
    const res = await fetch(`${API}/media/local-file/${mediaA}`);
    if (res.status === 200) record('idor.media_no_token', 'FAIL', '200 without capability token');
    else record('idor.media_no_token', 'PASS', `status=${res.status}`);
  } else {
    record('idor.media_no_token', 'SKIP', 'MEDIA_ID_OWNED_BY_A not set');
  }

  // Admin moderation without admin role
  try {
    const res = await fetch(`${API}/moderation/cases`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    if (res.status === 200) record('bfla.moderation_cases', 'FAIL', 'non-admin got 200');
    else record('bfla.moderation_cases', 'PASS', `status=${res.status}`);
  } catch (e) {
    record('bfla.moderation_cases', 'SKIP', String(e?.message || e));
  }

  printSummary();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
}

main();
