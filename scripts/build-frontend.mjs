/**
 * Invokes build-frontend.ps1 so Windows resolves the Unicode folder name
 * inside PowerShell (no cmd.exe mojibake of Arabic path segments).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ps1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'build-frontend.ps1');

if (process.platform !== 'win32') {
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
  const result = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit',
    cwd: frontendDir,
    env: process.env,
    shell: true
  });
  process.exit(result.status ?? 1);
}

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { stdio: 'inherit', env: process.env }
);
process.exit(result.status ?? 1);
