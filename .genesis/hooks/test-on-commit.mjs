#!/usr/bin/env node
/**
 * test-on-commit.mjs — PostToolUse hook (Bash)
 * Runs tests automatically when git commit is detected.
 * FR-019, AC-016
 */

import { execFileSync } from 'node:child_process';
import { readStdin, writeOutput, PROJECT_DIR, createHookTimer } from './_utils.mjs';
import path from 'node:path';

const input = await readStdin();
if (!input) process.exit(0);

const command = input.tool_input?.command || '';
if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

const timer = createHookTimer('test-on-commit', 'PostToolUse', input.tool_name || '');

const results = [];

// Run Rust tests
try {
  const rustResult = execFileSync('cargo', ['test', '--lib'], {
    cwd: PROJECT_DIR,
    encoding: 'utf-8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lastLines = rustResult.split('\n').slice(-5).join('\n');
  results.push(`Rust tests: ${lastLines.includes('FAILED') ? 'FAILED' : 'passed'}\n${lastLines}`);
} catch (e) {
  const output = (e.stdout || e.stderr || '').split('\n').slice(-5).join('\n');
  results.push(`Rust tests: FAILED\n${output}`);
}

// Run JS tests if vitest is configured
try {
  const jsResult = execFileSync('npx', ['vitest', 'run', '--reporter=verbose'], {
    cwd: path.join(PROJECT_DIR, 'Genesis'),
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lastLines = jsResult.split('\n').slice(-5).join('\n');
  results.push(`JS tests: ${lastLines.includes('FAIL') ? 'FAILED' : 'passed'}\n${lastLines}`);
} catch (e) {
  // Distinguish genuine test failures from "vitest not configured"
  const output = e.stdout || e.stderr || '';
  if (output.includes('FAIL') || output.includes('Tests  ')) {
    const lastLines = output.split('\n').slice(-5).join('\n');
    results.push(`JS tests: FAILED\n${lastLines}`);
  }
  // Otherwise vitest not configured — skip silently
}

if (results.length > 0) {
  const hasFailed = results.some((r) => r.includes('FAILED'));
  timer.report(hasFailed ? 'fail' : 'pass', hasFailed ? 'tests failed' : 'tests passed');
  writeOutput(`Post-commit test results:\n${results.join('\n\n')}`);
} else {
  timer.report('pass', 'no test results');
}

process.exit(0);
