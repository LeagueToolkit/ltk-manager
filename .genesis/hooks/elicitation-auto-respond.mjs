#!/usr/bin/env node
/**
 * elicitation-auto-respond.mjs — Elicitation hook
 * Auto-responds for read-only Genesis operations so the elicitation
 * dialog is never shown for non-mutating commands.
 * FR-054
 */

import { readStdin, createHookTimer } from './_utils.mjs';

const input = await readStdin();
if (!input) process.exit(0);

const timer = createHookTimer('elicitation-auto-respond', 'Elicitation', 'Elicitation');

// Check if the triggering command is a read-only operation
const command = input.command || input.tool_input?.args || '';
const READ_ONLY = ['explore', 'status', 'metrics', 'help', 'simulate'];

const cmd = command.replace('/genesis-', '').split(/\s+/)[0];
const isReadOnly = READ_ONLY.includes(cmd) || (cmd === 'clarify' && command.includes('--scan-only'));

if (isReadOnly) {
	// Auto-respond with approval — skip the dialog
	timer.report('pass', `auto-respond: ${cmd} is read-only`);
	// Output JSON response that auto-approves
	console.log(JSON.stringify({ action: 'approved', auto: true, note: 'read-only operation' }));
	process.exit(0);
}

// Non-read-only: let the dialog show
timer.report('pass', `${cmd} requires user input`);
process.exit(0);
