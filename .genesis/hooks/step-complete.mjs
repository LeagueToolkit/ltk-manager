#!/usr/bin/env node
/**
 * step-complete.mjs — Stop hook
 * Checks for uncommitted changes and provides a summary after each
 * AI response. Reminds the AI to commit if there are pending changes.
 * FR-008, AC-009
 */

import {
  readStdin,
  writeOutput,
  getEnvVar,
  git,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();

const task = getEnvVar('GENESIS_CURRENT_TASK');
if (!task) process.exit(0);

const timer = createHookTimer('step-complete', 'Stop', input?.tool_name || 'Stop');

// Check for uncommitted changes
const status = git(['status', '--porcelain']);
if (!status) {
  timer.report('pass', 'no uncommitted changes');
  process.exit(0);
}

const lines = status.split('\n').filter(Boolean);
const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('M ')).length;
const added = lines.filter((l) => l.startsWith('A ') || l.startsWith('??')).length;

const parts = [];
if (modified > 0) parts.push(`${modified} modified`);
if (added > 0) parts.push(`${added} new/untracked`);

if (parts.length > 0) {
  timer.report('pass', `uncommitted: ${parts.join(', ')}`);
  writeOutput(
    `Uncommitted changes: ${parts.join(', ')}. ` +
    `Remember to commit with: genesis: {action} {subject}`
  );
} else {
  timer.report('pass', 'working tree clean');
}

process.exit(0);
