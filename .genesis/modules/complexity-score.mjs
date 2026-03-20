/**
 * complexity-score.mjs — Static complexity analysis for task definitions.
 *
 * Computes a 1-10 complexity score based on:
 * - File count (creates + modifies)
 * - Scope type (new files vs modifications)
 * - Cross-module dependencies (shared components)
 * - Security sensitivity (auth, crypto, secrets keywords)
 * - Schema changes (data model, migration keywords)
 *
 * Returns { score, factors, tier } where tier maps to model routing:
 *   1-3 = "haiku", 4-6 = "sonnet", 7-10 = "opus"
 *
 * Zero external dependencies — Node.js built-ins only.
 * Execution time target: < 1 second (pure static analysis).
 */

/**
 * @typedef {Object} TaskDef
 * @property {string} [id] - Task ID (e.g., "T-001")
 * @property {string} [title] - Task title
 * @property {string[]} [creates] - Files to create
 * @property {string[]} [modifies] - Files to modify
 * @property {string[]} [sharedComponents] - Shared components referenced
 * @property {string[]} [dependencies] - Task dependency IDs
 * @property {string} [objective] - Task objective text
 * @property {string} [acceptanceCriteria] - Raw AC text
 * @property {string} [agentBoundary] - "Always" | "Ask First" | "Never"
 */

/**
 * @typedef {Object} ComplexityResult
 * @property {number} score - 1-10 complexity score
 * @property {string[]} factors - Human-readable explanation of scoring factors
 * @property {string} tier - "haiku" | "sonnet" | "opus"
 */

// Security-sensitive keywords in file paths or objective text
const SECURITY_KEYWORDS = [
  'auth', 'login', 'password', 'secret', 'token', 'crypto',
  'encrypt', 'decrypt', 'rbac', 'permission', 'session', 'oauth',
  'certificate', 'tls', 'ssl', 'jwt', 'hash', 'salt',
];

// Schema/data model keywords
const SCHEMA_KEYWORDS = [
  'migration', 'schema', 'data-model', 'database', 'table',
  'column', 'index', 'constraint', 'foreign-key', 'pgvector',
];

/**
 * Compute a 1-10 complexity score for a task definition.
 * Pure static analysis — no file I/O or AI calls.
 *
 * @param {TaskDef} taskDef - Task definition object
 * @returns {ComplexityResult}
 */
export function computeComplexityScore(taskDef) {
  const factors = [];
  let rawScore = 0;

  const creates = taskDef.creates || [];
  const modifies = taskDef.modifies || [];
  const totalFiles = creates.length + modifies.length;
  const shared = taskDef.sharedComponents || [];
  const deps = taskDef.dependencies || [];
  const allText = [
    taskDef.objective || '',
    taskDef.title || '',
    taskDef.acceptanceCriteria || '',
    ...creates,
    ...modifies,
  ].join(' ').toLowerCase();

  // Factor 1: File count (0-3 points)
  if (totalFiles <= 1) {
    rawScore += 1;
    factors.push(`File count: ${totalFiles} (minimal)`);
  } else if (totalFiles <= 3) {
    rawScore += 2;
    factors.push(`File count: ${totalFiles} (moderate)`);
  } else if (totalFiles <= 8) {
    rawScore += 3;
    factors.push(`File count: ${totalFiles} (significant)`);
  } else {
    rawScore += 4;
    factors.push(`File count: ${totalFiles} (high)`);
  }

  // Factor 2: New file creation (0-2 points)
  if (creates.length >= 3) {
    rawScore += 2;
    factors.push(`New files: ${creates.length} (high scaffolding)`);
  } else if (creates.length >= 1) {
    rawScore += 1;
    factors.push(`New files: ${creates.length}`);
  }

  // Factor 3: Cross-module dependencies (0-2 points)
  const readWriteShared = shared.filter((s) => s.includes('read-write'));
  if (readWriteShared.length >= 2) {
    rawScore += 2;
    factors.push(`Cross-module: ${readWriteShared.length} shared read-write components`);
  } else if (shared.length >= 2) {
    rawScore += 1;
    factors.push(`Cross-module: ${shared.length} shared components`);
  }

  // Factor 4: Security sensitivity (0-2 points)
  const securityHits = SECURITY_KEYWORDS.filter((kw) => allText.includes(kw));
  if (securityHits.length >= 3) {
    rawScore += 2;
    factors.push(`Security-sensitive: ${securityHits.join(', ')}`);
  } else if (securityHits.length >= 1) {
    rawScore += 1;
    factors.push(`Security-related: ${securityHits.join(', ')}`);
  }

  // Factor 5: Schema/data model changes (0-1 point)
  const schemaHits = SCHEMA_KEYWORDS.filter((kw) => allText.includes(kw));
  if (schemaHits.length >= 1) {
    rawScore += 1;
    factors.push(`Schema changes: ${schemaHits.join(', ')}`);
  }

  // Factor 6: Task dependencies (0-1 point)
  if (deps.length >= 3) {
    rawScore += 1;
    factors.push(`Dependencies: ${deps.length} upstream tasks`);
  }

  // Factor 7: Agent boundary escalation (0-1 point)
  if (taskDef.agentBoundary === 'Ask First' || taskDef.agentBoundary === 'Never') {
    rawScore += 1;
    factors.push(`Agent boundary: ${taskDef.agentBoundary}`);
  }

  // Clamp to 1-10
  const score = Math.max(1, Math.min(10, rawScore));

  // Map to tier
  let tier;
  if (score <= 3) tier = 'haiku';
  else if (score <= 6) tier = 'sonnet';
  else tier = 'opus';

  return { score, factors, tier };
}
