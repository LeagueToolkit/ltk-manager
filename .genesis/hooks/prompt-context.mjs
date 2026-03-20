#!/usr/bin/env node
/**
 * prompt-context.mjs — Unified UserPromptSubmit hook
 *
 * Pre-stage architecture: reads pre-computed cache from session-init.mjs.
 * Only two dynamic files are read fresh per prompt:
 *   1. .session-context.json (cache)
 *   2. tasks.md (changes during implementation)
 * Plus project-state.md for progress (cheap single-regex read).
 *
 * NOT done here (saves tokens):
 * - Command template injection: Claude's Skill system already loads commands
 * - Constitution file reads: cached at session start
 * - Spec/plan file reads: cached at session start
 * - Git branch detection: cached at session start
 *
 * FR-011, FR-027, FR-028, FR-029
 * AC-024, AC-025, AC-026, AC-027, AC-028
 */

import fs from 'node:fs';
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
  getEnvVar,
  safeReadFile,
  safeReadJSON,
  safeWriteJSON,
  git,
  PROJECT_DIR,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const SESSION_CACHE = path.join(GENESIS_DIR, '.session-context.json');

const input = await readStdin();
if (!input) process.exit(0);

const prompt = input.user_prompt || input.prompt || '';
if (!prompt) process.exit(0);

// ─── Detect Genesis command and feature ─────────────────────────────────────

const isGenesisCommand = /\/genesis-\w+/.test(prompt);
const isTaskRef = /\bT-\d{3}\b/.test(prompt);

const cmdMatch = prompt.match(/\/genesis-(\w[\w-]*)/);
const command = cmdMatch ? cmdMatch[1] : '';

const featureMatch = prompt.match(/\/genesis-\w[\w-]*\s+([a-z0-9][\w-]*)/i);
let feature = featureMatch ? featureMatch[1] : null;

// Fast exit for non-Genesis prompts (AC-027: <5ms)
if (!isGenesisCommand && !isTaskRef) process.exit(0);

// ─── Load session cache (with mtime-based staleness detection) ──────────────

let cache = safeReadJSON(SESSION_CACHE);

// Resolve feature: prompt arg → cache → git branch fallback
if (!feature && cache?.feature) feature = cache.feature;
if (!feature) feature = getActiveFeature(); // fallback: one git call

if (!feature) process.exit(0);

const timer = createHookTimer('prompt-context', 'UserPromptSubmit', input.tool_name || 'UserPromptSubmit');

// Detect if cache is stale:
// 1. No cache at all (session-init didn't run or file deleted)
// 2. Feature changed (user switched branches or specified a different feature)
// 3. Artifact files are newer than cache (spec/plan were updated mid-session)
const cacheStale = !cache
  || cache.feature !== feature
  || isArtifactNewer(feature, cache.timestamp);

if (cacheStale) {
  cache = rebuildCache(feature);
}

// Set env vars for downstream hooks
writeEnvFile('GENESIS_FEATURE', feature);
if (command) writeEnvFile('GENESIS_COMMAND', command);

const sections = [];
let totalLen = 0;
const CHAR_BUDGET = 8000; // character budget (~2000 tokens)

// ─── Phase 1: Task context (fresh read — changes during session) ────────────

const featureDir = path.join(GENESIS_DIR, 'features', feature);
const tasksPath = fs.existsSync(featureDir)
  ? path.join(featureDir, 'tasks.md')
  : path.join(GENESIS_DIR, 'tasks', feature, 'tasks.md');

const tasksContent = safeReadFile(tasksPath);

if (tasksContent) {
  const nextTask = findNextPendingTask(tasksContent);
  if (nextTask) {
    writeEnvFile('GENESIS_CURRENT_TASK', nextTask.id);
    writeEnvFile('GENESIS_EXPECTED_OUTPUTS', nextTask.expectedOutputs.join(','));

    if (command === 'implement') {
      const taskBlock = extractTaskBlock(tasksContent, nextTask.id);
      if (taskBlock && totalLen + taskBlock.length < CHAR_BUDGET) {
        sections.push(`## Current Task: ${nextTask.id}\n${taskBlock}`);
        totalLen += taskBlock.length;
      }

      // Read first 100 lines of expected output files
      for (const fp of nextTask.expectedOutputs.slice(0, 3)) {
        const absPath = path.resolve(PROJECT_DIR, fp);
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          const preview = content.split('\n').slice(0, 100).join('\n');
          if (totalLen + preview.length < CHAR_BUDGET) {
            sections.push(`## Existing file: ${fp}\n\`\`\`\n${preview}\n\`\`\``);
            totalLen += preview.length;
          }
        } catch {
          // File doesn't exist yet
        }
      }
    } else {
      const brief = `Feature: ${feature}\n` +
        `Next task: ${nextTask.id} — ${nextTask.title}\n` +
        `Objective: ${nextTask.objective}`;
      sections.push(brief);
      totalLen += brief.length;
    }
  }
}

// ─── Phase 2: Spec AC + Plan preview (from cache) ──────────────────────────

if (cache?.specAC && totalLen < CHAR_BUDGET) {
  const trimmed = cache.specAC.slice(0, CHAR_BUDGET - totalLen);
  sections.push(`## Acceptance Criteria\n${trimmed}`);
  totalLen += trimmed.length;
}

if (cache?.planPreview && totalLen < CHAR_BUDGET) {
  const remaining = CHAR_BUDGET - totalLen;
  const planPreview = cache.planPreview.slice(0, Math.min(remaining, 2000));
  sections.push(`## Plan (preview)\n${planPreview}`);
  totalLen += planPreview.length;
}

// Git diff for review — only command that needs live git data
if (command === 'review' && totalLen < CHAR_BUDGET) {
  const baseBranch = git(['config', '--get', 'init.defaultBranch']) || 'main';
    const diff = git(['diff', '--stat', `${baseBranch}...HEAD`]);
  if (diff) {
    sections.push(`## Git diff summary\n${diff}`);
    totalLen += diff.length;
  }
}

// ─── Phase 3: Progress (fresh read — changes per task) ─────────────────────

const { raw: stateRaw } = readProjectState();
if (stateRaw) {
  const progressMatch = stateRaw.match(/Progress:\s*(.+)/);
  if (progressMatch) {
    const progress = `Progress: ${progressMatch[1].trim()}`;
    sections.push(progress);
    totalLen += progress.length;
  }
}

// ─── Phase 4: Constitution (from cache, budget-aware) ───────────────────────

if (isGenesisCommand && cache) {
  if (cache.constitution && totalLen < CHAR_BUDGET) {
    const remaining = CHAR_BUDGET - totalLen;
    const trimmed = cache.constitution.slice(0, remaining);
    sections.push(`## Constitution\n${trimmed}`);
    totalLen += trimmed.length;
  }

  // Load relevant fragments based on expected outputs
  if (cache.constitutionFragments?.length > 0 && totalLen < CHAR_BUDGET) {
    const expectedOutputs = getEnvVar('GENESIS_EXPECTED_OUTPUTS') || '';
    for (const frag of cache.constitutionFragments) {
      if (totalLen >= CHAR_BUDGET) break;

      let include = false;
      if (!frag.patterns) {
        include = true; // No file_patterns — always include
      } else {
        include = frag.patterns.some((pattern) => {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          return expectedOutputs.split(',').some((output) => regex.test(output));
        });
      }

      if (include) {
        const remaining = CHAR_BUDGET - totalLen;
        const trimmed = frag.content.slice(0, remaining);
        sections.push(`## Constitution Fragment: ${frag.name}\n${trimmed}`);
        totalLen += trimmed.length;
      }
    }
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

if (sections.length > 0) {
  timer.report('pass', `${sections.length} sections, ~${totalLen} chars`);
  writeOutput(sections.join('\n\n'));
} else {
  timer.report('pass', 'no context sections');
}

process.exit(0);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if any artifact file (spec, plan) is newer than the cache timestamp.
 * Tasks are always read fresh so they're excluded from this check.
 */
function isArtifactNewer(featureName, cacheTimestamp) {
  if (!cacheTimestamp) return true;
  const cacheTime = new Date(cacheTimestamp).getTime();
  if (isNaN(cacheTime)) return true;

  const dir = path.join(GENESIS_DIR, 'features', featureName);
  const filesToCheck = ['spec.md', 'plan.md'];

  for (const file of filesToCheck) {
    try {
      const stat = fs.statSync(path.join(dir, file));
      if (stat.mtimeMs > cacheTime) return true;
    } catch {
      // File doesn't exist — not stale
    }
  }

  // Also check constitution
  const constitutionFile = path.join(GENESIS_DIR, 'constitution.md');
  try {
    const stat = fs.statSync(constitutionFile);
    if (stat.mtimeMs > cacheTime) return true;
  } catch {
    // No constitution file
  }

  return false;
}

/**
 * Rebuild the session cache when staleness is detected.
 * Delegates to shared buildCacheData() then persists.
 * Cost: ~30ms (one-time), saves ~8 reads per subsequent prompt.
 */
function rebuildCache(featureName) {
  const newCache = buildCacheData(featureName);
  safeWriteJSON(SESSION_CACHE, newCache);
  return newCache;
}

function extractTaskBlock(content, taskId) {
  const normalized = content.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(`### ${taskId}:`);
  if (start === -1) return null;
  const nextTask = normalized.indexOf('\n### T-', start + 1);
  const nextGroup = normalized.indexOf('\n## ', start + 1);
  const end = Math.min(
    nextTask === -1 ? Infinity : nextTask,
    nextGroup === -1 ? Infinity : nextGroup,
    normalized.length,
  );
  return normalized.slice(start, end).trim();
}
