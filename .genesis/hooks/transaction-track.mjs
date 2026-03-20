#!/usr/bin/env node
/**
 * transaction-track.mjs — PostToolUse hook (Write|Edit)
 * Tracks files modified since last clean compilation.
 * FR-015
 */

import path from 'node:path';
import { readStdin, writeOutput, safeReadJSON, safeWriteJSON, GENESIS_DIR, createHookTimer } from './_utils.mjs';

const TRANSACTION_FILE = path.join(GENESIS_DIR, '.transaction.json');

const input = await readStdin();
if (!input) process.exit(0);

// FR-069: Reset transaction on git commit
const toolName = input.tool_name || '';
if (toolName === 'Bash') {
  const cmd = input.tool_input?.command || '';
  if (/\bgit\s+commit\b/.test(cmd)) {
    safeWriteJSON(TRANSACTION_FILE, { lastCleanState: new Date().toISOString(), files: [] });
    process.exit(0);
  }
}

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const timer = createHookTimer('transaction-track', 'PostToolUse', toolName);

const transaction = safeReadJSON(TRANSACTION_FILE) || { lastCleanState: null, files: [] };

// Record the file modification
transaction.files.push({
  path: filePath,
  action: toolName === 'Write' ? 'write' : 'edit',
  at: new Date().toISOString(),
});

safeWriteJSON(TRANSACTION_FILE, transaction);

// If there are files since last clean state, report them
if (transaction.files.length > 1 && transaction.lastCleanState) {
  const fileList = transaction.files.map((f) => path.basename(f.path)).join(', ');
  writeOutput(
    `Files modified since last clean compilation: ${fileList}. ` +
    `Consider reverting the most recent file if it introduced errors.`
  );
}

timer.report('pass');
process.exit(0);
