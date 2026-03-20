#!/usr/bin/env node
/**
 * context-restore.mjs — PostCompact hook
 * Re-injects Genesis context after mid-session auto-compaction.
 * Companion to context-preserve.mjs (PreCompact).
 * FR-058, AC-033
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin,
  getActiveFeature,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();

const feature = getActiveFeature();
if (!feature) process.exit(0);

const timer = createHookTimer('context-restore', 'PostCompact', input?.tool_name || 'PostCompact');

const snapshotPath = path.join(GENESIS_DIR, '.context-snapshot.json');

// Gracefully handle missing snapshot
if (!fs.existsSync(snapshotPath)) {
  timer.report('pass', 'no snapshot to restore');
  process.exit(0);
}

let snapshot;
try {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
} catch {
  timer.report('warn', 'snapshot unreadable — skipping restore');
  process.exit(0);
}

// Build context restoration message
const parts = [`Genesis context restored after compaction:`];
parts.push(`  Feature: ${snapshot.feature || feature}`);

if (snapshot.task) parts.push(`  Task: ${snapshot.task}`);
if (snapshot.pipelinePhase) parts.push(`  Pipeline Phase: ${snapshot.pipelinePhase}`);
if (snapshot.expectedOutputs) parts.push(`  Expected Outputs: ${snapshot.expectedOutputs}`);
if (snapshot.approvalState) {
  const a = snapshot.approvalState;
  parts.push(`  Last Approval: ${a.phase} → ${a.status}`);
}
if (snapshot.pendingPolls?.length) {
  parts.push(`  Pending Polls: ${snapshot.pendingPolls.length} unanswered`);
}
if (snapshot.filesModified?.length) {
  parts.push(`  Files Modified: ${snapshot.filesModified.length} files`);
}

// Output context summary for Claude to consume
console.error(parts.join('\n'));

timer.report('pass', `context restored for ${snapshot.feature}${snapshot.task ? ` at ${snapshot.task}` : ''}`);
process.exit(0);
