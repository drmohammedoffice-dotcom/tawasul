import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiConfig } from '../config';

function pythonBin(): string {
  const win = resolve(process.cwd(), '.venv/Scripts/python.exe');
  const nix = resolve(process.cwd(), '.venv/bin/python');
  if (existsSync(win)) return win;
  if (existsSync(nix)) return nix;
  return 'python';
}

export async function runPythonWorker(
  scriptName: string,
  payload: Record<string, unknown>,
  timeoutMs = 180_000
): Promise<Record<string, unknown>> {
  const script = resolve(process.cwd(), 'python', scriptName);
  if (!existsSync(script)) {
    return { ok: false, status: 'unavailable', reason: `worker_missing:${scriptName}` };
  }
  return new Promise((resolvePromise) => {
    const child = spawn(pythonBin(), [script], {
      cwd: process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        HF_HUB_OFFLINE: aiConfig.offlineMode ? '0' : process.env.HF_HUB_OFFLINE,
        PYTHONUTF8: '1'
      }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({ ok: false, status: 'unavailable', reason: 'worker_timeout' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, status: 'unavailable', reason: err.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const trimmed = stdout.trim();
        const jsonLine =
          trimmed
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith('{') && line.endsWith('}'))
            .pop() || trimmed;
        const parsed = JSON.parse(jsonLine || '{}') as Record<string, unknown>;
        resolvePromise(parsed);
      } catch {
        resolvePromise({
          ok: false,
          status: 'unavailable',
          reason: 'bad_worker_json',
          detail: stderr.slice(-500) || stdout.slice(-500)
        });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
