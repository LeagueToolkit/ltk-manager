---
title: "Technical Specification: {Title}"
type: design
category: technical-spec
created: "{Date}"
updated: "{Date}"
status: Draft
---

<!-- IF: Architecture -->

## Architecture

### System Components

<!-- GUIDANCE: List every major component, its responsibility, and how it communicates with other components. -->

| Component   | Responsibility | Technology | Communicates With  |
| ----------- | -------------- | ---------- | ------------------ |
| {Component} | {What it does} | {Tech}     | {Other components} |

### Component Interactions

<!-- GUIDANCE: Describe the communication patterns between components. Include protocols, data formats, sync vs async. -->

{Interaction descriptions}

### Deployment Topology

<!-- GUIDANCE: How components are deployed — servers, containers, serverless, CDN, etc. -->

{Deployment description}

### Scaling Strategy

<!-- GUIDANCE: How each component scales — horizontal, vertical, auto-scaling triggers. -->

{Scaling approach}

<!-- ENDIF -->

<!-- IF: Data Model -->

## Data Model

### Entities

<!-- GUIDANCE: Define every entity, its fields, types, constraints, and relationships. -->

#### {Entity Name}

| Field   | Type   | Constraints   | Description   |
| ------- | ------ | ------------- | ------------- |
| {field} | {type} | {constraints} | {description} |

**Relationships:**

- {relationship description}

**Indexes:**

- {index description and rationale}

### Migration Strategy

<!-- GUIDANCE: How schema changes are managed — migration tools, rollback approach, zero-downtime requirements. -->

{Migration approach}

<!-- ENDIF -->

<!-- IF: API Contracts -->

## API Contracts

### Conventions

- **Base URL:** {base URL pattern}
- **Authentication:** {auth mechanism}
- **Versioning:** {versioning strategy}
- **Error Format:** {standard error response shape}

### Endpoints

#### {Method} {Path}

- **Description:** {What this endpoint does}
- **Authentication:** {Required|Optional|None}
- **Authorization:** {Required role/permission}

**Request:**

```json
{request shape}
```

**Response (Success):**

```json
{response shape}
```

**Response (Error):**

```json
{error shape}
```

**Status Codes:**
| Code | Meaning |
|------|---------|
| {code} | {meaning} |

<!-- ENDIF -->

<!-- IF: Integrations -->

## External Integrations

### {Integration Name}

- **System:** {External system name}
- **Protocol:** {REST, GraphQL, gRPC, webhook, etc.}
- **Authentication:** {How we authenticate with this system}
- **Data Flow:** {Direction — inbound, outbound, bidirectional}

#### Endpoints Used

| Endpoint   | Purpose   | Rate Limit |
| ---------- | --------- | ---------- |
| {endpoint} | {purpose} | {limit}    |

#### Failure Handling

- **Timeout:** {timeout value and behavior}
- **Retry:** {retry strategy}
- **Circuit Breaker:** {if applicable}
- **Fallback:** {degraded behavior when integration is down}

#### Data Mapping

| Our Field | External Field | Transform               |
| --------- | -------------- | ----------------------- |
| {field}   | {field}        | {transformation if any} |

<!-- ENDIF -->
