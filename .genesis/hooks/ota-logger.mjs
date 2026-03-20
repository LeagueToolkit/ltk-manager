#!/usr/bin/env node
/**
 * ota-logger.mjs — PostToolUse hook (all, async)
 * Async JSONL logger for every tool use during implementation.
 * FR-044, AC-045
 */

import fs from 'node:fs';
import path from 'node:path';
import { readStdin, getEnvVar, GENESIS_DIR, createHookTimer, safeReadJSON } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const feature = getEnvVar('GENESIS_FEATURE');
if (!feature) process.exit(0);

const toolName = input.tool_name || 'unknown';
const timer = createHookTimer('ota-logger', 'PostToolUse', toolName);

const filePath = input.tool_input?.file_path || input.tool_input?.command?.slice(0, 80) || '';

// Determine action type
let type = 'ACTION';
if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
  type = 'OBSERVATION';
}

// Cost telemetry — resolve model tier from env or input context
// Use per-token rates from pricing.json for consistency with cost-logger
const pricingPath = path.join(GENESIS_DIR, 'config', 'pricing.json');
const pricingConfig = safeReadJSON(pricingPath);
const pricingRates = pricingConfig?.rates || {};
const outputMultiplier = pricingConfig?.outputMultiplier ?? 1.5;
const VALID_TIERS = Object.keys(pricingRates);

const modelTier = resolveModelTier(input, VALID_TIERS);
const estimatedTokens = estimateTokenCount(input);
const estimatedOutputTokens = Math.ceil(estimatedTokens * outputMultiplier);
const rates = pricingRates[modelTier] || pricingRates.inherit || { inputPerMillionTokens: 3, outputPerMillionTokens: 15 };
const estimatedCostUsd = Math.round(
  ((estimatedTokens / 1_000_000) * rates.inputPerMillionTokens +
   (estimatedOutputTokens / 1_000_000) * rates.outputPerMillionTokens) * 10000
) / 10000;

// Read current task step ID for cost aggregation (set by implement skill)
const stepId = getEnvVar('GENESIS_CURRENT_TASK') || 'uncategorized';

const entry = {
  timestamp: new Date().toISOString(),
  type,
  tool: toolName,
  path: filePath,
  summary: buildSummary(toolName, input.tool_input),
  stepId,
  modelTier,
  estimatedInputTokens: estimatedTokens,
  estimatedCostUsd,
};

const logDir = path.join(GENESIS_DIR, 'features', feature);
const logPath = path.join(logDir, 'ota-trace.jsonl');

try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  timer.report('pass');
} catch {
  // Failed to log — silently continue
  timer.report('fail', 'write failed');
}

process.exit(0);

/**
 * Resolve model tier from GENESIS_MODEL_TIER env var, input context, or default.
 * @param {object} input - Hook input from stdin
 * @returns {string} One of: haiku, sonnet, opus, inherit
 */
function resolveModelTier(input, validTiers = ['haiku', 'sonnet', 'opus', 'inherit']) {
  const isValid = (tier) => validTiers.includes(tier);

  // 1. Check GENESIS env var (set by session-init or model routing)
  const envTier = getEnvVar('GENESIS_MODEL_TIER');
  if (envTier && isValid(envTier)) return envTier;

  // 2. Check process env directly (fallback for non-env-file contexts)
  const procTier = process.env.GENESIS_MODEL_TIER;
  if (procTier && isValid(procTier)) return procTier;

  // 3. Check if the input carries model metadata
  const inputTier = input?.model_tier || input?.metadata?.model_tier;
  if (inputTier && isValid(inputTier)) return inputTier;

  // 4. Default to inherit (parent session model)
  return 'inherit';
}

/**
 * Estimate input token count from tool input size.
 * Rough heuristic: ~4 chars per token for English text. Input-side only.
 * @param {object} input - Hook input from stdin
 * @returns {number} Estimated input token count
 */
function estimateTokenCount(input) {
  if (!input?.tool_input) return 0;
  const serialized = JSON.stringify(input.tool_input);
  return Math.ceil(serialized.length / 4);
}

function buildSummary(tool, toolInput) {
  if (!toolInput) return '';
  switch (tool) {
    case 'Write': return `Created ${path.basename(toolInput.file_path || '')}`;
    case 'Edit': return `Edited ${path.basename(toolInput.file_path || '')}`;
    case 'Read': return `Read ${path.basename(toolInput.file_path || '')}`;
    case 'Bash': return (toolInput.command || '').slice(0, 100);
    case 'Grep': return `Searched for "${(toolInput.pattern || '').slice(0, 50)}"`;
    case 'Glob': return `Glob "${(toolInput.pattern || '').slice(0, 50)}"`;
    default: return '';
  }
}
