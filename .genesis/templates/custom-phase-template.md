---
title: "Custom Phase: {Phase Name}"
type: phase
created: "{Date}"
updated: "{Date}"
---

## Description

<!-- GUIDANCE: What does this phase do? What value does it provide? -->

{Phase description}

## When to Run

<!-- GUIDANCE: Define when this phase should be executed. -->

- **Trigger:** {After which standard phase | On schedule | On demand}
- **Frequency:** {Once per feature | Periodic | As needed}
- **Prerequisites:** {What must be true before running this phase}

## Inputs

<!-- GUIDANCE: What artifacts or files does this phase read? -->

- {Input 1}: {What it provides}
- {Input 2}: {What it provides}

## Process

<!-- GUIDANCE: Step-by-step instructions for what this phase does. Write these as instructions to Claude Code. -->

1. {Step 1}
2. {Step 2}
3. {Step 3}

## Output

<!-- GUIDANCE: What artifact(s) does this phase produce? -->

- **Produces:** {File path or artifact description}
- **Updates:** {What existing files are modified}

## Gate

<!-- GUIDANCE: What must be true for this phase to be considered complete? -->

- [ ] {Completion criterion 1}
- [ ] {Completion criterion 2}

## Notes

<!-- GUIDANCE: Any additional context, examples, or warnings. -->

{Additional notes}
