#!/usr/bin/env node
/**
 * context-preserve.mjs — PreCompact hook
 * Saves context snapshot before compaction so session-init can restore.
 * FR-010, AC-010
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin,
  getEnvVar,
  getActiveFeature,
  safeWriteJSON,
  git,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();

const task = getEnvVar('GENESIS_CURRENT_TASK');
const expectedOutputs = getEnvVar('GENESIS_EXPECTED_OUTPUTS');
const feature = getActiveFeature();

if (!feature) process.exit(0);

const timer = createHookTimer('context-preserve', 'PreCompact', input?.tool_name || 'PreCompact');

// Get files modified in this session
const diffOutput = git(['diff', '--name-only']);
const filesModified = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];

// Read pipeline phase from pipeline.json if it exists
let pipelinePhase = null;
let approvalState = null;
let pendingPolls = [];

const featureDir = path.join(GENESIS_DIR, 'features', feature);
try {
  const pipelineFile = path.join(featureDir, 'pipeline.json');
  if (fs.existsSync(pipelineFile)) {
    const pipeline = JSON.parse(fs.readFileSync(pipelineFile, 'utf-8'));
    const active = pipeline.phases?.find(p => p.status === 'active');
    pipelinePhase = active?.name || pipeline.currentPhase || null;
  }
} catch { /* no pipeline data */ }

// Read latest approval state
try {
  const approvalsFile = path.join(featureDir, 'approvals.json');
  if (fs.existsSync(approvalsFile)) {
    let approvals = JSON.parse(fs.readFileSync(approvalsFile, 'utf-8'));
    if (!Array.isArray(approvals) && approvals.approvals) approvals = approvals.approvals;
    if (Array.isArray(approvals) && approvals.length > 0) {
      approvalState = approvals[approvals.length - 1];
    }
  }
} catch { /* no approval data */ }

// Read pending polls
try {
  const pollsFile = path.join(featureDir, 'polls.json');
  if (fs.existsSync(pollsFile)) {
    const polls = JSON.parse(fs.readFileSync(pollsFile, 'utf-8'));
    pendingPolls = (polls.polls || []).filter(p => p.status === 'pending');
  }
} catch { /* no polls data */ }

const snapshot = {
  feature,
  task: task || null,
  expectedOutputs: expectedOutputs || null,
  filesModified,
  savedAt: new Date().toISOString(),
  pipelinePhase,
  approvalState,
  pendingPolls,
};

const snapshotPath = path.join(GENESIS_DIR, '.context-snapshot.json');
safeWriteJSON(snapshotPath, snapshot);

timer.report('pass', `snapshot saved for ${feature}${task ? ` at ${task}` : ''}`);
process.exit(0);
