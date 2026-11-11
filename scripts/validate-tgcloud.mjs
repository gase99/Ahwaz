import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tgcloudDir = path.join(root, 'tgcloud');
const miniappSrcDir = path.join(root, 'miniapp', 'src');
const miniappDistDir = path.join(root, 'miniapp-dist');
const errors = [];

function checkJsSyntax(filePath, relLabel) {
  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  } catch (err) {
    const detail = String(err?.stderr ?? err?.message ?? '').trim().split('\n')[0];
    errors.push(`${relLabel}: JavaScript syntax error (${detail})`);
  }
}

function walkTgcloud(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relDir = path.relative(tgcloudDir, full).split(path.sep).join('/');
      if (relDir.startsWith('handlers/') || relDir.startsWith('endpoints/')) {
        errors.push(`Forbidden nested directory in flat folder: tgcloud/${relDir}`);
      }
      walkTgcloud(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function walkAllFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

const jsFiles = walkTgcloud(tgcloudDir);
const allowedBareSpecifiers = new Set(['sdk', 'sdk/db', 'sdk/api', 'sdk/fetch']);

for (const file of jsFiles) {
  const relFile = path.relative(root, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  checkJsSyntax(file, relFile);

  // Check imports & re-exports
  const importRegex = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const spec = match[1];
    if (spec.startsWith('.')) {
      if (!spec.endsWith('.js')) {
        errors.push(`${relFile}: relative import "${spec}" must end with .js`);
      }
      const target = path.resolve(path.dirname(file), spec);
      if (!target.startsWith(tgcloudDir + path.sep)) {
        errors.push(`${relFile}: import "${spec}" escapes tgcloud/ root`);
      } else if (!fs.existsSync(target)) {
        errors.push(`${relFile}: imported module "${spec}" does not exist`);
      }
    } else if (!allowedBareSpecifiers.has(spec)) {
      errors.push(`${relFile}: forbidden external/node import "${spec}" (only sdk/* allowed)`);
    }
  }

  // Disallow Node-only globals in V8 isolate modules
  if (/\bBuffer\./.test(source)) {
    errors.push(`${relFile}: uses Node Buffer (use Uint8Array / TextEncoder in V8 isolates)`);
  }
  if (/\bprocess\.env\b/.test(source)) {
    errors.push(`${relFile}: uses process.env (not available in Telegram Serverless V8 isolates)`);
  }
}

const schemaSource = fs.readFileSync(path.join(tgcloudDir, 'schema.js'), 'utf8');
if (/\.references\s*\(|foreignKey\s*\(/.test(schemaSource)) {
  errors.push('tgcloud/schema.js: foreignKey() and .references() are forbidden in Telegram Serverless');
}

// Validate Mini App source syntax (including components/*), DOM ID references, and built bundle parity
const miniappHtml = path.join(miniappSrcDir, 'index.html');
if (fs.existsSync(miniappSrcDir) && fs.existsSync(miniappHtml)) {
  const htmlSrc = fs.readFileSync(miniappHtml, 'utf8');
  const htmlIds = new Set(
    Array.from(htmlSrc.matchAll(/\bid=["']([^"']+)["']/g), (m) => m[1]),
  );

  const srcFiles = walkAllFiles(miniappSrcDir);
  for (const srcFile of srcFiles) {
    const relFromSrc = path.relative(miniappSrcDir, srcFile).split(path.sep).join('/');
    const relFromRoot = `miniapp/src/${relFromSrc}`;
    const srcContent = fs.readFileSync(srcFile, 'utf8');

    if (srcFile.endsWith('.js')) {
      checkJsSyntax(srcFile, relFromRoot);
      for (const m of srcContent.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!htmlIds.has(m[1])) {
          errors.push(`${relFromRoot}: getElementById('${m[1]}') missing in miniapp/src/index.html`);
        }
      }
    }

    const distPath = path.join(miniappDistDir, relFromSrc);
    if (!fs.existsSync(distPath)) {
      errors.push(`miniapp-dist/${relFromSrc}: missing built file (run npm run build)`);
    } else if (fs.readFileSync(distPath, 'utf8') !== srcContent) {
      errors.push(`miniapp-dist/${relFromSrc}: out of sync with ${relFromRoot} (run npm run build)`);
    }
  }
}

if (errors.length > 0) {
  console.error('❌ Telegram Serverless validation failed:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log(`✓ Validated ${jsFiles.length} tgcloud/ V8 modules & Mini App bundle — 100% Telegram Serverless compliant!`);
