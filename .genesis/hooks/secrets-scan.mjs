#!/usr/bin/env node
/**
 * secrets-scan.mjs — PreToolUse hook (Write|Edit)
 * Blocks writes containing secret patterns (API keys, private keys, etc.).
 * FR-018, AC-015
 */

import { readStdin, blockToolCall, createHookTimer } from './_utils.mjs';

const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/,          name: 'OpenAI/Anthropic API key (sk-)' },
  { pattern: /gns_[a-zA-Z0-9]{20,}/,         name: 'Genesis API key (gns_)' },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/,         name: 'GitHub PAT (ghp_)' },
  { pattern: /gho_[a-zA-Z0-9]{36,}/,         name: 'GitHub OAuth (gho_)' },
  { pattern: /github_pat_[a-zA-Z0-9_]{80,}/, name: 'GitHub fine-grained PAT' },
  { pattern: /AKIA[0-9A-Z]{16}/,             name: 'AWS Access Key (AKIA)' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, name: 'Private key' },
  { pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/,           name: 'OpenSSH private key' },
  { pattern: /password\s*[:=]\s*["'][^"']{8,}["']/i,         name: 'Hardcoded password' },
  { pattern: /secret\s*[:=]\s*["'][^"']{8,}["']/i,           name: 'Hardcoded secret' },
  { pattern: /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,      name: 'Hardcoded API key' },
];

// Files/patterns that are allowed to mention secret patterns (docs, comments about security)
const SAFE_FILE_PATTERNS = [
  /\.md$/i,
];

const input = await readStdin();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path || '';

// Allow markdown documentation files to mention patterns
if (SAFE_FILE_PATTERNS.some((p) => p.test(filePath))) {
  process.exit(0);
}

// Get content to scan
const content = input.tool_input?.content || input.tool_input?.new_string || '';
if (!content) process.exit(0);

const timer = createHookTimer('secrets-scan', 'PreToolUse', input.tool_name || '');

for (const { pattern, name } of SECRET_PATTERNS) {
  const match = content.match(pattern);
  if (match) {
    timer.report('blocked', `secret detected: ${name}`);
    blockToolCall(
      `Blocked: potential secret detected in ${filePath}. ` +
      `Pattern: ${name} (matched: [redacted]). ` +
      `Use environment variables instead.`
    );
  }
}

timer.report('pass');
process.exit(0);
