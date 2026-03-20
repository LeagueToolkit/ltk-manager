#!/usr/bin/env node
/**
 * ears-score.mjs — PostToolUse hook (Bash)
 * Scores test results against EARS acceptance criteria.
 * FR-026, AC-023
 */

import { readStdin, writeOutput, getEnvVar, readFeatureArtifacts, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const command = input.tool_input?.command || '';

// Only act on test commands
if (!command.match(/\b(cargo\s+test|vitest|npm\s+test)\b/)) process.exit(0);

const currentTask = getEnvVar('GENESIS_CURRENT_TASK');
const feature = getEnvVar('GENESIS_FEATURE');
if (!currentTask || !feature) process.exit(0);

const timer = createHookTimer('ears-score', 'PostToolUse', input.tool_name || '');

// Load spec
const artifacts = readFeatureArtifacts(feature);
if (!artifacts.spec) { timer.report('pass', 'no spec found'); process.exit(0); }

// Extract EARS-format acceptance criteria
const acPattern = /\*\*AC-(\d{3}):\*\*\s*WHEN\s+(.+?)\s+THE SYSTEM SHALL\s+(.+?)(?:\n|$)/g;
const criteria = [];
let match;
while ((match = acPattern.exec(artifacts.spec)) !== null) {
  criteria.push({
    id: `AC-${match[1]}`,
    trigger: match[2],
    behavior: match[3],
  });
}

if (criteria.length === 0) {
  // No EARS-format ACs — gracefully skip
  timer.report('pass', 'no EARS criteria');
  process.exit(0);
}

// Check for verifiable_by: test references
const verifiablePattern = /\*\*AC-(\d{3}):\*\*.*?\n\s*-\s*\*\*Verifiable by:\*\*\s*(integration_test|compilation|manual)/gi;
const verifiable = {};
while ((match = verifiablePattern.exec(artifacts.spec)) !== null) {
  verifiable[`AC-${match[1]}`] = match[2];
}

// Build scorecard from test output (basic pass/fail detection)
const testOutput = input.tool_output || '';
const scorecard = criteria.map((ac) => {
  const vType = verifiable[ac.id] || 'unknown';
  if (vType === 'manual') return `${ac.id}: SKIP (manual verification)`;
  if (vType === 'compilation') return `${ac.id}: ${testOutput.includes('error') ? 'FAIL' : 'PASS'} (compilation)`;

  // For test-verifiable: check if any test name references this AC
  const acRef = ac.id.toLowerCase().replace('-', '_');
  const lowerOutput = testOutput.toLowerCase();
    const passed = lowerOutput.includes(acRef) && !new RegExp(acRef + '.*fail').test(lowerOutput);
  return `${ac.id}: ${passed ? 'PASS' : 'UNTESTED'}`;
});

const passCount = scorecard.filter((s) => s.includes('PASS')).length;
const total = scorecard.filter((s) => !s.includes('SKIP')).length;

timer.report('pass', `score: ${passCount}/${total}`);
writeOutput(
  `EARS Scorecard for ${currentTask}:\n` +
  scorecard.join('\n') +
  `\nScore: ${passCount}/${total}`
);

process.exit(0);
