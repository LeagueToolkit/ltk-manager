---
title: "Cascade Report: {Feature Name}"
type: cascade
version: "1.0"
created: "{Date}"
updated: "{Date}"
feature: "{feature-name}"
trigger: "{artifact changed}"
---

# Cascade Report: {Feature Name}

## Trigger

- **Changed Artifact:** {spec.md / plan.md / constitution section}
- **Change Summary:** {what changed}
- **Changed By:** {user / genesis command}

## Impact Analysis

### Direct Dependencies

<!-- Artifacts that directly reference the changed artifact -->

| Artifact | Section   | Impact        | Action Required      |
| -------- | --------- | ------------- | -------------------- |
| {path}   | {section} | {description} | {Update/Review/None} |

### Transitive Dependencies

<!-- Artifacts affected through indirect dependency chains -->

| Artifact | Chain       | Impact        | Action Required      |
| -------- | ----------- | ------------- | -------------------- |
| {path}   | {A → B → C} | {description} | {Update/Review/None} |

## Required Updates

### Automatic Updates

<!-- Changes that can be applied automatically -->

| Artifact | Change        | Status            |
| -------- | ------------- | ----------------- |
| {path}   | {description} | {Applied/Pending} |

### Manual Review Required

<!-- Changes that need human judgment -->

| Artifact | Question            | Recommendation       |
| -------- | ------------------- | -------------------- |
| {path}   | {what needs review} | {suggested approach} |

## Consistency Check

- [ ] All FRs in spec still covered by plan tasks
- [ ] All ACs still verifiable
- [ ] No orphaned task references
- [ ] Constitution compliance maintained

## Next Steps

- Run `/genesis-analyze {feature-name}` to verify cross-artifact consistency
