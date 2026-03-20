#!/usr/bin/env node
/**
 * git-guard.mjs — PreToolUse hook (Bash)
 * Blocks direct pushes/commits to main and destructive git operations.
 * FR-025, AC-022
 */

import { readStdin, writeOutput, blockToolCall, getCurrentBranch, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const command = input.tool_input?.command || '';
if (!command) process.exit(0);

// Only check git commands
if (!command.match(/\bgit\b/)) process.exit(0);

const timer = createHookTimer('git-guard', 'PreToolUse', input.tool_name || '');

const branch = getCurrentBranch();

// Block direct commits/pushes to main
if (branch === 'main' || branch === 'master') {
  if (/\bgit\s+(commit|push)\b/.test(command)) {
    timer.report('blocked', `direct ${command.includes('push') ? 'push' : 'commit'} to ${branch}`);
    blockToolCall(
      `Cannot ${command.includes('push') ? 'push' : 'commit'} directly to ${branch}. ` +
      `Create a feature branch: genesis/{NNN}-{feature-name}`
    );
  }
}

// Block destructive git operations everywhere
if (/\bgit\s+push\s+.*--force\b/.test(command) || /\bgit\s+push\s+-f\b/.test(command)) {
  timer.report('blocked', 'force push');
  blockToolCall('Destructive git operation blocked: force push. Use safer alternatives.');
}

if (/\bgit\s+reset\s+--hard\b/.test(command)) {
  timer.report('blocked', 'hard reset');
  blockToolCall('Destructive git operation blocked: hard reset. Use safer alternatives.');
}

if (/\bgit\s+clean\s+-f/.test(command)) {
  timer.report('blocked', 'clean -f');
  blockToolCall('Destructive git operation blocked: clean -f. Use safer alternatives.');
}

// Validate branch name format on push (advisory via context, non-blocking)
if (/\bgit\s+push\b/.test(command) && branch) {
  if (branch !== 'main' && branch !== 'master' && !/^genesis\/\d{3}-[a-z0-9-]+$/.test(branch)) {
    writeOutput(`Branch "${branch}" does not follow the genesis/{NNN}-{name} convention.`);
  }
}

timer.report('pass');
process.exit(0);
