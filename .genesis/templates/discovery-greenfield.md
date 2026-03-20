---
title: "Greenfield Discovery Guide"
type: discovery
mode: greenfield
---

<!-- GUIDANCE: Use this as a conversation guide, not a form. Adapt to the user's responses — skip irrelevant areas, probe deeper on vague answers. -->

## 1. Project Identity

- What is the name of this project?
- In one or two sentences, what does it do?
- What problem does it solve?
- Who are the target users? (Be specific — "developers" is too broad, "backend developers building REST APIs" is better)
- What makes this different from existing solutions?

## 2. Scope & Features

- What are the essential capabilities for the first version (MVP)?
- What features are explicitly OUT of scope for now?
- Are there phases planned after MVP? What do they include?
- What is the single most important thing the system must do well?

## 3. Constraints

- Is there a timeline or deadline?
- What is the team size and composition? (Solo developer? Team of 5? Distributed?)
- Are there budget constraints affecting technology choices?
- Are there compliance or regulatory requirements? (GDPR, HIPAA, SOC2, etc.)
- Are there organizational constraints? (Must use certain vendors, can't use certain tools)

## 4. Technology Preferences

- **Languages:** Do you have a preferred language? Any languages to avoid?
- **Frontend:** Framework preference? (React, Vue, Svelte, Next.js, etc.)
- **Backend:** Framework preference? (Express, Fastify, Django, Rails, etc.)
- **Database:** Relational, document, graph? Specific preference?
- **Infrastructure:** Cloud provider? Self-hosted? Serverless?
- **Deployment:** Container-based? Platform-as-a-service? Static hosting?

## 5. Organizational Standards

- **Code Style:** Any existing preferences? (Prettier, ESLint configs, etc.)
- **Documentation:** How much documentation is expected? Where should it live?
- **Version Control:** Branching model preference? Commit message format?
- **CI/CD:** Any existing pipeline preferences? (GitHub Actions, CircleCI, etc.)
- **Package Management:** npm, pnpm, yarn? Any preference?

## 6. Integration Points

- What external APIs or services will this system connect to?
- What data sources does it need access to?
- Are there authentication providers to integrate with? (OAuth, SAML, etc.)
- Will this system provide APIs for other systems?

## 7. Quality Expectations

- **Performance:** Any specific response time or throughput targets?
- **Testing:** What's the testing philosophy? (TDD, comprehensive integration tests, etc.)
- **Accessibility:** Are there accessibility requirements? (WCAG level?)
- **Security:** What's the security posture? (Public-facing? Handles sensitive data?)
- **Monitoring:** What needs to be monitored? Any observability requirements?
