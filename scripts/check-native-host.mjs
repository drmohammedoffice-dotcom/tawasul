import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('frontend/dist/assets');
const file = fs.readdirSync(dir).find((f) => f.startsWith('index-') && f.endsWith('.js'));
const s = fs.readFileSync(path.join(dir, file), 'utf8');
const m = s.match(/VITE_NATIVE_API_HOST:"([^"]+)"/);
console.log(file, m ? m[1] : 'NOT_FOUND');
