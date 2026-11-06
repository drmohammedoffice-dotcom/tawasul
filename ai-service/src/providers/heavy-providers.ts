import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiConfig } from '../config';
import { ModelRegistry } from '../registry/model-registry';
import { completeWithLlama, ggufPath, llamaReady, startLlamaServer } from '../llama/server-manager';
import { runPythonWorker } from './python-worker';

export type ProviderResult =
  | { ok: true; provider: string; modelId: string; data: Record<string, unknown> }
  | { ok: false; status: 'model_missing' | 'disabled' | 'unavailable'; reason: string; modelId?: string };

const registry = new ModelRegistry();

function markInstalled(rel: string): void {
  const abs = join(aiConfig.modelsDir, rel);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, '.installed'), new Date().toISOString());
}

export async function ensureLlama(): Promise<ProviderResult | null> {
  if (!aiConfig.enable.textGguf) return { ok: false, status: 'disabled', reason: 'ENABLE_TEXT_GGUF=false', modelId: 'qwen3-4b-q4_k_m' };
  if (!existsSync(ggufPath())) {
    return {
      ok: false,
      status: 'model_missing',
      reason: `Missing ${ggufPath()}`,
      modelId: 'qwen3-4b-q4_k_m'
    };
  }
  if (!llamaReady()) {
    const started = await startLlamaServer();
    if (!started.ok) return { ok: false, status: 'unavailable', reason: started.reason || 'llama_start_failed', modelId: 'qwen3-4b-q4_k_m' };
  }
  return null;
}

export async function runGgufText(prompt: string): Promise<ProviderResult> {
  const blocked = await ensureLlama();
  if (blocked) return blocked;
  const instruction =
    'You are Tawasul local text analyzer. Extract topics/keywords for public social posts. ' +
    'Reply in compact JSON with keys topics (array of strings) and keywords (array of strings). No private data.\n\n' +
    `Post:\n${prompt.slice(0, 1200)}\n\nJSON:`;
  const result = await completeWithLlama(instruction, 120);
  if (!result.ok) return { ok: false, status: 'unavailable', reason: result.reason || 'llama_failed', modelId: 'qwen3-4b-q4_k_m' };
  return {
    ok: true,
    provider: 'llama.cpp',
    modelId: 'qwen3-4b-q4_k_m',
    data: { text: result.text || '', raw: result.text || '' }
  };
}

export async function runOcr(imagePath: string): Promise<ProviderResult> {
  const model = registry.get('easyocr-ar-en') || registry.get('paddleocr-arabic-pp-ocrv5');
  if (!aiConfig.enable.ocr) return { ok: false, status: 'disabled', reason: 'ENABLE_OCR=false', modelId: 'easyocr-ar-en' };
  const out = await runPythonWorker('worker_ocr.py', { path: imagePath }, 240_000);
  if (out.ok) {
    markInstalled('ocr');
    return {
      ok: true,
      provider: String(out.provider || 'easyocr'),
      modelId: String(out.modelId || model?.id || 'easyocr-ar-en'),
      data: (out.data as Record<string, unknown>) || out
    };
  }
  return {
    ok: false,
    status: 'unavailable',
    reason: String(out.reason || 'ocr_failed'),
    modelId: 'easyocr-ar-en'
  };
}

export async function runVision(imagePath: string): Promise<ProviderResult> {
  if (!aiConfig.enable.vision && !aiConfig.enable.ocr) {
    return { ok: false, status: 'disabled', reason: 'ENABLE_VISION/OCR=false', modelId: 'qwen3-vl-4b' };
  }
  // Local fallback: OCR + metadata (Qwen3-VL weights not shipped in this pass).
  const out = await runPythonWorker('worker_vision_caption.py', { path: imagePath }, 240_000);
  if (out.ok) {
    markInstalled('ocr');
    return {
      ok: true,
      provider: String(out.provider || 'local-vision-ocr'),
      modelId: String(out.modelId || 'easyocr-ar-en'),
      data: (out.data as Record<string, unknown>) || out
    };
  }
  return { ok: false, status: 'unavailable', reason: String(out.reason || 'vision_failed'), modelId: 'qwen3-vl-4b' };
}

/** Real image NSFW classification (Falconsai ViT). Not a language-model substitute. */
export async function runNsfw(imagePath: string): Promise<ProviderResult> {
  if (!aiConfig.enable.nsfw) {
    return {
      ok: false,
      status: 'disabled',
      reason: 'ENABLE_NSFW=false',
      modelId: 'falconsai-nsfw-image-detection'
    };
  }
  const out = await runPythonWorker(
    'worker_nsfw.py',
    { path: imagePath, modelDir: join(aiConfig.modelsDir, 'nsfw') },
    300_000
  );
  if (out.ok && out.inference !== false) {
    markInstalled('nsfw');
    return {
      ok: true,
      provider: String(out.provider || 'transformers'),
      modelId: String(out.modelId || 'Falconsai/nsfw_image_detection'),
      data: {
        ...(out as Record<string, unknown>),
        label: out.label,
        nsfwScore: out.nsfwScore,
        normalScore: out.normalScore,
        modelVersion: out.modelVersion,
        inference: true,
        weightsLoaded: out.weightsLoaded !== false,
        elapsedMs: out.elapsedMs
      }
    };
  }
  return {
    ok: false,
    status: 'unavailable',
    reason: String(out.reason || 'nsfw_failed'),
    modelId: 'falconsai-nsfw-image-detection'
  };
}

export async function runWhisper(audioPath: string): Promise<ProviderResult> {
  if (!aiConfig.enable.whisper) return { ok: false, status: 'disabled', reason: 'ENABLE_WHISPER=false', modelId: 'faster-whisper-small' };
  const out = await runPythonWorker(
    'worker_whisper.py',
    { path: audioPath, modelDir: join(aiConfig.modelsDir, 'speech') },
    300_000
  );
  if (out.ok) {
    markInstalled('speech/faster-whisper-small');
    return {
      ok: true,
      provider: 'faster-whisper',
      modelId: 'faster-whisper-small',
      data: (out.data as Record<string, unknown>) || out
    };
  }
  return { ok: false, status: 'unavailable', reason: String(out.reason || 'whisper_failed'), modelId: 'faster-whisper-small' };
}

export async function runEmbedding(texts: string[]): Promise<ProviderResult> {
  if (!aiConfig.enable.embeddings) return { ok: false, status: 'disabled', reason: 'ENABLE_EMBEDDINGS=false', modelId: 'bge-m3' };
  const out = await runPythonWorker(
    'worker_embed.py',
    { texts, modelDir: join(aiConfig.modelsDir, 'embeddings/bge-m3') },
    300_000
  );
  if (out.ok) {
    markInstalled('embeddings/bge-m3');
    return {
      ok: true,
      provider: 'bge-m3',
      modelId: 'bge-m3',
      data: (out.data as Record<string, unknown>) || out
    };
  }
  return { ok: false, status: 'unavailable', reason: String(out.reason || 'embed_failed'), modelId: 'bge-m3' };
}

export function ffmpegAvailable(): boolean {
  return Boolean(process.env.PATH && process.env.PATH.toLowerCase().includes('ffmpeg')) || existsSync('C:\\ffmpeg\\bin\\ffmpeg.exe');
}
