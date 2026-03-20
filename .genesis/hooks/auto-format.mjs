#!/usr/bin/env node
/**
 * auto-format.mjs — PostToolUse hook (Write|Edit, async)
 * Runs rustfmt or prettier asynchronously after writes.
 * FR-009, AC-012
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, GENESIS_DIR, PROJECT_DIR, safeReadJSON, safeWriteJSON, createHookTimer } from './_utils.mjs';

const TIMESTAMPS_FILE = path.join(GENESIS_DIR, '.file-timestamps.json');

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();

// Skip non-formattable file types before starting timer
if (ext !== '.rs' && !['.svelte', '.ts', '.js', '.css'].includes(ext)) process.exit(0);

const timer = createHookTimer('auto-format', 'PostToolUse', input.tool_name || '');

try {
  if (ext === '.rs') {
    execFileSync('rustfmt', [filePath], { cwd: PROJECT_DIR, timeout: 5000, stdio: 'ignore' });
  } else {
    execFileSync('npx', ['prettier', '--write', filePath], { cwd: PROJECT_DIR, timeout: 5000, stdio: 'ignore' });
  }

  // Update file timestamps after formatting
  const timestamps = safeReadJSON(TIMESTAMPS_FILE) || { files: {} };
  try {
    const stat = fs.statSync(filePath);
    timestamps.files[filePath] = {
      mtime: stat.mtime.toISOString(),
      lastAction: 'format',
      lastActionAt: new Date().toISOString(),
    };
    safeWriteJSON(TIMESTAMPS_FILE, timestamps);
  } catch {
    // File may not exist
  }
  timer.report('pass');
} catch {
  // Formatter not available or failed — silently continue
  timer.report('fail', 'formatter unavailable or failed');
}

process.exit(0);
