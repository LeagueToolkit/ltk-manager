#!/usr/bin/env node
/**
 * branch-guard.mjs — PreToolUse hook (Skill)
 * Enforces feature branch discipline: artifact-modifying skills
 * must run on a genesis/{NNN}-{feature-name} branch, not main.
 * Read-only skills are whitelisted and always allowed.
 * FR-023, FR-029, AC-007
 */

import {
  readStdin,
  blockToolCall,
  writeOutput,
  getCurrentBranch,
  getActiveFeature,
  readProjectState,
  git,
  GENESIS_BRANCH_RE,
  createHookTimer,
} from './_utils.mjs';

// Read-only skills that don't modify artifacts — always allowed on any branch
const READ_ONLY_SKILLS = new Set([
  'genesis-status', 'genesis:status',
  'genesis-help', 'genesis:help',
  'genesis-metrics', 'genesis:metrics',
  'genesis-explore', 'genesis:explore',
  'genesis-diff', 'genesis:diff',
  'genesis-resume', 'genesis:resume',
  'genesis-analyze', 'genesis:analyze',
  'genesis-checklist', 'genesis:checklist',
  'genesis-simulate', 'genesis:simulate',
]);

const input = await readStdin();
if (!input) process.exit(0);

const { tool_name, tool_input } = input;

// Only intercept Skill tool calls
if (tool_name !== 'Skill') process.exit(0);

const skillName = tool_input?.skill;
if (!skillName) process.exit(0);

// Only check genesis-* skills
if (!skillName.startsWith('genesis')) process.exit(0);

const timer = createHookTimer('branch-guard', 'PreToolUse', 'Skill');

// Allow read-only skills on any branch
if (READ_ONLY_SKILLS.has(skillName)) {
  timer.report('skip', `${skillName} is read-only — no branch check`);
  process.exit(0);
}

// Check current branch
const branch = getCurrentBranch();

if (!branch) {
  // Not in a git repo or detached HEAD — allow with warning
  timer.report('warn', 'Could not determine branch — skipping check');
  process.exit(0);
}

// Validate branch is a genesis feature branch
// Uses shared GENESIS_BRANCH_RE from _utils.mjs
const isGenesisFeatureBranch = GENESIS_BRANCH_RE.test(branch);

if (!isGenesisFeatureBranch) {
  // Per FR-028: attempt to auto-switch to the active feature's branch
  const { raw } = readProjectState();
  if (raw) {
    const branchPattern = /- \*\*Feature:\*\*\s*(.+)\n- \*\*Phase:\*\*\s*(\w+)\n- \*\*Branch:\*\*\s*(.+)/g;
    let match;
    while ((match = branchPattern.exec(raw)) !== null) {
      const featureBranch = match[3].trim();
      if (match[2] !== 'complete' && GENESIS_BRANCH_RE.test(featureBranch)) {
        // Try switching to the active feature's branch
        const switchResult = git(['checkout', featureBranch]);
        if (switchResult !== '') {
          timer.report('allow', `auto-switched to ${featureBranch}`);
          writeOutput(`Branch guard: auto-switched to ${featureBranch}`);
          process.exit(0);
        }
        // git checkout returns empty string on success too — verify
        const newBranch = git(['branch', '--show-current']);
        if (GENESIS_BRANCH_RE.test(newBranch)) {
          timer.report('allow', `auto-switched to ${newBranch}`);
          writeOutput(`Branch guard: auto-switched to ${newBranch}`);
          process.exit(0);
        }
        break;
      }
    }
  }

  // Feature-creating skills (specify, brainstorm) will create the branch themselves
  const BRANCH_CREATING_SKILLS = new Set([
    'genesis-specify', 'genesis:specify',
    'genesis-brainstorm', 'genesis:brainstorm',
  ]);
  if (BRANCH_CREATING_SKILLS.has(skillName)) {
    timer.report('allow', `${skillName} will create its own branch`);
    writeOutput(`Branch guard: ${skillName} will create feature branch.`);
    process.exit(0);
  }

  timer.report('block', `BLOCKED ${skillName} — not on a genesis feature branch (current: ${branch})`);
  blockToolCall(
    `BRANCH GUARD: Cannot run "${skillName}" on branch "${branch}".\n\n` +
    `No active feature branch found to auto-switch to.\n` +
    `Run /genesis-specify to start a new feature, or switch manually:\n` +
    `git checkout genesis/{NNN}-{feature-name}\n\n` +
    `Read-only commands (status, help, metrics, explore, diff, resume) work on any branch.`
  );
}

timer.report('allow', `${skillName} allowed on ${branch}`);
process.exit(0);
