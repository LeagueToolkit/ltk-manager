#!/usr/bin/env node
/**
 * compile-check.mjs — PostToolUse hook (Write|Edit)
 * Runs cargo check or svelte-check after file writes and returns errors as context.
 * FR-004, AC-004
 */

import { execFileSync } from 'node:child_process';
import { readStdin, writeOutput, safeReadJSON, safeWriteJSON, PROJECT_DIR, GENESIS_DIR, createHookTimer } from './_utils.mjs';
import path from 'node:path';

const TRANSACTION_FILE = path.join(GENESIS_DIR, '.transaction.json');

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();

// Skip non-checkable file types before starting timer
if (ext !== '.rs' && ext !== '.svelte' && ext !== '.ts') process.exit(0);

const timer = createHookTimer('compile-check', 'PostToolUse', input.tool_name || '');

let errors = '';

try {
  if (ext === '.rs') {
    const result = execFileSync('cargo', ['check', '--message-format=json'], {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse JSON lines for errors
    const errorMessages = result.split('\n')
      .filter((line) => line.trim())
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((msg) => msg && msg.reason === 'compiler-message' && msg.message?.level === 'error')
      .map((msg) => `${msg.message.message} at ${msg.message.spans?.[0]?.file_name || 'unknown'}:${msg.message.spans?.[0]?.line_start || '?'}`)
      .slice(0, 10);

    if (errorMessages.length > 0) {
      errors = `Rust compilation errors (${errorMessages.length}):\n` + errorMessages.join('\n');
    }
  } else if (ext === '.svelte' || ext === '.ts') {
    const result = execFileSync('npx', ['svelte-check', '--output', 'machine'], {
      cwd: path.join(PROJECT_DIR, 'Genesis'),
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Extract ERROR lines
    const errorLines = result.split('\n')
      .filter((line) => line.includes('ERROR'))
      .slice(0, 10);

    if (errorLines.length > 0) {
      errors = `Svelte/TS errors (${errorLines.length}):\n` + errorLines.join('\n');
    }
  }
} catch (e) {
  // Command failed — extract error output
  const output = e.stdout || e.stderr || e.message || '';
  if (ext === '.rs') {
    const errorLines = output.split('\n').filter((l) => l.includes('error[')).slice(0, 5);
    if (errorLines.length > 0) {
      errors = `Rust compilation errors:\n` + errorLines.join('\n');
    }
  } else {
    const errorLines = output.split('\n').filter((l) => l.includes('ERROR')).slice(0, 5);
    if (errorLines.length > 0) {
      errors = `Svelte/TS errors:\n` + errorLines.join('\n');
    }
  }
}

// Update transaction state
const transaction = safeReadJSON(TRANSACTION_FILE) || { lastCleanState: null, files: [] };
if (errors) {
  timer.report('fail', errors.split('\n')[0]);
  writeOutput(errors);
} else {
  // Clean compilation — reset transaction
  transaction.lastCleanState = new Date().toISOString();
  transaction.files = [];
  safeWriteJSON(TRANSACTION_FILE, transaction);
  timer.report('pass');
}

process.exit(0);
