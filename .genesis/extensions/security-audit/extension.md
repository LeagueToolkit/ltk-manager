---
title: "Extension: Security Audit"
type: extension
created: "2026-03-10"
updated: "2026-03-10"
---

## Hooks

| Hook         | Action                                                    |
| ------------ | --------------------------------------------------------- |
| after_review | Scan implemented code for common security vulnerabilities |

## Configuration

| Setting            | Default | Description                                          |
| ------------------ | ------- | ---------------------------------------------------- |
| severity_threshold | warning | Minimum severity to report (info, warning, critical) |

## Instructions

### after_review

After a `/genesis-review` completes, scan all files created or modified during the feature implementation for the following security concerns:

#### 1. Hardcoded Secrets and Credentials

Scan for patterns that suggest hardcoded secrets:

- String literals matching: API keys, tokens, passwords, connection strings
- Common variable names: `password`, `secret`, `api_key`, `token`, `credential`, `private_key`
- Base64-encoded strings longer than 40 characters in assignment context
- URLs containing embedded credentials (`://user:pass@`)

**Action:** Flag each occurrence with file path, line number, and recommendation to use environment variables or a secrets manager.

#### 2. Injection Vulnerabilities

Scan for patterns suggesting injection risk:

- **SQL Injection:** String concatenation or template literals used to build SQL queries instead of parameterized queries
- **XSS:** Unsanitized user input rendered in HTML (look for `innerHTML`, `@html`, `dangerouslySetInnerHTML`, unescaped template interpolation in HTML context)
- **Command Injection:** User input passed to `exec`, `execSync`, `spawn`, or shell commands without validation
- **Path Traversal:** User input used in file paths without sanitization (`../` sequences)

**Action:** Flag each pattern with the injection type, file path, line number, and recommended fix (parameterized queries, sanitization, allowlist validation).

#### 3. Unvalidated Input

Scan for input handling gaps:

- HTTP request handlers that use `req.body`, `req.params`, or `req.query` without validation
- Rust handlers that deserialize request bodies without type validation
- Form inputs processed without length or format constraints
- Missing CSRF protection on state-changing endpoints

**Action:** Flag unvalidated inputs with the endpoint, input source, and recommendation.

#### 4. Exposed Internal Error Details

Scan for error handling that leaks internals:

- Stack traces returned in HTTP responses
- Database error messages exposed to clients
- Internal file paths in error responses
- Debug/verbose logging left enabled in production code paths

**Action:** Flag each exposure with recommendation to use generic user-facing error messages.

### Output Format

```markdown
## Security Audit Results

**Files scanned:** {count}
**Findings:** {count} ({critical} critical, {warning} warnings, {info} info)

### Critical

| #   | Type   | File   | Line   | Description   |
| --- | ------ | ------ | ------ | ------------- |
| 1   | {type} | {path} | {line} | {description} |

### Warnings

| #   | Type | File | Line | Description |
| --- | ---- | ---- | ---- | ----------- |

### Info

| #   | Type | File | Line | Description |
| --- | ---- | ---- | ---- | ----------- |

### Recommendations

- {Prioritized list of remediation actions}
```

If no findings: "Security audit passed — no vulnerabilities detected."

## Requirements

- Feature must have a tasks.md with file paths listed
- Files must exist on disk (post-implementation)
- Constitution security fragment (if exists) informs what standards apply

## Changelog

| Version | Date       | Changes         |
| ------- | ---------- | --------------- |
| 1.0.0   | 2026-03-10 | Initial release |
