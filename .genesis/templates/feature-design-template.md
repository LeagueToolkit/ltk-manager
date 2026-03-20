---
title: "Feature Design: {Feature Name}"
type: design
category: feature
created: "{Date}"
updated: "{Date}"
status: Draft
---

## 1. Overview

<!-- GUIDANCE: What is this feature? What does it enable users to do? Why does it exist? -->

{Feature description — the definitive reference for how this feature works.}

## 2. Business Rules

<!-- GUIDANCE: The rules that govern this feature's behavior. These are facts about the domain, not implementation details. -->

1. {Rule}: {Explanation}
2. {Rule}: {Explanation}

## 3. User Experience

<!-- GUIDANCE: How users interact with this feature. What they see, what they do, what they expect. -->

### Entry Points

- {How users access this feature}

### Core Flow

1. {Step 1: What the user does}
2. {Step 2: What happens}
3. {Step 3: What the user sees}

### Feedback & States

- **Loading:** {What the user sees while waiting}
- **Success:** {What indicates success}
- **Error:** {How errors are communicated}
- **Empty State:** {What shows when there's no data}

## 4. Edge Cases

<!-- GUIDANCE: What happens in unusual situations? Document every edge case you can think of. -->

| Scenario    | Expected Behavior    |
| ----------- | -------------------- |
| {Edge case} | {What should happen} |

## 5. Error Handling

<!-- GUIDANCE: What can go wrong and how should the system respond? -->

| Error Condition | User Impact      | System Response    |
| --------------- | ---------------- | ------------------ |
| {Error}         | {What user sees} | {What system does} |

## 6. Data Requirements

<!-- GUIDANCE: What data does this feature need, produce, or modify? Reference data-model.md for full schema. -->

- **Reads:** {What data this feature consumes}
- **Writes:** {What data this feature creates or modifies}
- **Deletes:** {What data this feature may remove}

## 7. Security Considerations

<!-- GUIDANCE: Authentication, authorization, data exposure, and abuse scenarios for this feature. -->

- {Security consideration}: {How it's addressed}

## 8. Performance Considerations

<!-- GUIDANCE: Expected load, response time requirements, caching needs. -->

- {Performance consideration}: {Target or approach}

## 9. Design Decisions

<!-- GUIDANCE: Document WHY specific design choices were made. This is the institutional memory. -->

| Decision   | Options Considered | Chosen   | Rationale |
| ---------- | ------------------ | -------- | --------- |
| {Decision} | {Options}          | {Choice} | {Why}     |

## 10. Future Considerations

<!-- GUIDANCE: Known enhancements or extensions planned for later. Documenting these prevents reinventing the wheel. -->

- {Future enhancement}: {Brief description and when it might be relevant}
