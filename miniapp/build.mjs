import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const outDir = path.resolve(__dirname, '..', 'miniapp-dist');

async function copyDirRecursive(fromDir, toDir) {
  await fs.mkdir(toDir, { recursive: true });
  let count = 0;
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(fromDir, entry.name);
    const destPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      count += await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
      count += 1;
    }
  }
  return count;
}

await fs.rm(outDir, { recursive: true, force: true });
const totalFiles = await copyDirRecursive(srcDir, outDir);

console.log(`✓ Mini App static bundle built into miniapp-dist/ (${totalFiles} files)`);
