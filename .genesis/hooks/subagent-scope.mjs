#!/usr/bin/env node
/**
 * subagent-scope.mjs — SubagentStart hook
 * Injects active feature context into subagents so they stay in scope.
 * FR-030, AC-029
 */

import {
  readStdin,
  writeOutput,
  getEnvVar,
  getActiveFeature,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();

const feature = getActiveFeature();
if (!feature) process.exit(0);

const timer = createHookTimer('subagent-scope', 'SubagentStart', input?.tool_name || 'SubagentStart');

const task = getEnvVar('GENESIS_CURRENT_TASK');
const expectedOutputs = getEnvVar('GENESIS_EXPECTED_OUTPUTS');

const lines = [
  `You are operating within Genesis feature: ${feature}`,
];

if (task) {
  lines.push(`Current task: ${task}`);
}

if (expectedOutputs) {
  lines.push(`Expected output files: ${expectedOutputs}`);
  lines.push('Stay within scope of these files. Do not modify files outside this list unless they are test files.');
}

timer.report('pass', `scope injected for ${feature}${task ? ` at ${task}` : ''}`);
writeOutput(lines.join('\n'));
process.exit(0);
