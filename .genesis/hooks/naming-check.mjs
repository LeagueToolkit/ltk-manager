#!/usr/bin/env node
/**
 * naming-check.mjs — PostToolUse hook (Write)
 * Validates filename conventions per constitution §4.
 * FR-023, AC-020
 */

import path from 'node:path';
import { readStdin, writeOutput, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
const basename = path.basename(filePath, ext);

// Skip special files
if (basename.startsWith('+') || basename.startsWith('_') || basename.startsWith('.')) {
  process.exit(0);
}

// Skip files in node_modules, .genesis hooks, etc.
if (filePath.includes('node_modules') || filePath.includes('.genesis/hooks/')) {
  process.exit(0);
}

const timer = createHookTimer('naming-check', 'PostToolUse', input.tool_name || '');

let violation = null;

if (ext === '.rs') {
  // Rust: must be snake_case
  if (!/^[a-z][a-z0-9_]*$/.test(basename) && basename !== 'mod' && basename !== 'lib' && basename !== 'main') {
    violation = `Rust files must be snake_case. Rename: ${basename}${ext} → ${toSnakeCase(basename)}${ext}`;
  }
} else if (ext === '.svelte') {
  // Svelte components: PascalCase (except +page, +layout, +error, +server)
  if (!basename.startsWith('+') && !/^[A-Z][a-zA-Z0-9]*$/.test(basename)) {
    violation = `Svelte components must be PascalCase. Rename: ${basename}${ext} → ${toPascalCase(basename)}${ext}`;
  }
} else if (ext === '.ts' && (filePath.includes('services') || filePath.includes('stores'))) {
  // TS services/stores: camelCase
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-z]+)*$/.test(basename)) {
    violation = `TS services/stores must be camelCase. Rename: ${basename}${ext} → ${toCamelCase(basename)}${ext}`;
  }
} else if (ext === '.ts') {
  // General TS files: kebab-case or camelCase
  if (!/^[a-z][a-z0-9-]*$/.test(basename) && !/^[a-z][a-zA-Z0-9]*(\.[a-z]+)*$/.test(basename)) {
    violation = `TS files must be kebab-case or camelCase. Rename: ${basename}${ext}`;
  }
} else if (ext === '.md') {
  // Markdown: kebab-case
  const UPPERCASE_CONVENTIONAL = ['CLAUDE', 'README', 'LICENSE', 'CHANGELOG', 'MEMORY', 'CONTRIBUTING'];
  if (!/^[a-z][a-z0-9-]*$/.test(basename) && !UPPERCASE_CONVENTIONAL.some(u => basename.toUpperCase().includes(u))) {
    violation = `Markdown files must be kebab-case. Rename: ${basename}${ext} → ${toKebabCase(basename)}${ext}`;
  }
} else if (ext === '.css') {
  // CSS: kebab-case
  if (!/^[a-z][a-z0-9-]*$/.test(basename)) {
    violation = `CSS files must be kebab-case. Rename: ${basename}${ext} → ${toKebabCase(basename)}${ext}`;
  }
}

if (violation) {
  timer.report('fail', violation);
  writeOutput(`Naming violation: ${violation} (per constitution §4)`);
} else {
  timer.report('pass');
}

process.exit(0);

function toSnakeCase(s) {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/-/g, '_');
}

function toPascalCase(s) {
  return s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

function toCamelCase(s) {
  const pascal = toPascalCase(s);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toKebabCase(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/_/g, '-');
}
