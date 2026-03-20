---
title: "System Design: {System Name}"
type: design
category: system
created: "{Date}"
updated: "{Date}"
status: Draft
---

## 1. Purpose

<!-- GUIDANCE: What does this system/subsystem do? Why does it exist as a separate concern? -->

{System purpose and scope}

## 2. Responsibilities

<!-- GUIDANCE: Clear list of what this system IS responsible for and what it IS NOT. -->

### This system handles:

- {Responsibility 1}
- {Responsibility 2}

### This system does NOT handle:

- {Non-responsibility 1} (handled by {other system})

## 3. Interfaces

<!-- GUIDANCE: How other systems interact with this one. Public API, events emitted, events consumed. -->

### Inputs

| Source   | Interface        | Data         | Trigger |
| -------- | ---------------- | ------------ | ------- |
| {system} | {API/event/etc.} | {data shape} | {when}  |

### Outputs

| Destination | Interface        | Data         | Trigger |
| ----------- | ---------------- | ------------ | ------- |
| {system}    | {API/event/etc.} | {data shape} | {when}  |

## 4. Internal Design

<!-- GUIDANCE: How this system works internally. Components, data flow, state management. -->

### Components

{Internal component breakdown}

### Data Flow

{How data moves through the system}

### State Management

{How state is stored and managed}

## 5. Configuration

<!-- GUIDANCE: What is configurable about this system? Environment variables, feature flags, tuning parameters. -->

| Parameter | Type   | Default   | Description        |
| --------- | ------ | --------- | ------------------ |
| {param}   | {type} | {default} | {what it controls} |

## 6. Error Handling

<!-- GUIDANCE: How this system handles failures — internal errors, upstream failures, invalid input. -->

| Scenario   | Detection      | Response             | Recovery           |
| ---------- | -------------- | -------------------- | ------------------ |
| {scenario} | {how detected} | {immediate response} | {recovery process} |

## 7. Monitoring & Observability

<!-- GUIDANCE: What metrics, logs, and alerts exist for this system? -->

### Key Metrics

- {Metric}: {What it measures, alert thresholds}

### Logging

- {What is logged and at what level}

### Alerts

- {Alert condition}: {Response procedure}

## 8. Security

<!-- GUIDANCE: Security considerations specific to this system. -->

- {Security concern}: {Mitigation}

## 9. Performance Characteristics

<!-- GUIDANCE: Expected load, response times, resource usage, bottlenecks. -->

- **Throughput:** {expected requests/events per second}
- **Latency:** {expected response time}
- **Resource Usage:** {CPU, memory, storage expectations}
- **Bottlenecks:** {known or potential bottlenecks}

## 10. Design Decisions

| Decision   | Rationale | Alternatives Rejected      |
| ---------- | --------- | -------------------------- |
| {decision} | {why}     | {what else was considered} |
