/**
 * Copy the ONNX Runtime Web runtime binaries into public/ort/ so the app serves
 * them from its own origin (works offline and behind restricted networks).
 */

import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const target = join(root, 'public', 'ort');

if (!existsSync(source)) {
  console.warn('onnxruntime-web is not installed yet; run npm install first.');
  process.exit(0);
}

await mkdir(target, { recursive: true });
const entries = await readdir(source);
const wanted = entries.filter((name) => name.endsWith('.wasm') || name.endsWith('.mjs'));
for (const name of wanted) {
  await cp(join(source, name), join(target, name));
}
console.log(`copied ${wanted.length} ONNX Runtime Web files into public/ort/`);
