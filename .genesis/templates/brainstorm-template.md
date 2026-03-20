---
title: "Brainstorm: {Feature Name}"
type: brainstorm
version: "1.0"
created: "{ISO date}"
updated: "{ISO date}"
feature: "{feature-name}"
mode: "dialogue"
convergence_type: "{explicit | prompted}"
exchange_count: 0
---

# Brainstorm: {Feature Name}

## Session Metadata

- **Feature:** {feature-name}
- **Started:** {ISO timestamp}
- **Ended:** {ISO timestamp}
- **Exchange Count:** {N}
- **Convergence Signal:** {explicit | prompted}
- **Triggered By:** {standalone | --brainstorm on specify | --brainstorm on plan}

## Context Loaded

- Constitution: {fragments loaded}
- Design docs: {docs read}
- Active features: {related features}
- Session log: {recent entries scanned}

## Opening Observations

<!-- AI's opinionated observations about the project state relevant to this topic.
     Each observation should be categorized: Contradiction, Missing Piece, Cost Concern,
     Untested Assumption, or Cross-Feature Dependency. -->

1. **{Category}:** {Observation referencing specific files, features, or decisions}
2. **{Category}:** {Observation}
3. **{Category}:** {Observation}

## Dialogue Record

<!-- Key exchanges captured during the brainstorm dialogue.
     Summarize — do not transcribe verbatim. Focus on decisions, direction shifts,
     and critical insights. Minor clarifications can be omitted. -->

### Exchange {N}: {Topic}

**User:** {Summary of user input}
**Genesis:** {Summary of AI response}
**Outcome:** {Decision, question raised, or direction shift}

## Key Decisions

<!-- Decisions made during the brainstorm, numbered for reference.
     Each decision should be traceable to a dialogue exchange. -->

1. {Decision description} (Exchange {N})
2. {Decision description} (Exchange {N})

## Open Questions

<!-- Questions that remain unresolved after the brainstorm -->

- [ ] {Question}

## Confirmed Direction

<!-- The agreed-upon direction after convergence -->

{Direction summary}

## Scope Boundaries

<!-- What is explicitly IN scope for first iteration and what is DEFERRED -->

**In scope:**

- {Item}

**Deferred:**

- {Item}

## Recommended Next Steps

<!-- What should happen after this brainstorm -->

- Run `/genesis-specify {feature-name}` to formalize this brainstorm into a specification
