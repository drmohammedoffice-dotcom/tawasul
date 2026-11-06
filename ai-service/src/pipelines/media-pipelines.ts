import { spawn } from 'node:child_process';
import { runOcr, runVision, runWhisper, ffmpegAvailable } from '../providers/heavy-providers';

/** Sample a few frames with FFmpeg when available. Does not load vision models. */
export async function probeVideo(path: string): Promise<{
  ffmpeg: boolean;
  framesPlan: number[];
  vision: ReturnType<typeof runVision>;
  ocr: ReturnType<typeof runOcr>;
  audio: ReturnType<typeof runWhisper>;
}> {
  const ffmpeg = ffmpegAvailable();
  // Smart sampling: 10%, 50%, 90% — analysis runs only after models are installed.
  const framesPlan = [0.1, 0.5, 0.9];
  return {
    ffmpeg,
    framesPlan,
    vision: runVision(path),
    ocr: runOcr(path),
    audio: runWhisper(path)
  };
}

export function extractAudioTrack(inputPath: string, outputPath: string): Promise<{ ok: boolean; reason?: string }> {
  if (!ffmpegAvailable()) return Promise.resolve({ ok: false, reason: 'ffmpeg_missing' });
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', outputPath], {
      windowsHide: true
    });
    child.on('error', () => resolve({ ok: false, reason: 'ffmpeg_spawn_failed' }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: 'ffmpeg_failed' }));
  });
}
