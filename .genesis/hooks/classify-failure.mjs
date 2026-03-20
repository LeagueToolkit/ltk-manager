#!/usr/bin/env node
/**
 * classify-failure.mjs — PostToolUseFailure hook (Bash)
 * Classifies Bash failures and provides actionable recovery context.
 * FR-016, AC-013
 */

import { readStdin, writeOutput, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const timer = createHookTimer('classify-failure', 'PostToolUseFailure', input.tool_name || '');

const command = input.tool_input?.command || '';
const error = input.tool_output || input.error || '';
const exitCode = input.exit_code;

// Classify the failure
const classification = classify(command, error, exitCode);

if (classification) {
  timer.report('pass', classification.category);
  writeOutput(
    `Failure classification: ${classification.category}\n` +
    `Likely cause: ${classification.cause}\n` +
    `Suggested fix: ${classification.fix}`
  );
} else {
  timer.report('pass', 'unclassified');
}

process.exit(0);

function classify(cmd, err, code) {
  const errLower = err.toLowerCase();

  // Compilation errors
  if (cmd.match(/\bcargo\s+(build|check|test)\b/)) {
    if (errLower.includes('cannot find')) {
      return {
        category: 'COMPILATION',
        cause: 'Missing import or undefined symbol',
        fix: 'Check use/mod statements. The symbol may need to be imported or the module may not be declared.',
      };
    }
    if (errLower.includes('type mismatch') || errLower.includes('expected')) {
      return {
        category: 'COMPILATION',
        cause: 'Type mismatch',
        fix: 'Check function signatures and return types. The compiler error message above shows the expected vs actual types.',
      };
    }
    if (errLower.includes('borrow') || errLower.includes('lifetime')) {
      return {
        category: 'COMPILATION',
        cause: 'Borrow checker violation',
        fix: 'Review ownership. Consider cloning, using references, or restructuring to satisfy the borrow checker.',
      };
    }
    return {
      category: 'COMPILATION',
      cause: 'Rust compilation error',
      fix: 'Read the error message carefully — rustc errors are very descriptive.',
    };
  }

  // npm/node errors
  if (cmd.match(/\b(npm|npx|node)\b/)) {
    if (errLower.includes('enoent') || errLower.includes('not found')) {
      return {
        category: 'MISSING_DEPENDENCY',
        cause: 'Command or package not found',
        fix: 'Run `npm install` or check that the package is in package.json.',
      };
    }
    if (errLower.includes('syntax error') || errLower.includes('unexpected token')) {
      return {
        category: 'SYNTAX',
        cause: 'JavaScript/TypeScript syntax error',
        fix: 'Check the file and line number in the error. Common causes: missing comma, unclosed bracket, wrong import syntax.',
      };
    }
  }

  // Git errors
  if (cmd.match(/\bgit\b/)) {
    if (errLower.includes('conflict')) {
      return {
        category: 'GIT_CONFLICT',
        cause: 'Merge conflict',
        fix: 'Resolve conflicts in the listed files, then `git add` and commit.',
      };
    }
    if (errLower.includes('not a git repository')) {
      return {
        category: 'GIT_CONFIG',
        cause: 'Not in a git repository',
        fix: 'Check the working directory. You may need to cd to the project root.',
      };
    }
  }

  // Permission errors
  if (errLower.includes('permission denied') || errLower.includes('eacces')) {
    return {
      category: 'PERMISSION',
      cause: 'Permission denied',
      fix: 'Check file permissions. On Windows, the file may be locked by another process.',
    };
  }

  // Rate limit events
  if (errLower.includes('rate_limit') || errLower.includes('rate limit') || errLower.includes('429')) {
    const resetsAtMatch = err.match(/resets?\s*at\s*[:=]?\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?|\d+)/i);
    let countdown = '';
    if (resetsAtMatch) {
      const resetTime = isNaN(resetsAtMatch[1])
        ? new Date(resetsAtMatch[1]).getTime()
        : parseInt(resetsAtMatch[1]) * 1000;
      const remaining = Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      countdown = ` Resets in ${mins}m ${secs}s.`;
    }
    return {
      category: 'RATE_LIMIT',
      cause: `API rate limit exceeded.${countdown}`,
      fix: 'Wait for the rate limit to reset before retrying. Consider reducing request frequency or using a different model tier.',
    };
  }

  // Timeout
  if (errLower.includes('timeout') || errLower.includes('timed out')) {
    return {
      category: 'TIMEOUT',
      cause: 'Command timed out',
      fix: 'The command took too long. Consider increasing the timeout or breaking the operation into smaller steps.',
    };
  }

  // Generic fallback
  if (code !== 0) {
    return {
      category: 'UNKNOWN',
      cause: `Command exited with code ${code}`,
      fix: 'Review the error output above for details.',
    };
  }

  return null;
}
