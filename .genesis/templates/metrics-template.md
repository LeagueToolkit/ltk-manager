---
title: "Metrics Dashboard: {Date}"
type: metrics
version: "1.0"
created: "{Date}"
updated: "{Date}"
---

# Project Metrics Dashboard

**Generated:** {Date}

## Pipeline Health

| Metric               | Value | Trend            |
| -------------------- | ----- | ---------------- |
| Features in progress | {N}   | {up/down/stable} |
| Features completed   | {N}   |                  |
| Features blocked     | {N}   |                  |
| Overall completion   | {N}%  |                  |

## Task Velocity

| Period       | Tasks Completed | Tasks Created | Net    |
| ------------ | --------------- | ------------- | ------ |
| This session | {N}             | {N}           | {+/-N} |
| This week    | {N}             | {N}           | {+/-N} |
| All time     | {N}             | {N}           | {+/-N} |

## Feature Progress

| Feature | Phase   | Tasks   | Done   | Blocked   | Progress |
| ------- | ------- | ------- | ------ | --------- | -------- |
| {name}  | {phase} | {total} | {done} | {blocked} | {N}%     |

## Artifact Health

| Metric                      | Count |
| --------------------------- | ----- |
| Specs (Approved)            | {N}   |
| Specs (Draft)               | {N}   |
| Plans (Approved)            | {N}   |
| NEEDS_CLARIFICATION markers | {N}   |
| Blocked tasks               | {N}   |

## Constitution Compliance

| Check                 | Status            |
| --------------------- | ----------------- |
| Tech stack violations | {N found / Clean} |
| Naming violations     | {N found / Clean} |
| Unregistered hooks    | {N found / Clean} |

## Cost Tracking

| Metric                  | Value                                          |
| ----------------------- | ---------------------------------------------- |
| Total sessions          | {N}                                            |
| Estimated token usage   | {N}                                            |
| Model tier distribution | Architect: {N}%, Analyst: {N}%, Operator: {N}% |

## Recommendations

<!-- AI-generated recommendations based on metrics -->

{Recommendations}
