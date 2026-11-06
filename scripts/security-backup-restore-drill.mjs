/**
 * Actual Postgres dump + restore-to-temp-db integrity drill (local Docker).
 * Run from repo root with Docker Postgres healthy.
 * Does NOT drop the primary database.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'security', 'scans', 'backups');
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dumpFile = path.join(outDir, `secure_messaging_${stamp}.dump`);
const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
}

const started = Date.now();
try {
  sh(
    `docker compose exec -T postgres pg_dump -U app -d secure_messaging -Fc -f /tmp/sc_backup.dump`
  );
  sh(`docker compose cp postgres:/tmp/sc_backup.dump "${dumpFile}"`);
  const size = statSync(dumpFile).size;
  if (size > 1000) record('pg_dump', 'PASS', `${size} bytes → ${dumpFile}`);
  else record('pg_dump', 'FAIL', `tiny dump ${size}`);
} catch (e) {
  record('pg_dump', 'FAIL', String(e.stderr || e.message || e).slice(0, 300));
  finish();
  process.exit(1);
}
const dumpMs = Date.now() - started;

const restoreDb = `secure_messaging_restore_${Date.now().toString(36)}`;
const restoreStarted = Date.now();
try {
  sh(`docker compose exec -T postgres psql -U app -d postgres -c "CREATE DATABASE ${restoreDb};"`);
  sh(`docker compose cp "${dumpFile}" postgres:/tmp/sc_restore.dump`);
  sh(
    `docker compose exec -T postgres pg_restore -U app -d ${restoreDb} --no-owner --no-acl /tmp/sc_restore.dump`
  );
  const counts = sh(
    `docker compose exec -T postgres psql -U app -d ${restoreDb} -t -A -c "SELECT (SELECT count(*) FROM \\"User\\"), (SELECT count(*) FROM \\"RefreshToken\\");"`
  ).trim();
  record('pg_restore_temp_db', 'PASS', `counts User,RefreshToken=${counts}`);
  sh(`docker compose exec -T postgres psql -U app -d postgres -c "DROP DATABASE ${restoreDb};"`);
  record('cleanup_temp_db', 'PASS');
} catch (e) {
  record('pg_restore_temp_db', 'FAIL', String(e.stderr || e.message || e).slice(0, 400));
  try {
    sh(`docker compose exec -T postgres psql -U app -d postgres -c "DROP DATABASE IF EXISTS ${restoreDb};"`);
  } catch {
    /* ignore */
  }
}

const restoreMs = Date.now() - restoreStarted;

// Media directory presence check (not a full R2 restore)
const mediaPath = path.join(root, 'backend', 'storage', 'media');
if (existsSync(mediaPath)) record('media_tree_present', 'PASS', mediaPath);
else record('media_tree_present', 'SKIP', 'no local media dir');

const reportPath = path.join(outDir, `restore-drill-${stamp}.md`);
const md = `# Backup restore drill

- Dump file: \`${path.basename(dumpFile)}\`
- Dump duration: ${dumpMs} ms (lab RPO sample = last successful dump age; this run created a fresh dump)
- Restore duration: ${restoreMs} ms (lab RTO sample for logical restore to empty DB)
- Results:
${results.map((r) => `- **${r.status}** ${r.name}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}
`;
writeFileSync(reportPath, md, 'utf8');
record('drill_report_written', 'PASS', reportPath);

finish();
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);

function finish() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
}
