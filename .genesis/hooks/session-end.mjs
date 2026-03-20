#!/usr/bin/env node
/**
 * session-end.mjs — SessionEnd hook
 * Logs a summary entry to project-state.md on session termination.
 * FR-013, AC-014
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin,
  getEnvVar,
  getActiveFeature,
  git,
  today,
  GENESIS_DIR,
  createHookTimer,
} from './_utils.mjs';

const input = await readStdin();

const task = getEnvVar('GENESIS_CURRENT_TASK');
const feature = getActiveFeature();

const timer = createHookTimer('session-end', 'SessionEnd', input?.tool_name || 'SessionEnd');

// Build log entry
const parts = [`- [${today()}]`];

if (feature) {
  parts[0] += ` Session end — ${feature}`;
  if (task) parts[0] += ` at ${task}`;
} else {
  parts[0] += ' Session end — no active feature';
}

// Check for uncommitted changes
const status = git(['status', '--porcelain']);
if (status) {
  const changedFiles = status.split('\n').filter(Boolean).length;
  parts[0] += `, ${changedFiles} uncommitted file(s)`;
}

// Append to project-state.md
const statePath = path.join(GENESIS_DIR, 'project-state.md');
try {
  if (fs.existsSync(statePath)) {
    const content = fs.readFileSync(statePath, 'utf-8');
    // Append to session log section
    const logIdx = content.lastIndexOf('## Session Log');
    if (logIdx !== -1) {
      const before = content.slice(0, logIdx);
      const after = content.slice(logIdx);
      const lines = after.split('\n');
      // Insert after the header line
      lines.splice(2, 0, parts[0]);
      fs.writeFileSync(statePath, before + lines.join('\n'), 'utf-8');
    }
  }
} catch {
  // Failed to log — silently continue
}

// Prune project-state.md if over 20KB (FR-061, AC-023, NFR-004)
try {
  const stat = fs.statSync(statePath);
  if (stat.size > 20480) {
    const full = fs.readFileSync(statePath, 'utf-8');
    const logStart = full.lastIndexOf('## Session Log');
    if (logStart !== -1) {
      const beforeLog = full.slice(0, logStart);
      const logSection = full.slice(logStart);
      const logLines = logSection.split('\n');
      // Keep header + 30 most recent entries, archive the rest
      const header = logLines.slice(0, 2); // "## Session Log" + blank line
      const entries = logLines.slice(2).filter(l => l.startsWith('- ['));
      if (entries.length > 30) {
        const keep = entries.slice(0, 30);
        const archive = entries.slice(30);
        // Append archived entries to session-log-archive.md
        const archivePath = path.join(GENESIS_DIR, 'session-log-archive.md');
        const archiveHeader = fs.existsSync(archivePath) ? '' : '# Session Log Archive\n\n';
        fs.appendFileSync(archivePath, archiveHeader + archive.join('\n') + '\n', 'utf-8');
        // Rewrite project-state with pruned log
        const prunedLog = [...header, ...keep, `\n_${archive.length} older entries archived to session-log-archive.md_`].join('\n');
        fs.writeFileSync(statePath, beforeLog + prunedLog, 'utf-8');
      }
    }
  }
} catch {
  // Pruning failed — not critical
}

// Clean up context snapshot
const snapshotPath = path.join(GENESIS_DIR, '.context-snapshot.json');
try {
  if (fs.existsSync(snapshotPath)) {
    fs.unlinkSync(snapshotPath);
  }
} catch {
  // Cleanup failed — not critical
}

timer.report('pass', `session logged${feature ? ` for ${feature}` : ''}`);
process.exit(0);
