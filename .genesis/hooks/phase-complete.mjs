/**
 * phase-complete.mjs — Utility module (NOT a hook)
 * Automates the phase completion workflow: commit → push → PR → merge prompt → cleanup.
 * Called directly by the genesis-accept skill after approval is recorded.
 *
 * FR-025, FR-026, FR-027, FR-030, FR-031, FR-032, AC-008
 * Zero external dependencies — Node.js built-ins only.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..', '..');

/**
 * Run a git command in the project directory.
 * @param {string[]} args - Git arguments
 * @returns {string} stdout
 * @throws {Error} on failure
 */
function gitExec(args) {
  return execFileSync('git', args, {
    cwd: PROJECT_DIR,
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Check if `gh` CLI is available.
 * @returns {boolean}
 */
function hasGhCli() {
  try {
    execFileSync('gh', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Complete a phase: commit, push, create PR, prompt for merge, cleanup.
 *
 * @param {string} feature - Feature name (kebab-case)
 * @param {string} phase - Phase name (specify, plan, tasks, implement, review)
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Print steps without executing
 * @param {string} [options.targetBranch='main'] - Branch to merge into
 * @returns {{ success: boolean, steps: string[], prUrl?: string, error?: string }}
 */
export async function completePhase(feature, phase, options = {}) {
  const { dryRun = false, targetBranch = 'main' } = options;
  const steps = [];

  try {
    // 1. Get current branch
    const branch = gitExec(['branch', '--show-current']);
    steps.push(`Current branch: ${branch}`);

    if (dryRun) {
      steps.push(`[DRY RUN] Would commit: genesis: complete ${feature} ${phase}`);
      steps.push(`[DRY RUN] Would push: git push -u origin ${branch}`);
      steps.push(`[DRY RUN] Would create PR: ${branch} → ${targetBranch}`);
      steps.push(`[DRY RUN] Would prompt for merge`);
      steps.push(`[DRY RUN] Would cleanup branch after merge`);
      return { success: true, steps };
    }

    // 2. Check for uncommitted changes and commit
    const status = gitExec(['status', '--porcelain']);
    if (status) {
      // Stage only Genesis artifacts and hook files — avoid staging secrets or binaries
      const safePatterns = ['.genesis/', '.claude/', 'Cli/'];
      const changedFiles = status.split('\n')
        .map(line => line.slice(3).trim())
        .filter(f => f && safePatterns.some(p => f.startsWith(p)));

      if (changedFiles.length > 0) {
        gitExec(['add', ...changedFiles]);
        gitExec(['commit', '-m', `genesis: complete ${feature} ${phase}`]);
        steps.push(`Committed ${changedFiles.length} files: genesis: complete ${feature} ${phase}`);
      } else {
        steps.push('No Genesis-related changes to commit');
      }
    } else {
      steps.push('No uncommitted changes to commit');
    }

    // 3. Push to remote
    try {
      gitExec(['push', '-u', 'origin', branch]);
      steps.push(`Pushed to origin/${branch}`);
    } catch (e) {
      steps.push(`Push failed: ${e.message}. Continue manually with: git push -u origin ${branch}`);
      return { success: false, steps, error: `Push failed: ${e.message}` };
    }

    // 4. Create PR (if gh available)
    if (!hasGhCli()) {
      steps.push('gh CLI not found. Create PR manually.');
      steps.push(`Manual PR: ${branch} → ${targetBranch}`);
      return { success: true, steps };
    }

    try {
      const prTitle = `genesis: ${phase} ${feature}`;
      const prBody = `## Summary\n- Phase: ${phase}\n- Feature: ${feature}\n- Branch: ${branch}\n\nApproved via /genesis-accept.`;
      const prOutput = execFileSync('gh', [
        'pr', 'create',
        '--title', prTitle,
        '--body', prBody,
        '--base', targetBranch,
      ], {
        cwd: PROJECT_DIR,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      steps.push(`PR created: ${prOutput}`);

      return {
        success: true,
        steps,
        prUrl: prOutput,
      };
    } catch (e) {
      steps.push(`PR creation failed: ${e.message}`);
      steps.push(`Create PR manually: gh pr create --base ${targetBranch}`);
      return { success: true, steps };
    }
  } catch (e) {
    steps.push(`Error: ${e.message}`);
    return { success: false, steps, error: e.message };
  }
}
