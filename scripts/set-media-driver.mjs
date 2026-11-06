import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const driver = (process.argv[2] || '').toLowerCase();
if (!['local', 's3', 'r2'].includes(driver)) {
  console.error('Usage: node scripts/set-media-driver.mjs <local|s3|r2>');
  process.exit(1);
}
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
if (!existsSync(envPath)) {
  console.error('Missing backend/.env');
  process.exit(1);
}
let content = readFileSync(envPath, 'utf8');
if (/(?:^|\n)MEDIA_STORAGE_DRIVER=/.test(content)) {
  content = content.replace(/(?:^|\n)MEDIA_STORAGE_DRIVER=.*/g, (m) =>
    `${m.startsWith('\n') ? '\n' : ''}MEDIA_STORAGE_DRIVER=${driver}`
  );
} else {
  content += `\nMEDIA_STORAGE_DRIVER=${driver}\n`;
}
writeFileSync(envPath, content, 'utf8');
console.log(`MEDIA_STORAGE_DRIVER=${driver}`);
