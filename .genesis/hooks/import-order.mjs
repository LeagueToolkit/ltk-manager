#!/usr/bin/env node
/**
 * import-order.mjs — PostToolUse hook (Write|Edit)
 * Validates import ordering per constitution §4.
 * FR-022, AC-019
 */

import path from 'node:path';
import fs from 'node:fs';
import { readStdin, writeOutput, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();

// Early exit for irrelevant file types
const CHECKABLE_EXTS = ['.rs', '.ts', '.js', '.mjs', '.svelte'];
if (!CHECKABLE_EXTS.includes(ext)) process.exit(0);

const timer = createHookTimer('import-order', 'PostToolUse', input.tool_name || '');

// Read the actual file content (post-write)
let content;
try {
  content = fs.readFileSync(filePath, 'utf-8');
} catch {
  timer.report('pass', 'file not readable');
  process.exit(0);
}

if (ext === '.rs') {
  checkRustImports(content, filePath);
} else if (['.ts', '.svelte', '.js', '.mjs'].includes(ext)) {
  checkJsImports(content, filePath);
}

timer.report('pass');
process.exit(0);

function checkRustImports(content, filePath) {
  const useLines = content.split('\n').filter((l) => l.trimStart().startsWith('use '));
  if (useLines.length < 2) return;

  let lastCategory = -1;
  const violations = [];

  for (const line of useLines) {
    const trimmed = line.trim();
    let category;
    if (trimmed.startsWith('use std::') || trimmed.startsWith('use core::')) {
      category = 0; // std
    } else if (trimmed.startsWith('use crate::') || trimmed.startsWith('use super::')) {
      category = 2; // internal
    } else {
      category = 1; // external
    }

    if (category < lastCategory) {
      violations.push(`"${trimmed}" is out of order`);
    }
    lastCategory = category;
  }

  if (violations.length > 0) {
    writeOutput(
      `Import order violation in ${path.basename(filePath)} (per constitution §4):\n` +
      `Expected: std → external crates → internal crates\n` +
      violations.slice(0, 3).join('\n')
    );
  }
}

function checkJsImports(content, filePath) {
  // For .svelte, extract script section
  const fileExt = path.extname(filePath).toLowerCase();
  let scriptContent = content;
  if (fileExt === '.svelte') {
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return;
    scriptContent = scriptMatch[1];
  }

  const importLines = scriptContent.split('\n').filter((l) => l.trimStart().startsWith('import '));
  if (importLines.length < 2) return;

  let lastCategory = -1;
  const violations = [];

  for (const line of importLines) {
    const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    if (!fromMatch) continue;
    const source = fromMatch[1];

    let category;
    if (source.startsWith('node:') || /^(fs|path|child_process|url|crypto|os|util|http|https|stream|events|buffer|assert)$/.test(source)) {
      category = 0; // Node built-ins
    } else if (source.startsWith('@sveltejs/') || source.startsWith('svelte') || source.startsWith('@tauri')) {
      category = 1; // Framework
    } else if (source.startsWith('.') || source.startsWith('$lib') || source.startsWith('$app')) {
      category = 3; // Local
    } else {
      category = 2; // Library
    }

    if (category < lastCategory) {
      const trimmed = line.trim();
      const display = trimmed.length > 80 ? trimmed.slice(0, 80) + '...' : trimmed;
      violations.push(`"${display}" is out of order`);
    }
    lastCategory = category;
  }

  if (violations.length > 0) {
    writeOutput(
      `Import order violation in ${path.basename(filePath)} (per constitution §4):\n` +
      `Expected: Node built-ins → framework → library → local\n` +
      violations.slice(0, 3).join('\n')
    );
  }
}
