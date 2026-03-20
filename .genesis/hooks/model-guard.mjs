#!/usr/bin/env node
/**
 * model-guard.mjs — PreToolUse hook (matcher: Agent)
 *
 * HARD ENFORCES subagent model tier routing. Uses TWO enforcement layers:
 *
 * Layer 1 (primary): Exit code 2 BLOCKS the Agent call entirely when the
 * explicit `model` parameter does not match the required tier. The stderr
 * message tells Claude exactly which model to use. This is the most reliable
 * mechanism — exit code 2 ALWAYS blocks, no JSON parsing needed.
 *
 * Layer 2 (fallback): If the model param is missing entirely (not explicitly
 * wrong), uses updatedInput to inject the correct model. This handles the
 * case where the caller forgot to pass model at all.
 *
 * SubagentStart hooks CANNOT block or modify — only PreToolUse can.
 *
 * FR-039, AC-014, NFR-005
 */

import path from 'node:path';
import { readStdin, blockToolCall, safeReadJSON, GENESIS_DIR, createHookTimer } from './_utils.mjs';

const TIER_MAP_PATH = path.join(GENESIS_DIR, 'hooks', 'tier-map.json');

// Model tier hierarchy — lower number = cheaper
const TIER_COST = { haiku: 1, sonnet: 2, inherit: 3 };

const input = await readStdin();
if (!input) process.exit(0);

// Only act on Agent tool calls
if (input.tool_name !== 'Agent') process.exit(0);

const timer = createHookTimer('model-guard', 'PreToolUse', 'Agent');

// Known agent-to-tier mappings (definitive — matches agent definitions)
const AGENT_TIERS = {
  'genesis-researcher': 'sonnet',
  'genesis-mechanic': 'haiku',
  'genesis-implementer': 'inherit',
};

// Extract subagent type from Agent tool input
const agentType = input.tool_input?.subagent_type || '';

// First try direct agent type matching (most reliable)
let expectedTier = AGENT_TIERS[agentType];

// Fallback to tier-map.json for other mapped subagents
if (!expectedTier) {
  const tierMap = safeReadJSON(TIER_MAP_PATH);
  if (tierMap && agentType) {
    expectedTier = tierMap[agentType];
  }
}

if (!expectedTier) {
  timer.report('pass', 'no tier mapping — allowing');
  process.exit(0);
}

const requestedModel = input.tool_input?.model;
const hasExplicitModel = requestedModel !== undefined && requestedModel !== null;
const effectiveModel = requestedModel || 'inherit';
const expectedCost = TIER_COST[expectedTier] || 3;
const requestedCost = TIER_COST[effectiveModel] || 3;

if (requestedCost > expectedCost) {
  if (hasExplicitModel) {
    // HARD BLOCK: Caller explicitly passed the wrong model. Exit 2 blocks unconditionally.
    timer.report('block', `BLOCKED ${requestedModel} for ${agentType} — requires ${expectedTier}`);
    blockToolCall(
      `MODEL GUARD BLOCKED: "${agentType}" requires model: "${expectedTier}" but got model: "${requestedModel}". ` +
      `Re-call the Agent tool with model: "${expectedTier}". This is enforced by tier-map policy.`
    );
  } else {
    // No model specified — inject the correct one via updatedInput
    timer.report('enforce', `INJECTED model: ${expectedTier} for ${agentType} (was unspecified)`);
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          `Model guard: injected model "${expectedTier}" for ${agentType} (no model was specified). ` +
          `IMPORTANT: Always pass model: "${expectedTier}" explicitly when calling ${agentType}.`,
        updatedInput: {
          ...input.tool_input,
          model: expectedTier,
        },
        additionalContext:
          `Model guard enforcement: ${agentType} MUST use model "${expectedTier}". ` +
          `The model parameter was missing and has been injected. ` +
          `Always pass model: "${expectedTier}" explicitly for ${agentType} agents.`,
      },
    });
    process.stdout.write(output);
  }
} else {
  timer.report('pass', `${effectiveModel} within tier ${expectedTier}`);
}

process.exit(0);
