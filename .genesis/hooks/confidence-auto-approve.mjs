#!/usr/bin/env node
/**
 * confidence-auto-approve.mjs — Elicitation hook (MAY)
 * Reads pipeline.json and auto-approves phases scoring 9-10 at hook level.
 * Makes Easy Mode auto-continue auditable and tamper-resistant.
 * Works in concert with --auto-accept flag.
 * FR-055
 */

import fs from 'node:fs';
import path from 'node:path';
import { readStdin, getActiveFeature, getEnvVar, GENESIS_DIR, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const timer = createHookTimer('confidence-auto-approve', 'Elicitation', 'Elicitation');

// Only active when --auto-accept is in play
const autoAccept = getEnvVar('GENESIS_AUTO_ACCEPT');
if (!autoAccept) {
	timer.report('pass', 'auto-accept not active');
	process.exit(0);
}

const feature = getActiveFeature();
if (!feature) {
	timer.report('pass', 'no active feature');
	process.exit(0);
}

// Read pipeline.json for current phase confidence
const pipelinePath = path.join(GENESIS_DIR, 'features', feature, 'pipeline.json');
try {
	const content = fs.readFileSync(pipelinePath, 'utf-8');
	const pipeline = JSON.parse(content);
	const activePhase = pipeline.phases?.find((p) => p.status === 'active' || p.status === 'paused');

	if (activePhase && activePhase.confidence_score !== null && activePhase.confidence_score >= 9) {
		// Auto-approve at hook level — auditable enforcement
		timer.report('pass', `auto-approve: ${activePhase.name} confidence ${activePhase.confidence_score}/10`);
		console.log(JSON.stringify({
			action: 'approved',
			auto: true,
			confidence: activePhase.confidence_score,
			approvedBy: 'easy-mode',
			note: `Hook-enforced auto-approval: confidence ${activePhase.confidence_score}/10 >= 9`,
		}));
		process.exit(0);
	}

	timer.report('pass', `confidence ${activePhase?.confidence_score ?? 'unknown'} — requires user input`);
} catch {
	timer.report('pass', 'no pipeline data — requires user input');
}

process.exit(0);
