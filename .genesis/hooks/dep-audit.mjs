#!/usr/bin/env node
/**
 * dep-audit.mjs — PostToolUse hook (Write|Edit)
 * Checks written dependency files against constitutional forbidden list.
 * FR-020, AC-017
 */

import path from 'node:path';
import { readStdin, blockToolCall, createHookTimer } from './_utils.mjs';

const FORBIDDEN_PATTERNS = [
  { pattern: /\bsass\b/i, name: 'sass', reason: 'CSS preprocessor', alt: 'CSS custom properties' },
  { pattern: /\bless\b/i, name: 'less', reason: 'CSS preprocessor', alt: 'CSS custom properties' },
  { pattern: /\bpostcss\b/i, name: 'postcss', reason: 'CSS preprocessor', alt: 'CSS custom properties' },
  { pattern: /\bstylus\b/i, name: 'stylus', reason: 'CSS preprocessor', alt: 'CSS custom properties' },
  { pattern: /\bmaterial-ui\b|\b@mui\b/i, name: 'Material UI', reason: 'component library', alt: 'custom design system' },
  { pattern: /\bbootstrap\b/i, name: 'Bootstrap', reason: 'component library', alt: 'custom design system' },
  { pattern: /\btailwindcss\b/i, name: 'Tailwind', reason: 'CSS framework', alt: 'CSS custom properties' },
  { pattern: /\bdiesel\b/i, name: 'diesel', reason: 'forbidden ORM', alt: 'SQLx' },
  { pattern: /\bsea-orm\b/i, name: 'sea-orm', reason: 'forbidden ORM', alt: 'SQLx' },
  { pattern: /\belectron\b/i, name: 'electron', reason: 'forbidden runtime', alt: 'Tauri' },
  { pattern: /\banalytics\b(?!.*umami)/i, name: 'analytics', reason: 'external analytics', alt: 'Umami (self-hosted)' },
];

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';
const basename = path.basename(filePath);

// Only check dependency files
if (basename !== 'Cargo.toml' && basename !== 'package.json') {
  process.exit(0);
}

const content = input.tool_input?.content || input.tool_input?.new_string || '';
if (!content) process.exit(0);

const timer = createHookTimer('dep-audit', 'PostToolUse', input.tool_name || '');

const violations = [];
for (const { pattern, name, reason, alt } of FORBIDDEN_PATTERNS) {
  if (pattern.test(content)) {
    violations.push(`${name} (${reason}) — use ${alt} instead`);
  }
}

if (violations.length > 0) {
  timer.report('block', `${violations.length} forbidden dependencies`);
  blockToolCall(
    `Constitutional violation in ${basename}: forbidden dependencies detected.\n` +
    violations.map((v) => `  - ${v}`).join('\n') +
    `\nPer constitution §2 Forbidden list. Remove the forbidden dependency and use the approved alternative.`
  );
} else {
  timer.report('pass');
}

process.exit(0);
