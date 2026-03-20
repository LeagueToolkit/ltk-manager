#!/usr/bin/env node
/**
 * review-closure.mjs — PostToolUse hook (Skill)
 * Hard-enforces the phase closure workflow after review acceptance.
 *
 * When `/genesis-accept {feature} review` completes, this hook injects
 * a mandatory instruction to run the full git closure: push → PR → merge.
 * Without this, the closure step relies on Claude remembering skill
 * instructions — which is unreliable after long sessions or compaction.
 *
 * FR-025, FR-026, AC-008
 */

import { readStdin, writeOutput, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const { tool_name, tool_input } = input;

// Only trigger on Skill tool calls
if (tool_name !== 'Skill') process.exit(0);

const skillName = tool_input?.skill || '';
if (!skillName.startsWith('genesis-accept') && !skillName.startsWith('genesis:accept')) {
  process.exit(0);
}

// Parse args to detect review phase
const args = tool_input?.args || '';
const isReview = /\breview\b/i.test(args);

if (!isReview) process.exit(0);

const timer = createHookTimer('review-closure', 'PostToolUse', 'Skill');

// Extract feature name from args (first word before "review")
const featureMatch = args.match(/^(\S+)\s+review/i);
const feature = featureMatch ? featureMatch[1] : 'unknown';

timer.report('pass', `review acceptance detected for ${feature} — enforcing closure`);

writeOutput(
  `[MANDATORY] Review approved for "${feature}". You MUST now complete the phase closure workflow:\n` +
  `1. Push the feature branch: git push -u origin <branch>\n` +
  `2. Create a PR: gh pr create --title "genesis: complete ${feature}" --base main\n` +
  `3. Ask the user: "Merge PR to main? [y/n]"\n` +
  `4. On approval: gh pr merge <number> --squash\n` +
  `5. Switch to main and pull: git checkout main && git pull\n` +
  `Do NOT skip any of these steps. This is a hard-enforced closure requirement.`
);

process.exit(0);
