#!/usr/bin/env node
/**
 * session-init.mjs — SessionStart hook (fires ONCE per CLI launch)
 *
 * Pre-stage architecture: does ALL expensive filesystem scanning here,
 * writes results to .genesis/.session-context.json for prompt-context.mjs
 * to read cheaply on every UserPromptSubmit.
 *
 * Expensive ops moved here (run once):
 * - Git branch detection
 * - Active feature resolution
 * - Constitution loading (~12KB)
 * - Spec AC section + plan preview extraction
 * - Project state parsing
 *
 * NOT cached (handled elsewhere):
 * - Command templates: loaded by Claude's Skill system per-invocation
 * - Task status: read fresh by prompt-context.mjs (changes per-task)
 * - Progress: read fresh by prompt-context.mjs (changes per-task)
 *
 * FR-007, AC-007, AC-010
 */

import path from 'node:path';
import {
  readStdin,
  writeOutput,
  writeEnvFile,
  getActiveFeature,
  readFeatureArtifacts,
  findNextPendingTask,
  readProjectState,
  buildCacheData,
  safeReadJSON,
  safeWriteJSON,
  GENESIS_DIR,
  PROJECT_DIR,
  createHookTimer,
} from './_utils.mjs';

const SESSION_CACHE = path.join(GENESIS_DIR, '.session-context.json');

const input = await readStdin();

const timer = createHookTimer('session-init', 'SessionStart', input?.tool_name || 'SessionStart');

// ─── Post-compaction restore ────────────────────────────────────────────────

const snapshotPath = path.join(GENESIS_DIR, '.context-snapshot.json');
const snapshot = safeReadJSON(snapshotPath);
if (snapshot && snapshot.feature) {
  writeEnvFile('GENESIS_FEATURE', snapshot.feature);
  if (snapshot.task) writeEnvFile('GENESIS_CURRENT_TASK', snapshot.task);
  if (snapshot.expectedOutputs) {
    writeEnvFile('GENESIS_EXPECTED_OUTPUTS', snapshot.expectedOutputs);
  }

  const lines = [
    'Context restored after compaction.',
    `Feature: ${snapshot.feature}`,
  ];
  if (snapshot.task) lines.push(`Current task: ${snapshot.task}`);
  if (snapshot.filesModified?.length) {
    lines.push(`Files modified so far: ${snapshot.filesModified.join(', ')}`);
  }

  // Rebuild cache even on compaction restore
  buildSessionCache(snapshot.feature);

  timer.report('pass', `restored from compaction snapshot for ${snapshot.feature}`);
  writeOutput(lines.join('\n'));
  process.exit(0);
}

// ─── Normal session start — pre-stage all expensive work ────────────────────

const feature = getActiveFeature();
if (!feature) {
  // No active feature — write minimal cache and exit
  safeWriteJSON(SESSION_CACHE, {
    version: 2,
    timestamp: new Date().toISOString(),
    feature: null,
  });
  timer.report('pass', 'no active feature');
  process.exit(0);
}

writeEnvFile('GENESIS_FEATURE', feature);
const contextLines = buildSessionCache(feature);

timer.report('pass', `cache built for ${feature}`);
writeOutput(contextLines.join('\n'));
process.exit(0);

// ─── Cache builder ──────────────────────────────────────────────────────────

function buildSessionCache(featureName) {
  // Build core cache data (shared with prompt-context.mjs)
  const cache = buildCacheData(featureName);

  const contextLines = [`Active feature: ${featureName}`];

  // ── Next task (for initial context line output only) ──────────────────

  const artifacts = readFeatureArtifacts(featureName);
  if (artifacts.tasks) {
    const nextTask = findNextPendingTask(artifacts.tasks);
    if (nextTask) {
      writeEnvFile('GENESIS_CURRENT_TASK', nextTask.id);
      writeEnvFile('GENESIS_EXPECTED_OUTPUTS', nextTask.expectedOutputs.join(','));
      contextLines.push(`Current task: ${nextTask.id} — ${nextTask.title}`);
      contextLines.push(`Objective: ${nextTask.objective}`);
      if (nextTask.criteria.length > 0) {
        contextLines.push('Acceptance criteria:');
        nextTask.criteria.forEach((c) => contextLines.push(`  - [ ] ${c}`));
      }
      if (nextTask.expectedOutputs.length > 0) {
        contextLines.push(`Expected outputs: ${nextTask.expectedOutputs.join(', ')}`);
      }
    }
  }

  // ── Progress (for initial context line output only) ───────────────────

  const { raw } = readProjectState();
  if (raw) {
    const progressMatch = raw.match(/Progress:\s*(.+)/);
    if (progressMatch) {
      contextLines.push(`Progress: ${progressMatch[1].trim()}`);
    }
  }

  // ── Write cache ───────────────────────────────────────────────────────

  safeWriteJSON(SESSION_CACHE, cache);

  return contextLines;
}
