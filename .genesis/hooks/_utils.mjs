/**
 * Shared hook utilities for all Genesis Claude Code hook scripts.
 * Zero external dependencies — Node.js built-ins only.
 *
 * Every hook script imports from this module for:
 * - stdin/stdout JSON handling (Claude Code hook protocol)
 * - Environment file I/O ($CLAUDE_ENV_FILE)
 * - Project state reading
 * - Feature artifact loading
 * - Active feature resolution
 * - YAML frontmatter parsing
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root — two levels up from .genesis/hooks/ */
export const PROJECT_DIR = path.resolve(__dirname, '..', '..');

/** .genesis directory */
export const GENESIS_DIR = path.join(PROJECT_DIR, '.genesis');

// ---------------------------------------------------------------------------
// Claude Code Hook Protocol — stdin / stdout
// ---------------------------------------------------------------------------

/**
 * Read and parse JSON from stdin (Claude Code hook input).
 * Returns the parsed object, or null if stdin is empty or invalid.
 * @returns {Promise<object|null>}
 */
export async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      if (!data.trim()) { done(null); return; }
      try { done(JSON.parse(data)); } catch { done(null); }
    });
    process.stdin.on('error', () => done(null));
    // Safety timeout for edge cases where stdin never ends (500ms)
    setTimeout(() => {
      if (!data.trim()) done(null);
      else { try { done(JSON.parse(data)); } catch { done(null); } }
    }, 500);
  });
}

/**
 * Write hook output to stdout in Claude Code format.
 * @param {string} additionalContext - Context string for the AI
 */
export function writeOutput(additionalContext) {
  if (!additionalContext) return;
  const output = JSON.stringify({ additionalContext });
  process.stdout.write(output);
}

/**
 * Block the tool call (exit code 2) with a reason on stderr.
 * @param {string} reason - Why the tool call is blocked
 */
export function blockToolCall(reason) {
  process.stderr.write(reason);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Environment File I/O ($CLAUDE_ENV_FILE)
// ---------------------------------------------------------------------------

/**
 * Read all key-value pairs from $CLAUDE_ENV_FILE.
 * @returns {Record<string, string>} Key-value pairs
 */
export function readEnvFile() {
  const envFilePath = process.env.CLAUDE_ENV_FILE;
  if (!envFilePath || !fs.existsSync(envFilePath)) return {};

  const content = fs.readFileSync(envFilePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Write a key-value pair to $CLAUDE_ENV_FILE (append).
 * Creates the file if it doesn't exist.
 * @param {string} key
 * @param {string} value
 */
export function writeEnvFile(key, value) {
  const envFilePath = process.env.CLAUDE_ENV_FILE;
  if (!envFilePath) return;

  // Read existing to check if key already exists
  let content = '';
  if (fs.existsSync(envFilePath)) {
    content = fs.readFileSync(envFilePath, 'utf-8');
  }

  // Replace existing key or append
  const lines = content.split('\n').filter((l) => l.trim());
  const existingIdx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const newLine = `${key}=${value}`;

  if (existingIdx !== -1) {
    lines[existingIdx] = newLine;
  } else {
    lines.push(newLine);
  }

  fs.writeFileSync(envFilePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Read a specific env var from $CLAUDE_ENV_FILE.
 * @param {string} key
 * @returns {string|undefined}
 */
export function getEnvVar(key) {
  const env = readEnvFile();
  return env[key];
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser (inline, zero deps)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Handles the Genesis schema: strings, dates, simple lists, booleans.
 * @param {string} content - Full markdown file content
 * @returns {{ data: object|null, content: string }}
 */
export function parseFrontmatter(content) {
  if (!content || typeof content !== 'string') {
    return { data: null, content: content || '' };
  }

  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { data: null, content };
  }

  const secondDelim = trimmed.indexOf('\n---', 3);
  if (secondDelim === -1) {
    return { data: null, content };
  }

  const yamlBlock = trimmed.slice(4, secondDelim).trim();
  const body = trimmed.slice(secondDelim + 4).replace(/^\r?\n/, '');

  const data = {};
  const lines = yamlBlock.split('\n');
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const listMatch = line.match(/^\s+-\s+(.+)/);
    if (listMatch && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(unquote(listMatch[1].trim()));
      continue;
    }

    if (currentList && currentKey) {
      data[currentKey] = currentList;
      currentList = null;
    }

    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawValue = kvMatch[2].trim();
      if (rawValue === '' || rawValue === '~' || rawValue === 'null') {
        data[currentKey] = null;
      } else {
        data[currentKey] = parseScalar(rawValue);
        currentKey = null;
      }
    }
  }

  if (currentList && currentKey) {
    data[currentKey] = currentList;
  }

  return { data, content: body };
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
  }
  return value;
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Session Cache Builder (shared between session-init and prompt-context)
// ---------------------------------------------------------------------------

/**
 * Build the core session cache data object.
 * Loads constitution (directory or monolith), spec AC section, and plan preview.
 * Both session-init.mjs and prompt-context.mjs use this to avoid duplication.
 *
 * @param {string} featureName - Active feature name
 * @returns {{ version: number, timestamp: string, feature: string, constitution: string|null, constitutionFragments: Array, specAC: string|null, planPreview: string|null }}
 */
export function buildCacheData(featureName) {
  const cache = {
    version: 2,
    timestamp: new Date().toISOString(),
    feature: featureName,
    constitution: null,
    constitutionFragments: [],
    specAC: null,
    planPreview: null,
  };

  // ── Constitution (directory or monolith) ──────────────────────────────

  const constitutionDir = path.join(GENESIS_DIR, 'constitution');
  const constitutionFile = path.join(GENESIS_DIR, 'constitution.md');

  if (fs.existsSync(constitutionDir)) {
    const indexContent = safeReadFile(path.join(constitutionDir, 'index.md'));
    if (indexContent) cache.constitution = indexContent;

    try {
      const files = fs.readdirSync(constitutionDir)
        .filter((f) => f.endsWith('.md') && f !== 'index.md');
      for (const file of files) {
        const content = safeReadFile(path.join(constitutionDir, file));
        if (content) {
          const patternsMatch = content.match(/file_patterns:\s*\[([^\]]+)\]/);
          cache.constitutionFragments.push({
            name: file.replace('.md', ''),
            content,
            patterns: patternsMatch
              ? patternsMatch[1].split(',').map((p) => p.trim().replace(/['"]/g, ''))
              : null,
          });
        }
      }
    } catch {
      // Dir read failed
    }
  } else if (fs.existsSync(constitutionFile)) {
    const content = safeReadFile(constitutionFile);
    if (content) {
      const maxLen = 12000;
      cache.constitution = content.length > maxLen
        ? content.slice(0, maxLen) + '\n\n[... constitution truncated]'
        : content;
    }
  }

  // ── Feature artifacts (spec AC section + plan preview) ────────────────

  const artifacts = readFeatureArtifacts(featureName);

  if (artifacts.spec) {
    const acMatch = artifacts.spec.replace(/\r\n/g, '\n')
      .match(/## Acceptance Criteria\n([\s\S]*?)(?=\n## |$)/);
    if (acMatch) cache.specAC = acMatch[1].trim();
  }

  if (artifacts.plan) {
    cache.planPreview = artifacts.plan.slice(0, 2000);
  }

  return cache;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return stdout. Returns empty string on failure.
 * @param {string} args - Git arguments
 * @returns {string}
 */
export function git(args) {
  try {
    const argList = typeof args === 'string' ? args.split(/\s+/).filter(Boolean) : args;
    return execFileSync('git', argList, {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Get the current git branch name.
 * @returns {string}
 */
export function getCurrentBranch() {
  return git('branch --show-current');
}

// ---------------------------------------------------------------------------
// Project State
// ---------------------------------------------------------------------------

/**
 * Read and parse .genesis/project-state.md.
 * Returns the frontmatter data and raw content.
 * @returns {{ data: object|null, content: string, raw: string }}
 */
export function readProjectState() {
  const statePath = path.join(GENESIS_DIR, 'project-state.md');
  if (!fs.existsSync(statePath)) {
    return { data: null, content: '', raw: '' };
  }
  const raw = fs.readFileSync(statePath, 'utf-8');
  const parsed = parseFrontmatter(raw);
  return { ...parsed, raw };
}

// ---------------------------------------------------------------------------
// Active Feature Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the active feature name.
 * Strategy:
 *   1. Check current git branch for genesis/{NNN}-{feature} pattern
 *   2. Fall back to project-state.md first feature with phase = implement
 *   3. Return null if no active feature
 * @returns {string|null}
 */
export function getActiveFeature() {
  // 1. Try git branch
  const branch = getCurrentBranch();
  const branchMatch = branch.match(/^genesis\/\d{3}-(.+)$/);
  if (branchMatch) return branchMatch[1];

  // 2. Fall back to project-state.md
  const { raw } = readProjectState();
  if (!raw) return null;

  // Look for feature entries with phase: implement
  const featurePattern = /- \*\*Feature:\*\*\s*(.+)\n- \*\*Phase:\*\*\s*(\w+)/g;
  let match;
  while ((match = featurePattern.exec(raw)) !== null) {
    if (match[2] === 'implement') return match[1].trim();
  }

  // 3. Return first non-complete feature
  featurePattern.lastIndex = 0;
  while ((match = featurePattern.exec(raw)) !== null) {
    if (match[2] !== 'complete') return match[1].trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Feature Artifacts
// ---------------------------------------------------------------------------

/**
 * Read all artifacts for a feature.
 * Checks .genesis/features/{name}/ first, falls back to old structure.
 * @param {string} featureName
 * @returns {{ spec: string|null, plan: string|null, tasks: string|null, brainstorm: string|null, dir: string|null }}
 */
export function readFeatureArtifacts(featureName) {
  const artifacts = { spec: null, plan: null, tasks: null, brainstorm: null, dir: null };

  // Try new structure first
  let featureDir = path.join(GENESIS_DIR, 'features', featureName);
  if (!fs.existsSync(featureDir)) {
    // Backward compat: old structure
    featureDir = null;
    const specPath = path.join(GENESIS_DIR, 'specs', featureName, 'spec.md');
    if (fs.existsSync(specPath)) {
      artifacts.spec = fs.readFileSync(specPath, 'utf-8');
    }
    const planPath = path.join(GENESIS_DIR, 'plans', featureName, 'plan.md');
    if (fs.existsSync(planPath)) {
      artifacts.plan = fs.readFileSync(planPath, 'utf-8');
    }
    const tasksPath = path.join(GENESIS_DIR, 'tasks', featureName, 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      artifacts.tasks = fs.readFileSync(tasksPath, 'utf-8');
    }
    return artifacts;
  }

  artifacts.dir = featureDir;

  const files = {
    spec: 'spec.md',
    plan: 'plan.md',
    tasks: 'tasks.md',
    brainstorm: 'brainstorm.md',
  };

  for (const [key, filename] of Object.entries(files)) {
    const filePath = path.join(featureDir, filename);
    if (fs.existsSync(filePath)) {
      artifacts[key] = fs.readFileSync(filePath, 'utf-8');
    }
  }

  return artifacts;
}

/**
 * Find the next pending task with all dependencies complete.
 * @param {string} tasksContent - Raw tasks.md content
 * @returns {{ id: string, title: string, objective: string, criteria: string[], expectedOutputs: string[] }|null}
 */
export function findNextPendingTask(tasksContent) {
  if (!tasksContent) return null;

  // Normalize line endings (Windows CRLF → LF)
  const content = tasksContent.replace(/\r\n/g, '\n');

  // Parse all task statuses
  const taskStatuses = {};
  const statusPattern = /### (T-\d{3}):.+\n\n\*\*Status:\*\*\s*(\w+)/g;
  let match;
  while ((match = statusPattern.exec(content)) !== null) {
    taskStatuses[match[1]] = match[2];
  }

  // Find pending tasks with met dependencies
  const taskPattern = /### (T-\d{3}):\s*(.+)\n\n\*\*Status:\*\*\s*Pending\n\*\*Complexity:\*\*\s*.+\n\*\*Dependencies:\*\*\s*(.+)/g;
  while ((match = taskPattern.exec(content)) !== null) {
    const id = match[1];
    const title = match[2].trim();
    const depsRaw = match[3].trim();

    // Check dependencies
    let depsOk = true;
    if (depsRaw !== 'None') {
      const deps = depsRaw.split(',').map((d) => d.trim()).filter(Boolean);
      for (const dep of deps) {
        // Handle ranges like "T-012..T-025"
        if (dep.includes('..')) {
          const [start, end] = dep.split('..').map((d) => d.trim());
          const startNum = parseInt(start.replace('T-', ''));
          const endNum = parseInt(end.replace('T-', ''));
          for (let i = startNum; i <= endNum; i++) {
            const depId = `T-${String(i).padStart(3, '0')}`;
            if (taskStatuses[depId] !== 'Complete') {
              depsOk = false;
              break;
            }
          }
        } else if (taskStatuses[dep] !== 'Complete') {
          depsOk = false;
        }
        if (!depsOk) break;
      }
    }

    if (depsOk) {
      // Extract objective and criteria from the task block
      const taskBlockStart = content.indexOf(`### ${id}:`);
      const nextTaskMatch = content.indexOf('\n### T-', taskBlockStart + 1);
      const nextGroupMatch = content.indexOf('\n## ', taskBlockStart + 1);
      const blockEnd = Math.min(
        nextTaskMatch === -1 ? Infinity : nextTaskMatch,
        nextGroupMatch === -1 ? Infinity : nextGroupMatch,
        content.length
      );
      const block = content.slice(taskBlockStart, blockEnd);

      // Extract objective
      const objMatch = block.match(/#### Objective\n(.+?)(?=\n####|\n---)/s);
      const objective = objMatch ? objMatch[1].trim() : '';

      // Extract acceptance criteria
      const criteria = [];
      const criteriaPattern = /- \[ \] (.+)/g;
      let cm;
      const criteriaSection = block.match(/#### Acceptance Criteria\n([\s\S]+?)(?=\n####|\n---)/);
      if (criteriaSection) {
        const criteriaBlock = criteriaSection[1];
        while ((cm = criteriaPattern.exec(criteriaBlock)) !== null) {
          criteria.push(cm[1].trim());
        }
      }

      // Extract expected outputs from File Paths
      const expectedOutputs = [];
      const filePathsSection = block.match(/#### File Paths\n([\s\S]+?)(?=\n####|\n---)/);
      if (filePathsSection) {
        const fpPattern = /- (?:Creates|Modifies):\s*`(.+?)`/g;
        let fp;
        while ((fp = fpPattern.exec(filePathsSection[1])) !== null) {
          expectedOutputs.push(fp[1]);
        }
      }

      return { id, title, objective, criteria, expectedOutputs };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Safe file helpers
// ---------------------------------------------------------------------------

/**
 * Read a file safely, returning null if it doesn't exist.
 * @param {string} filePath
 * @returns {string|null}
 */
export function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read a JSON file safely, returning null if missing or invalid.
 * @param {string} filePath
 * @returns {object|null}
 */
export function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a JSON file atomically (write to temp, then rename).
 * @param {string} filePath
 * @param {object} data
 */
export function safeWriteJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read and validate approvals.json for a feature.
 * Returns an array of approval records, each with {phase, version, status, timestamp}.
 * Returns [] on missing file. Logs error on malformed JSON.
 * @param {string} featureName - kebab-case feature name
 * @returns {Array<{phase: string, version: string, status: string, timestamp: string, exclusions?: string[], note?: string}>}
 */
export function readApprovals(featureName) {
  // Sanitize feature name to prevent path traversal
  const sanitized = (featureName || '').replace(/[^a-z0-9-]/gi, '');
  if (!sanitized) return [];
  const filePath = path.join(GENESIS_DIR, 'features', sanitized, 'approvals.json');
  const data = safeReadJSON(filePath);

  if (data === null) {
    // File missing or unreadable — not an error, just no approvals yet
    return [];
  }

  if (!Array.isArray(data)) {
    process.stderr.write(`[readApprovals] Malformed approvals.json for "${featureName}": expected array, got ${typeof data}\n`);
    return [];
  }

  // Validate each entry has required fields
  const valid = data.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.phase !== 'string' || typeof entry.status !== 'string') {
      process.stderr.write(`[readApprovals] Skipping malformed entry in "${featureName}": missing phase or status\n`);
      return false;
    }
    return true;
  });

  return valid;
}

// ---------------------------------------------------------------------------
// Timestamp / date helpers
// ---------------------------------------------------------------------------

/**
 * Get current ISO date string (YYYY-MM-DD).
 * @returns {string}
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get current ISO timestamp.
 * @returns {string}
 */
export function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Hook Event Reporter — IPC via JSONL file
// ---------------------------------------------------------------------------

const HOOK_EVENTS_FILE = path.join(GENESIS_DIR, '.hook-events.jsonl');
const MAX_HOOK_EVENT_LINES = 1000;

/**
 * Report a hook execution event to the JSONL IPC channel.
 * Writes synchronously to .genesis/.hook-events.jsonl.
 * Does NOT write to stdout/stderr — safe for Claude Code hook protocol.
 *
 * @param {{ hookName: string, lifecycle: string, toolName: string, status: string, durationMs?: number, message?: string }} event
 */
export function reportHookEvent({ hookName, lifecycle, toolName, status, durationMs, message }) {
  const entry = {
    hookName,
    lifecycle,
    toolName,
    status,
    durationMs: durationMs ?? 0,
    message: message ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    const line = JSON.stringify(entry) + '\n';

    // Append to file (create if missing)
    fs.appendFileSync(HOOK_EVENTS_FILE, line, 'utf-8');

    // Rotate if too many lines (keep last MAX_HOOK_EVENT_LINES / 2 lines)
    try {
      const content = fs.readFileSync(HOOK_EVENTS_FILE, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length > MAX_HOOK_EVENT_LINES) {
        const kept = lines.slice(-Math.floor(MAX_HOOK_EVENT_LINES / 2));
        fs.writeFileSync(HOOK_EVENTS_FILE, kept.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // Rotation failure is non-fatal
    }
  } catch {
    // Silently ignore write failures — hooks must not fail due to reporter
  }
}

/**
 * Create a hook timing helper. Call start() before work, then report() after.
 * @param {string} hookName - Name of the hook script (e.g., 'scope-guard')
 * @param {string} lifecycle - 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
 * @param {string} toolName - Name of the tool being hooked
 * @returns {{ report: (status: string, message?: string) => void }}
 */
export function createHookTimer(hookName, lifecycle, toolName) {
  const startTime = Date.now();
  reportHookEvent({ hookName, lifecycle, toolName, status: 'running' });

  return {
    report(status, message) {
      const durationMs = Date.now() - startTime;
      reportHookEvent({ hookName, lifecycle, toolName, status, durationMs, message });
    },
  };
}
