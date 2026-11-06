import { spawnSync } from 'node:child_process';

const maxAttempts = 36;
for (let i = 1; i <= maxAttempts; i++) {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`DOCKER_READY after attempt ${i}`);
    process.exit(0);
  }
  console.log(`waiting docker... ${i}/${maxAttempts}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}
console.error('DOCKER_TIMEOUT');
process.exit(1);
