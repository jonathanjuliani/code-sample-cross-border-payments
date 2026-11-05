#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetName = 'ibm-plex-sans-latin-400-normal.woff2';

/** @param {string} dir */
function findFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === '.git' || entry === 'dist') continue;
      const found = findFile(full);
      if (found) return found;
    } else if (entry === targetName && full.includes(`${join('ibm-plex-sans', 'files')}`)) {
      return full;
    }
  }
  return null;
}

const src = findFile(join(root, 'node_modules'));
if (!src) {
  console.warn('copy-fonts: IBM Plex Sans woff2 not found (install dependencies first)');
  process.exit(0);
}
const destDir = join(root, 'apps/web/public/fonts');
mkdirSync(destDir, { recursive: true });
cpSync(src, join(destDir, targetName));
console.log('copy-fonts: ok');
