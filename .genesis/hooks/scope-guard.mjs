#!/usr/bin/env node
/**
 * scope-guard.mjs — PreToolUse hook (Write|Edit)
 * Blocks writes to files outside the expected scope for the current task.
 * FR-005, AC-005
 */

import { readStdin, getEnvVar, blockToolCall, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const expectedOutputsRaw = getEnvVar('GENESIS_EXPECTED_OUTPUTS');
if (!expectedOutputsRaw) process.exit(0); // No enforcement if not set

const expectedOutputs = expectedOutputsRaw.split(',').map((p) => p.trim()).filter(Boolean);
if (expectedOutputs.length === 0) process.exit(0);

const timer = createHookTimer('scope-guard', 'PreToolUse', input.tool_name || '');

// Normalize path for comparison (forward slashes, lowercase)
const normalize = (p) => p.replace(/\\/g, '/').toLowerCase();
const normalizedFile = normalize(filePath);

// Allow test files always
if (/\btest[s]?\b/i.test(normalizedFile) || normalizedFile.includes('__tests__')) {
  timer.report('pass', 'test file — always allowed');
  process.exit(0);
}

// Check if file matches any expected output
const isInScope = expectedOutputs.some((expected) => {
  const normalizedExpected = normalize(expected);
  return normalizedFile.endsWith(normalizedExpected) ||
    normalizedExpected.endsWith(normalizedFile.split('/').slice(-2).join('/'));
});

if (!isInScope) {
  timer.report('blocked', `out of scope: ${filePath}`);
  blockToolCall(
    `File ${filePath} is outside expected scope for this task. ` +
    `Expected: ${expectedOutputs.join(', ')}. ` +
    `Add to expected_outputs if intentional.`
  );
}

timer.report('pass');
process.exit(0);
