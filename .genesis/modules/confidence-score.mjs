/**
 * confidence-score.mjs — Phase transition quality gate for Easy Mode pipelines.
 *
 * Computes a 1-10 confidence score evaluating:
 * - Completeness of phase output (all expected sections present)
 * - Alignment with acceptance criteria (does output address each AC?)
 * - Unresolved ambiguities (NEEDS_CLARIFICATION markers)
 * - Clarity of next steps
 *
 * Returns { score, concerns, recommendation } where recommendation is:
 *   "proceed" (score >= threshold) or "pause" (score < threshold)
 *
 * Default threshold: 7 (configurable via options).
 *
 * Zero external dependencies — Node.js built-ins only.
 * Execution time target: < 5 seconds (lightweight text analysis).
 */

/**
 * @typedef {Object} ConfidenceResult
 * @property {number} score - 1-10 confidence score
 * @property {string[]} concerns - List of identified gaps or issues
 * @property {string} recommendation - "proceed" | "pause"
 */

/**
 * Expected section patterns by phase name.
 * Each phase should produce output containing these structural markers.
 */
const PHASE_SECTIONS = {
  specify: [
    'overview', 'user stories', 'functional requirements',
    'non-functional requirements', 'acceptance criteria',
    'agent boundaries', 'out of scope', 'assumptions',
  ],
  clarify: [
    'coverage scan', 'category', 'status',
  ],
  plan: [
    'technical context', 'component architecture',
    'implementation strategy', 'testing strategy',
  ],
  tasks: [
    'group', 'status', 'complexity', 'dependencies',
    'acceptance criteria', 'context package',
  ],
};

/**
 * Compute a confidence score for a phase transition.
 *
 * @param {string} phaseName - Name of the completed phase (specify, clarify, plan, tasks)
 * @param {string} phaseOutput - Full text output of the completed phase
 * @param {Object} [options]
 * @param {number} [options.threshold=7] - Score threshold for auto-proceed
 * @param {string[]} [options.acceptanceCriteria] - AC IDs to check against
 * @returns {ConfidenceResult}
 */
export function computeConfidenceScore(phaseName, phaseOutput, options = {}) {
  const threshold = options.threshold ?? 7;
  const concerns = [];
  let rawScore = 10; // Start at max, deduct for issues

  const output = (phaseOutput || '').toLowerCase();
  const expectedSections = PHASE_SECTIONS[phaseName] || [];

  // Factor 1: Section completeness (-1 per missing section, max -3)
  let missingSections = 0;
  for (const section of expectedSections) {
    if (!output.includes(section)) {
      missingSections++;
      if (missingSections <= 3) {
        concerns.push(`Missing expected section: "${section}"`);
      }
    }
  }
  if (missingSections > 0) {
    const deduction = Math.min(3, missingSections);
    rawScore -= deduction;
    if (missingSections > 3) {
      concerns.push(`...and ${missingSections - 3} more missing sections`);
    }
  }

  // Factor 2: Unresolved NEEDS_CLARIFICATION markers (-2 per blocking, -1 per non-blocking)
  const blockingMarkers = (output.match(/needs_clarification[\s\S]*?blocking:\s*true/gi) || []).length;
  const nonBlockingMarkers = (output.match(/needs_clarification[\s\S]*?blocking:\s*false/gi) || []).length;

  if (blockingMarkers > 0) {
    rawScore -= Math.min(4, blockingMarkers * 2);
    concerns.push(`${blockingMarkers} blocking NEEDS_CLARIFICATION marker(s) found`);
  }
  if (nonBlockingMarkers > 0) {
    rawScore -= Math.min(2, nonBlockingMarkers);
    concerns.push(`${nonBlockingMarkers} non-blocking NEEDS_CLARIFICATION marker(s) found`);
  }

  // Factor 3: TBD/TODO indicators (-1 each, max -2)
  const tbdCount = (output.match(/\btbd\b/gi) || []).length;
  const todoCount = (output.match(/\btodo\b/gi) || []).length;
  const placeholders = tbdCount + todoCount;
  if (placeholders > 0) {
    rawScore -= Math.min(2, placeholders);
    concerns.push(`${placeholders} TBD/TODO placeholder(s) found`);
  }

  // Factor 4: Empty or very short output (-3)
  if (output.length < 200) {
    rawScore -= 3;
    concerns.push(`Phase output is very short (${output.length} chars)`);
  } else if (output.length < 500) {
    rawScore -= 1;
    concerns.push(`Phase output is relatively short (${output.length} chars)`);
  }

  // Factor 5: AC coverage check (if ACs provided)
  const acs = options.acceptanceCriteria || [];
  if (acs.length > 0) {
    let uncoveredACs = 0;
    for (const ac of acs) {
      if (!output.includes(ac.toLowerCase())) {
        uncoveredACs++;
      }
    }
    if (uncoveredACs > 0) {
      const deduction = Math.min(2, Math.ceil(uncoveredACs / 2));
      rawScore -= deduction;
      concerns.push(`${uncoveredACs} of ${acs.length} acceptance criteria not referenced in output`);
    }
  }

  // Factor 6: Vague language indicators (-1)
  const vaguePatterns = [
    /\bshould be fast\b/i,
    /\buser.?friendly\b/i,
    /\bscalable\b/i,
    /\bas needed\b/i,
    /\betc\.\s/i,
  ];
  const vagueHits = vaguePatterns.filter((p) => p.test(output));
  if (vagueHits.length >= 2) {
    rawScore -= 1;
    concerns.push(`Vague language detected (${vagueHits.length} patterns)`);
  }

  // Clamp to 1-10
  const score = Math.max(1, Math.min(10, rawScore));

  return {
    score,
    concerns,
    recommendation: score >= threshold ? 'proceed' : 'pause',
  };
}
