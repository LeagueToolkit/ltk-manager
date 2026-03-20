---
title: "Polish Report: {Feature Name}"
type: polish
version: "1.0"
created: "{Date}"
updated: "{Date}"
feature: "{feature-name}"
round: 1
---

# Polish Report: {Feature Name}

## Summary

- **Feature:** {feature-name}
- **Round:** {N}
- **Issues Found:** {count}
- **Issues Fixed:** {count}
- **Issues Deferred:** {count}

## Scan Results

### Critical Issues

<!-- Security issues, compilation warnings, broken edge cases -->

| ID     | File   | Description   | Status           |
| ------ | ------ | ------------- | ---------------- |
| PL-001 | {path} | {description} | {Fixed/Deferred} |

### Minor Issues

<!-- TODO comments, style inconsistencies, missing error handling -->

| ID       | File   | Description   | Status           |
| -------- | ------ | ------------- | ---------------- |
| PL-{NNN} | {path} | {description} | {Fixed/Deferred} |

### Cosmetic Issues

<!-- Formatting, documentation, naming improvements -->

| ID       | File   | Description   | Status           |
| -------- | ------ | ------------- | ---------------- |
| PL-{NNN} | {path} | {description} | {Fixed/Deferred} |

## Deferred Items

<!-- Issues intentionally left for future work, with justification -->

| ID       | Reason         |
| -------- | -------------- |
| PL-{NNN} | {why deferred} |

## Constitution Compliance

- [ ] All naming conventions followed
- [ ] No forbidden dependencies introduced
- [ ] Markdown-first principle maintained
- [ ] Audit trail preserved

## Next Steps

- Run `/genesis-review {feature-name}` to validate the implementation
