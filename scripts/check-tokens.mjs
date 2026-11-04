#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(root, 'apps/web/src');
const tokensDir = join(webSrc, 'styles/tokens');
const rolesFile = join(tokensDir, 'roles.css');

const COLOR_LITERAL = /#(?:[0-9a-f]{3,8})\b|\brgba?\(|\bhsla?\(/i;
const PRIMITIVE_VAR = /var\(\s*--p-[a-z0-9-]+\s*\)/i;

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(css|ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

let failed = false;

for (const file of walk(webSrc)) {
  const rel = relative(root, file);
  const inTokens = file.startsWith(tokensDir + '/') || file === tokensDir;
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!inTokens && COLOR_LITERAL.test(line)) {
      console.error(`${rel}:${lineNo}: colour literal is only allowed under styles/tokens/`);
      console.error(`  ${line.trim()}`);
      failed = true;
    }
    if (PRIMITIVE_VAR.test(line) && file !== rolesFile) {
      console.error(`${rel}:${lineNo}: var(--p-…) is only allowed in styles/tokens/roles.css`);
      console.error(`  ${line.trim()}`);
      failed = true;
    }
  });
}

if (failed) {
  process.exit(1);
}

console.log('check-tokens: ok');
