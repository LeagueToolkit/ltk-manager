#!/usr/bin/env node
/**
 * size-guard.mjs — PreToolUse hook (Write only)
 * Blocks writes >1000 lines, warns >500 lines.
 * FR-021, AC-018
 */

import { readStdin, writeOutput, blockToolCall, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const content = input.tool_input?.content;
if (!content) process.exit(0);

const timer = createHookTimer('size-guard', 'PreToolUse', input.tool_name || '');

const lineCount = content.split('\n').length;

if (lineCount > 1000) {
  timer.report('blocked', `${lineCount} lines exceeds hard limit`);
  blockToolCall(
    `File too large (${lineCount} lines). ` +
    `Split into smaller modules per architecture principles. ` +
    `Maximum recommended: 500 lines, hard limit: 1000 lines.`
  );
}

if (lineCount > 500) {
  timer.report('pass', `${lineCount} lines — warning issued`);
  writeOutput(
    `Warning: File is ${lineCount} lines. Consider splitting into smaller modules ` +
    `for maintainability. Hard limit is 1000 lines.`
  );
  process.exit(0);
}

timer.report('pass');
process.exit(0);
