#!/usr/bin/env node
/**
 * cost-logger.mjs — PostToolUse hook (Bash matcher)
 *
 * Aggregates per-step cost data from ota-trace.jsonl entries after git commits.
 * Uses token counts and published model pricing to compute estimated cost.
 * Appends results to .genesis/features/{feature}/cost-log.jsonl.
 *
 * Exit codes:
 *   0 — always (logging must not block workflow)
 *
 * Zero external dependencies — Node.js built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin,
  getEnvVar,
  safeReadJSON,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

// Only trigger on git commit commands
const command = input.tool_input?.command || '';
if (!command.includes('git commit')) {
  process.exit(0);
}

// Only run during implementation sessions with an active feature
const feature = getEnvVar('GENESIS_FEATURE');
if (!feature) process.exit(0);

const stepId = getEnvVar('GENESIS_CURRENT_TASK') || 'uncategorized';
const timer = createHookTimer('cost-logger', 'PostToolUse', 'Bash');

try {
  // Read pricing rates
  const pricingPath = path.join(GENESIS_DIR, 'config', 'pricing.json');
  const pricing = safeReadJSON(pricingPath);
  if (!pricing?.rates) {
    timer.report('skip', 'No pricing config found');
    process.exit(0);
  }

  // Read OTA trace entries for this step
  const tracePath = path.join(GENESIS_DIR, 'features', feature, 'ota-trace.jsonl');
  if (!fs.existsSync(tracePath)) {
    timer.report('skip', 'No OTA trace file');
    process.exit(0);
  }

  const traceContent = fs.readFileSync(tracePath, 'utf-8');
  const lines = traceContent.split('\n').filter(Boolean);

  // Filter entries for the current step
  const stepEntries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.stepId === stepId) {
        stepEntries.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (stepEntries.length === 0) {
    timer.report('skip', `No OTA entries for step ${stepId}`);
    process.exit(0);
  }

  // Aggregate tokens and costs by model tier
  const tiers = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCost = 0;

  for (const entry of stepEntries) {
    const tier = entry.modelTier || 'inherit';
    const inputTokens = entry.estimatedInputTokens || 0;
    // Estimate output as multiplier × input (configurable via pricing.json)
    const outputMultiplier = pricing.outputMultiplier ?? 1.5;
    const outputTokens = Math.ceil(inputTokens * outputMultiplier);

    if (!tiers[tier]) {
      tiers[tier] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    }
    tiers[tier].inputTokens += inputTokens;
    tiers[tier].outputTokens += outputTokens;
    tiers[tier].calls += 1;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    // Calculate cost using pricing rates
    const rates = pricing.rates[tier] || pricing.rates.inherit;
    const inputCost = (inputTokens / 1_000_000) * rates.inputPerMillionTokens;
    const outputCost = (outputTokens / 1_000_000) * rates.outputPerMillionTokens;
    totalEstimatedCost += inputCost + outputCost;
  }

  // Build cost log entry
  const costEntry = {
    timestamp: new Date().toISOString(),
    stepId,
    feature,
    tierBreakdown: tiers,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    estimatedCostUsd: Math.round(totalEstimatedCost * 10000) / 10000, // 4 decimal places
    toolCalls: stepEntries.length,
  };

  // Append to cost-log.jsonl (append-only)
  const costLogDir = path.join(GENESIS_DIR, 'features', feature);
  const costLogPath = path.join(costLogDir, 'cost-log.jsonl');

  if (!fs.existsSync(costLogDir)) {
    fs.mkdirSync(costLogDir, { recursive: true });
  }

  fs.appendFileSync(costLogPath, JSON.stringify(costEntry) + '\n', 'utf-8');
  timer.report('pass', `Logged cost for step ${stepId}: $${costEntry.estimatedCostUsd}`);
} catch (err) {
  // Cost logging must never fail the workflow
  timer.report('fail', err.message);
}

process.exit(0);
