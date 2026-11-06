import { execFile } from 'node:child_process';
import { freemem, loadavg, totalmem } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ResourceSnapshot = {
  ramTotalMb: number;
  ramFreeMb: number;
  cpuLoad: number[];
  gpu: null | {
    name: string;
    memoryTotalMiB: number;
    memoryFreeMiB: number;
    memoryUsedMiB: number;
    utilizationPct: number | null;
  };
  at: string;
};

export async function readResources(): Promise<ResourceSnapshot> {
  const snap: ResourceSnapshot = {
    ramTotalMb: Math.round(totalmem() / (1024 * 1024)),
    ramFreeMb: Math.round(freemem() / (1024 * 1024)),
    cpuLoad: loadavg(),
    gpu: null,
    at: new Date().toISOString()
  };
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free,memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: 3000, windowsHide: true }
    );
    const line = stdout.trim().split(/\r?\n/)[0];
    if (line) {
      const [name, total, free, used, util] = line.split(',').map((part) => part.trim());
      snap.gpu = {
        name,
        memoryTotalMiB: Number(total) || 0,
        memoryFreeMiB: Number(free) || 0,
        memoryUsedMiB: Number(used) || 0,
        utilizationPct: Number.isFinite(Number(util)) ? Number(util) : null
      };
    }
  } catch {
    snap.gpu = null;
  }
  return snap;
}
