#!/usr/bin/env node
/**
 * css-token-check.mjs — PostToolUse hook (Write|Edit)
 * Detects hardcoded CSS values in .svelte/.css files and suggests design system tokens.
 * FR-024, AC-021
 */

import path from 'node:path';
import fs from 'node:fs';
import { readStdin, writeOutput, createHookTimer } from './_utils.mjs';

// Map of common hardcoded hex values to CSS custom properties (from constitution §13)
const HEX_TO_TOKEN = {
  '#09090b': 'var(--bg)',
  '#0f0f12': 'var(--bg-elevated)',
  '#131316': 'var(--bg-card)',
  '#1a1a1f': 'var(--bg-card-hover)',
  '#ed0049': 'var(--accent)',
  '#ff2d6a': 'var(--accent-bright)',
  '#4ade80': 'var(--green)',
  '#fbbf24': 'var(--yellow)',
  '#22d3ee': 'var(--cyan)',
  '#fafafa': 'var(--text)',
  '#a1a1aa': 'var(--text-secondary)',
  '#8a8a95': 'var(--text-dim)',
  '#22c55e': 'var(--green)',   // green-500 alias (Tailwind variant)
  '#f59e0b': 'var(--yellow)', // amber-500 alias (Tailwind variant)
  '#3e88f2': 'var(--accent) /* or blue preset */',
  '#8b5cf6': 'var(--accent) /* or purple preset */',
  '#ec4899': 'var(--accent) /* or pink preset */',
  '#6366f1': 'var(--accent) /* or indigo preset */',
  '#14b8a6': 'var(--accent) /* or teal preset */',
  '#71717a': 'var(--text-dim)',
};

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';
const ext = path.extname(filePath).toLowerCase();

if (ext !== '.svelte' && ext !== '.css') process.exit(0);

const timer = createHookTimer('css-token-check', 'PostToolUse', input.tool_name || '');

// Read the actual file content
let content;
try {
  content = fs.readFileSync(filePath, 'utf-8');
} catch {
  timer.report('pass', 'file not readable');
  process.exit(0);
}

// For .svelte files, only check <style> blocks
if (ext === '.svelte') {
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  if (!styleMatch) { timer.report('pass', 'no style block'); process.exit(0); }
  content = styleMatch.join('\n');
}

// Skip CSS custom property declarations (--variable: #hex is intentional)
const lines = content.split('\n');
const suggestions = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();

  // Skip custom property declarations
  if (line.match(/^\s*--[a-z]/)) continue;
  // Skip comments
  if (line.startsWith('/*') || line.startsWith('//')) continue;
  // Skip lines already using var() — hex may be an intentional fallback
  if (line.includes('var(--')) continue;

  // Check for hardcoded hex colors
  const hexMatches = line.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const match of hexMatches) {
    const hex = '#' + match[1].toLowerCase();
    // Expand 3-char hex
    const fullHex = hex.length === 4
      ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
      : hex;

    const token = HEX_TO_TOKEN[fullHex];
    if (token) {
      suggestions.push(`Line ${i + 1}: '${fullHex}' → ${token}`);
    } else {
      suggestions.push(`Line ${i + 1}: hardcoded color '${hex}' — use a CSS custom property`);
    }
  }
}

if (suggestions.length > 0) {
  timer.report('fail', `${suggestions.length} hardcoded CSS values`);
  writeOutput(
    `Hardcoded CSS values found in ${path.basename(filePath)}. Use design system tokens:\n` +
    suggestions.slice(0, 10).join('\n')
  );
} else {
  timer.report('pass');
}

process.exit(0);
