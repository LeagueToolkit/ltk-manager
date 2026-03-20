#!/usr/bin/env node
/**
 * elicitation-sanitize.mjs — ElicitationResult hook (MAY)
 * Strips injection content from note/exclusions fields.
 * Normalizes action to valid enum.
 * FR-056
 */

import { readStdin, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const timer = createHookTimer('elicitation-sanitize', 'ElicitationResult', 'ElicitationResult');

const VALID_ACTIONS = ['approved', 'approved-with-conditions', 'rejected'];

// Normalize action field
if (input.action && !VALID_ACTIONS.includes(input.action)) {
	timer.report('warn', `invalid action "${input.action}" — normalizing to "approved"`);
	input.action = 'approved';
}

// Strip HTML/script injection from text fields
function sanitize(text) {
	if (typeof text !== 'string') return '';
	return text
		.replace(/<[^>]*>/g, '')
		.replace(/javascript:/gi, '')
		.replace(/on\w+\s*=/gi, '')
		.slice(0, 2000);
}

if (input.note) input.note = sanitize(input.note);
if (input.exclusions && typeof input.exclusions === 'string') {
	input.exclusions = sanitize(input.exclusions);
}

timer.report('pass', 'sanitized');
process.exit(0);
