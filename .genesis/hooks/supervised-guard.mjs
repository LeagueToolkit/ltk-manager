#!/usr/bin/env node
/**
 * supervised-guard.mjs — PreToolUse hook (Write|Edit)
 * Blocks writes during implementation of supervised plan sections
 * unless the task has been explicitly approved.
 * FR-041, AC-026
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin,
  blockToolCall,
  getEnvVar,
  getActiveFeature,
  safeReadFile,
  safeReadJSON,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

// Only check during active implementation
const currentTask = getEnvVar('GENESIS_CURRENT_TASK');
if (!currentTask) process.exit(0);

const feature = getEnvVar('GENESIS_FEATURE') || getActiveFeature();
if (!feature) process.exit(0);

const timer = createHookTimer('supervised-guard', 'PreToolUse', input.tool_name || '');

// Read the tasks file to find the current task's context package
const featureDir = path.join(GENESIS_DIR, 'features', feature);
const tasksFiles = [];
try {
  const files = fs.readdirSync(featureDir).filter(f => f.startsWith('tasks') && f.endsWith('.md'));
  for (const f of files) {
    tasksFiles.push(path.join(featureDir, f));
  }
} catch {
  timer.report('pass', 'no tasks directory');
  process.exit(0);
}

// Find the current task block and check if it references a supervised section
let isSupervisedTask = false;
for (const taskFile of tasksFiles) {
  const content = safeReadFile(taskFile);
  if (!content) continue;

  const taskBlock = content.indexOf(`### ${currentTask}:`);
  if (taskBlock === -1) continue;

  // Check if the task's context mentions supervised sections
  const nextTask = content.indexOf('\n### T-', taskBlock + 1);
  const block = content.slice(taskBlock, nextTask === -1 ? undefined : nextTask);

  if (block.includes('supervised: true') || block.includes('<!-- supervised: true -->')) {
    isSupervisedTask = true;
  }
  break;
}

if (!isSupervisedTask) {
  timer.report('pass', 'not a supervised task');
  process.exit(0);
}

// Check if this task has been approved
const approvalsPath = path.join(featureDir, 'approvals.json');
const approvals = safeReadJSON(approvalsPath);
const taskApproved = approvals?.approvals?.some(
  a => a.phase === 'implement' && a.note?.includes(currentTask)
);

if (taskApproved) {
  timer.report('pass', `supervised task ${currentTask} approved`);
  process.exit(0);
}

// Block — supervised task not approved
timer.report('block', `supervised task ${currentTask} requires approval`);
blockToolCall(
  `Supervised operation: Task ${currentTask} is derived from a supervised plan section. ` +
  `Run "/genesis-accept ${feature} implement --note '${currentTask} approved'" to approve, ` +
  `then retry.`
);
