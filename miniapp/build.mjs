import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const outDir = path.resolve(__dirname, '..', 'miniapp-dist');

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const entries = await fs.readdir(srcDir);
for (const file of entries) {
  await fs.copyFile(path.join(srcDir, file), path.join(outDir, file));
}

console.log(`✓ Mini App static bundle built into miniapp-dist/ (${entries.length} files)`);
