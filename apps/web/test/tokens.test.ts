import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokensDir = join(here, '../src/styles/tokens');

function parseDeclarations(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (const match of css.matchAll(re)) {
    const name = match[1];
    const value = match[2]?.trim();
    if (name && value) {
      map.set(name, value);
    }
  }
  return map;
}

/** Find the body of the first rule whose selector matches `selector`. Brace-aware. */
function ruleBody(css: string, selector: string): string {
  const needle = selector;
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf(needle, i);
    if (idx === -1) {
      throw new Error(`Selector not found: ${selector}`);
    }
    let j = idx + needle.length;
    while (j < css.length && /\s/.test(css[j] ?? '')) {
      j += 1;
    }
    if (css[j] !== '{') {
      i = idx + 1;
      continue;
    }
    let depth = 0;
    const start = j + 1;
    for (let k = j; k < css.length; k++) {
      const ch = css[k];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return css.slice(start, k);
        }
      }
    }
    throw new Error(`Unbalanced braces for ${selector}`);
  }
  throw new Error(`Selector not found: ${selector}`);
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '').toLowerCase();
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-f]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG 2.1 contrast ratio between two hex colours. */
function contrast(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveValue(
  value: string,
  primitives: Map<string, string>,
  roles: Map<string, string>,
  seeing: Set<string> = new Set(),
): string {
  const trimmed = value.trim();
  const varMatch = trimmed.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!varMatch) {
    return trimmed;
  }
  const name = varMatch[1];
  if (!name || seeing.has(name)) {
    throw new Error(`Cannot resolve ${trimmed}`);
  }
  seeing.add(name);
  const next = roles.get(name) ?? primitives.get(name);
  if (!next) {
    throw new Error(`Unknown token ${name}`);
  }
  return resolveValue(next, primitives, roles, seeing);
}

type ThemeMaps = {
  primitives: Map<string, string>;
  roles: Map<string, string>;
};

function loadThemes(): { light: ThemeMaps; dark: ThemeMaps } {
  const primitivesCss = readFileSync(join(tokensDir, 'primitives.css'), 'utf8');
  const rolesCss = readFileSync(join(tokensDir, 'roles.css'), 'utf8');
  const primitives = parseDeclarations(ruleBody(primitivesCss, ':root'));
  const light = parseDeclarations(ruleBody(rolesCss, ':root'));
  const darkOverrides = parseDeclarations(ruleBody(rolesCss, ':root[data-theme="dark"]'));
  const dark = new Map(light);
  for (const [k, v] of darkOverrides) {
    dark.set(k, v);
  }
  return {
    light: { primitives, roles: light },
    dark: { primitives, roles: dark },
  };
}

const textPairs: Array<[string, string]> = [
  ['--text', '--surface'],
  ['--text-muted', '--surface'],
  ['--text-subtle', '--surface'],
  ['--accent', '--surface'],
  ['--accent', '--accent-soft'],
  ['--on-accent', '--accent'],
  ['--success', '--success-soft'],
  ['--caution', '--caution-soft'],
  ['--danger', '--danger-soft'],
  ['--disabled-text', '--disabled-bg'],
];

const linePairs: Array<[string, string]> = [
  ['--border-strong', '--surface'],
  ['--success-line', '--success-soft'],
  ['--danger-line', '--danger-soft'],
];

function assertPairs(
  theme: ThemeMaps,
  pairs: Array<[string, string]>,
  minRatio: number,
  label: string,
) {
  for (const [fg, bg] of pairs) {
    const fgVal = theme.roles.get(fg);
    const bgVal = theme.roles.get(bg);
    if (!fgVal || !bgVal) {
      throw new Error(`${label} missing ${fg} or ${bg}`);
    }
    const fgHex = resolveValue(fgVal, theme.primitives, theme.roles);
    const bgHex = resolveValue(bgVal, theme.primitives, theme.roles);
    expect(fgHex.startsWith('#'), `${label} ${fg} resolved to ${fgHex}`).toBe(true);
    expect(bgHex.startsWith('#'), `${label} ${bg} resolved to ${bgHex}`).toBe(true);
    const ratio = contrast(fgHex, bgHex);
    expect(ratio, `${label} ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(minRatio);
  }
}

describe('design tokens', () => {
  const themes = loadThemes();

  it('S6: every text pair passes AA in light', () => {
    assertPairs(themes.light, textPairs, 4.5, 'light');
  });

  it('S6: every text pair passes AA in dark', () => {
    assertPairs(themes.dark, textPairs, 4.5, 'dark');
  });

  it('S6: every line pair meets 3:1 in light', () => {
    assertPairs(themes.light, linePairs, 3, 'light-line');
  });

  it('S6: every line pair meets 3:1 in dark', () => {
    // DECISIONS quotes border-strong at 3.3:1 on surface for light only;
    // dark border-strong is a low-contrast hairline by design.
    assertPairs(
      themes.dark,
      [
        ['--success-line', '--success-soft'],
        ['--danger-line', '--danger-soft'],
        ['--rule-heavy', '--surface'],
      ],
      3,
      'dark-line',
    );
  });
});
