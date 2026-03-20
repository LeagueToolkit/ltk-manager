---
title: "Simulation Report: {Feature Name}"
type: simulate
version: "1.0"
created: "{Date}"
updated: "{Date}"
feature: "{feature-name}"
---

# Simulation Report: {Feature Name}

## Summary

- **Feature:** {feature-name}
- **Tasks Simulated:** {count}
- **Files Affected:** {count}
- **Risk Level:** {Low/Medium/High}

## Blast Radius

### Files Created

| File   | Task    | Purpose       |
| ------ | ------- | ------------- |
| {path} | T-{NNN} | {description} |

### Files Modified

| File   | Task    | Change Description | Risk              |
| ------ | ------- | ------------------ | ----------------- |
| {path} | T-{NNN} | {description}      | {Low/Medium/High} |

### Files Deleted

| File   | Task    | Reason        |
| ------ | ------- | ------------- |
| {path} | T-{NNN} | {description} |

## Dependency Impact

### Upstream Dependencies

<!-- Features or components this implementation depends on -->

| Dependency   | Status              | Risk if Unavailable |
| ------------ | ------------------- | ------------------- |
| {dependency} | {Available/Pending} | {description}       |

### Downstream Impact

<!-- Features or components that depend on files being modified -->

| Component   | Affected Files | Impact        |
| ----------- | -------------- | ------------- |
| {component} | {files}        | {description} |

## Risk Assessment

| Risk   | Likelihood        | Impact            | Mitigation |
| ------ | ----------------- | ----------------- | ---------- |
| {risk} | {Low/Medium/High} | {Low/Medium/High} | {strategy} |

## Constitutional Compliance

- [ ] All changes within constitutional tech stack
- [ ] No forbidden dependencies introduced
- [ ] Naming conventions followed
- [ ] Git strategy compliance

## Recommendation

{Proceed / Proceed with caution / Delay until {condition}}

## Next Steps

- Run `/genesis-implement {feature-name}` to begin implementation
