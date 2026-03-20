/**
 * accept-gate.mjs — PreToolUse hook for Skill invocations.
 *
 * Enforces mandatory phase approval gates by checking approvals.json
 * before allowing Genesis pipeline skill transitions.
 *
 * Exit codes:
 *   0 — allow (approval record exists or skill not gated)
 *   2 — hard block (upstream approval missing)
 *
 * Zero external dependencies — Node.js built-ins only.
 */

import {
  readStdin,
  blockToolCall,
  writeOutput,
  readApprovals,
  getActiveFeature,
  createHookTimer,
  safeReadJSON,
  GENESIS_DIR,
} from './_utils.mjs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Phase transition map: skill name → upstream phase that must be approved
// Loaded from shared config to avoid duplication with plan docs.
// ---------------------------------------------------------------------------

function loadPhaseGates() {
  const configPath = path.join(GENESIS_DIR, 'config', 'phase-gates.json');
  const config = safeReadJSON(configPath);
  if (!config?.gates) {
    // Fallback if config missing — hardcoded as safety net
    return {
      'genesis-plan': 'specify', 'genesis:plan': 'specify',
      'genesis-tasks': 'plan', 'genesis:tasks': 'plan',
      'genesis-implement': 'tasks', 'genesis:implement': 'tasks',
      'genesis-review': 'implement', 'genesis:review': 'implement',
    };
  }
  // Expand compact format to both skill name variants
  const gates = {};
  for (const [phase, upstream] of Object.entries(config.gates)) {
    gates[`genesis-${phase}`] = upstream;
    gates[`genesis:${phase}`] = upstream;
  }
  return gates;
}

const PHASE_GATES = loadPhaseGates();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const input = await readStdin();
if (!input) process.exit(0);

const { tool_name, tool_input } = input;

// Only intercept Skill tool calls
if (tool_name !== 'Skill') process.exit(0);

const skillName = tool_input?.skill;
if (!skillName) process.exit(0);

const timer = createHookTimer('accept-gate', 'PreToolUse', 'Skill');

// Check if this skill has a phase gate
const requiredPhase = PHASE_GATES[skillName];
if (!requiredPhase) {
  // Not a gated skill (e.g., genesis-brainstorm, genesis-status) — allow
  timer.report('skip', `${skillName} is not phase-gated`);
  process.exit(0);
}

// Resolve the feature name — prefer skill args over branch detection
// Skill args format: "feature-name" or "feature-name --flags"
const skillArgs = (tool_input?.args || '').trim();
const argsFeature = skillArgs ? skillArgs.split(/\s+/)[0] : null;
const rawFeatureName = argsFeature || getActiveFeature();
// Sanitize feature name — only allow kebab-case alphanumeric characters
const featureName = rawFeatureName ? rawFeatureName.replace(/[^a-z0-9-]/gi, '') : null;
if (!featureName) {
  // Cannot determine feature — allow with warning (defensive, don't block blindly)
  timer.report('warn', 'Could not resolve active feature — skipping gate check');
  writeOutput('⚠ Accept gate: could not resolve active feature. Gate check skipped.');
  process.exit(0);
}

// Read approvals for the feature
const approvals = readApprovals(featureName);

// Load valid approval statuses from pricing.json config (or default to ['approved'])
const pricingPath = path.join(GENESIS_DIR, 'config', 'pricing.json');
const pricingConfig = safeReadJSON(pricingPath);
const validStatuses = pricingConfig?.approvalStatuses || ['approved'];

// Check if the required upstream phase has an approved record
const hasApproval = approvals.some(
  (a) => a.phase === requiredPhase && validStatuses.includes(a.status)
);

if (!hasApproval) {
  timer.report('block', `BLOCKED ${skillName} — no approval for "${requiredPhase}" phase`);
  blockToolCall(
    `ACCEPT GATE BLOCKED: Cannot run "${skillName}" — the "${requiredPhase}" phase for "${featureName}" ` +
    `has no formal approval record in approvals.json.\n\n` +
    `Run: /genesis-accept ${featureName} ${requiredPhase}\n\n` +
    `This gate is enforced by accept-gate.mjs (FR-057). ` +
    `Phase transitions require explicit approval via /genesis-accept.`
  );
}

// Approval exists — allow
timer.report('allow', `${skillName} allowed — "${requiredPhase}" phase approved for "${featureName}"`);
writeOutput(`✓ Accept gate: "${requiredPhase}" phase approved for "${featureName}".`);
