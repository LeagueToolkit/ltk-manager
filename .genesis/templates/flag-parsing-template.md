## Flag Parsing

Parse `$ARGUMENTS` to extract recognized flags and the feature name.

### Step 1: Extract Flags

Scan `$ARGUMENTS` for these universal flags (case-sensitive, `--` prefix required):

| Flag            | Effect                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| `--dry-run`     | Preview output without writing files or committing                             |
| `--force`       | Skip "already exists" and confirmation prompts                                 |
| `--verbose`     | Expanded detail in output                                                      |
| `--quiet`       | Suppress intermediate status, show only final output                           |
| `--json`        | Machine-readable JSON output where applicable                                  |
| `--accept`      | Auto-approve the current phase (see Accept Gates)                              |
| `--easy`        | Easy Mode — chain phases automatically                                         |
| `--auto-accept` | Zero-input Easy Mode — auto-approve confidence 9–10 phases (requires `--easy`) |

### Step 2: Extract Feature Name

After removing all recognized `--` flags from `$ARGUMENTS`, the remaining text is the feature name (and any positional arguments). Trim whitespace. If empty, resolve the feature name from project-state.md or the current git branch.

### Step 3: Warn on Unrecognized Flags

If any token in `$ARGUMENTS` starts with `--` but is not in the recognized list above, emit a warning:

```
Warning: Unrecognized flag '{flag}' — ignoring. Known flags: --dry-run, --force, --verbose, --quiet, --json, --accept, --easy, --auto-accept
```

Do NOT fail on unrecognized flags — warn and continue.

### Step 4: Resolve Flag Conflicts

When multiple flags interact, apply these rules:

| Conflict                             | Resolution                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `--quiet --verbose`                  | Last flag in argument string wins                                                               |
| `--json --verbose`                   | Compose — JSON output with expanded fields                                                      |
| `--dry-run --force`                  | Compose — preview output without confirmation prompts                                           |
| `--easy --dry-run`                   | Preview the pipeline plan (phases, expected outputs) without executing                          |
| `--auto-accept` alone (no `--easy`)  | Error: "`--auto-accept` requires `--easy`. Use `--easy --auto-accept` for zero-input pipeline." |
| `--easy --auto-accept --interactive` | `--interactive` wins — pause at every phase boundary regardless of confidence                   |
| `--easy --auto-accept --dry-run`     | Preview only — show what would auto-accept but do not execute                                   |
| `--accept` on already-approved phase | Silent no-op with message: "Phase already approved"                                             |
| `--force --accept`                   | Equivalent to `--accept` (force does not affect approval)                                       |

### Step 5: Apply Behavioral Modes

Based on extracted flags, adjust command behavior:

- **If `--dry-run`:** Show what would happen (files created/modified, commits, state changes) but do not execute. Prefix output with `[DRY RUN]`.
- **If `--force`:** Skip prompts like "already exists — revise or start fresh?" and proceed with the default action.
- **If `--verbose`:** Include additional context: file sizes, token counts, timing, intermediate decisions.
- **If `--quiet`:** Suppress progress messages and intermediate output. Show only the final result or error.
- **If `--json`:** Format the final output as a JSON object with standardized keys: `{ "status", "feature", "phase", "result", "next_command" }`.
- **If `--accept`:** After the phase completes successfully, automatically approve without prompting. Record approval in `approvals.json`.
- **If `--easy`:** After this phase completes, automatically invoke the next phase in the pipeline sequence.
- **If `--auto-accept`:** (Must be combined with `--easy`.) Phases scoring confidence 9–10 auto-approve AND skip the approval dialog entirely — zero user input. Phases scoring 7–8 still prompt. Phases scoring below 7 still full stop. The `--auto-accept` flag is the core of Easy Mode's autonomous pipeline capability.

### Step 6: Effort-Level Calibration

Adjust reasoning depth based on the skill's model tier:

| Tier          | Model     | Effort Level                                                                                                                                                                  |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operator**  | `haiku`   | Reduced reasoning. Execute mechanically — follow instructions literally, minimize deliberation, favor speed over nuance. Do not explore alternatives unless explicitly asked. |
| **Analyst**   | `sonnet`  | Standard depth. Analyze thoroughly but stay focused. Provide findings and recommendations without implementing changes.                                                       |
| **Architect** | `inherit` | Full reasoning. Consider trade-offs, explore alternatives, make design decisions. This is the default for complex creative and implementation work.                           |

The skill's `model` frontmatter field determines which tier applies. When in doubt, check `.genesis/hooks/tier-map.json` for the authoritative mapping.
