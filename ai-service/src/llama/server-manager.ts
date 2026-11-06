import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiConfig } from '../config';

let child: ChildProcess | null = null;
let ready = false;

export function llamaServerPort(): number {
  return Number(process.env.LLAMA_SERVER_PORT || 8081);
}

export function llamaCliPath(): string {
  const candidates = [
    resolve(process.cwd(), 'bin/llama/cpu/llama-server.exe'),
    resolve(process.cwd(), 'bin/llama/vulkan/llama-server.exe'),
    resolve(process.cwd(), 'bin/llama/cpu/llama-cli.exe')
  ];
  return candidates.find((path) => existsSync(path)) || '';
}

export function ggufPath(): string {
  return resolve(aiConfig.modelsDir, 'text/Qwen3-4B-Q4_K_M.gguf');
}

export function llamaReady(): boolean {
  return ready && Boolean(child) && !child.killed;
}

async function probeLlamaHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startLlamaServer(): Promise<{ ok: boolean; reason?: string }> {
  if (!aiConfig.enable.textGguf) return { ok: false, reason: 'disabled' };
  if (!existsSync(ggufPath())) return { ok: false, reason: 'gguf_missing' };
  const bin = llamaCliPath();
  if (!bin || !bin.includes('llama-server')) return { ok: false, reason: 'llama_server_missing' };
  if (llamaReady()) return { ok: true };

  const port = llamaServerPort();
  // Reuse an already-running local llama-server (manual or previous process).
  if (await probeLlamaHealth(port)) {
    ready = true;
    return { ok: true };
  }

  child = spawn(
    bin,
    [
      '-m',
      ggufPath(),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-c',
      '2048',
      '-n',
      '128',
      '-ngl',
      process.env.LLAMA_NGL || '0',
      '--jinja'
    ],
    { windowsHide: true, cwd: process.cwd() }
  );
  child.stderr?.on('data', () => undefined);
  child.stdout?.on('data', () => undefined);
  child.on('exit', () => {
    ready = false;
    child = null;
  });

  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        ready = true;
        return { ok: true };
      }
    } catch {
      /* wait for load */
    }
  }
  return { ok: false, reason: 'llama_server_timeout' };
}

export async function stopLlamaServer(): Promise<void> {
  if (child) {
    child.kill();
    child = null;
  }
  ready = false;
}

export async function completeWithLlama(prompt: string, nPredict = 96): Promise<{
  ok: boolean;
  text?: string;
  reason?: string;
}> {
  if (!llamaReady()) {
    const started = await startLlamaServer();
    if (!started.ok) return { ok: false, reason: started.reason || 'llama_unavailable' };
  }
  const port = llamaServerPort();
  // Qwen3 chat template + /no_think keeps local CPU completions short and usable.
  const chatPrompt =
    `<|im_start|>system\nYou are Tawasul offline assistant. Be concise. Reply with the asked format only.<|im_end|>\n` +
    `<|im_start|>user\n${prompt}\n/no_think<|im_end|>\n` +
    `<|im_start|>assistant\n`;
  const res = await fetch(`http://127.0.0.1:${port}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: chatPrompt,
      n_predict: nPredict,
      temperature: 0.2,
      stop: ['</s>', '<|im_end|>', '<|endoftext|>']
    })
  });
  if (!res.ok) return { ok: false, reason: `llama_http_${res.status}` };
  const body = (await res.json()) as { content?: string };
  let text = String(body.content || '').trim();
  // Strip accidental think blocks if the template still emits them.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return { ok: true, text };
}
