#!/usr/bin/env node
/**
 * stale-read.mjs — PreToolUse hook (Read)
 * Warns when reading files that were modified externally since last recorded action.
 * Also hooks PostToolUse (Write|Edit) to update timestamps.
 * FR-014, AC-011
 */

import fs from 'node:fs';
import path from 'node:path';
import { readStdin, writeOutput, safeReadJSON, safeWriteJSON, GENESIS_DIR, createHookTimer } from './_utils.mjs';

const TIMESTAMPS_FILE = path.join(GENESIS_DIR, '.file-timestamps.json');

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

// Load timestamps database
let timestamps = safeReadJSON(TIMESTAMPS_FILE) || { files: {} };

const toolName = input.tool_name || '';
const timer = createHookTimer('stale-read', 'PreToolUse', toolName);

if (toolName === 'Read') {
  // Check if file was modified externally
  try {
    const stat = fs.statSync(filePath);
    const currentMtime = stat.mtime.toISOString();
    const record = timestamps.files[filePath];

    if (record && record.mtime !== currentMtime && record.lastAction === 'write') {
      writeOutput(
        `Warning: ${path.basename(filePath)} was modified externally since you last wrote it ` +
        `(last action: ${record.lastActionAt}). Review changes before editing.`
      );
    }

    // Update the record
    timestamps.files[filePath] = {
      mtime: currentMtime,
      lastAction: 'read',
      lastActionAt: new Date().toISOString(),
    };
    safeWriteJSON(TIMESTAMPS_FILE, timestamps);
  } catch {
    // File doesn't exist or can't stat — no staleness to detect
  }
} else if (toolName === 'Write' || toolName === 'Edit') {
  // Update timestamp after write (called as PostToolUse)
  try {
    const stat = fs.statSync(filePath);
    timestamps.files[filePath] = {
      mtime: stat.mtime.toISOString(),
      lastAction: 'write',
      lastActionAt: new Date().toISOString(),
    };
    safeWriteJSON(TIMESTAMPS_FILE, timestamps);
  } catch {
    // File may not exist yet during Write
  }
}

timer.report('pass');
process.exit(0);
