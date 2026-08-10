# Generic application definition pipeline

One Ring separates product definition from code generation. A tenant first
defines what must exist; a compatible generator module may then implement one
explicitly approved revision. Adding a future full-stack, mobile, API, or
durable-workflow generator does not require a second discovery system.

## Lifecycle

```text
application profile
  → tool-driven discovery interview
  → versioned structured application definition
      ↔ PRD / requirements
      ↔ visual blueprint
      ↔ pages and states
      ↔ data and workflows
      ↔ security, integrations, runtime agents, and evidence
  → explicit approval of one revision
  → compatible generator module
  → immutable preview and release evidence
  → promotion of the exact verified artifact
```

The profile is durable prompt and policy context. It contains application type,
tenancy, identity model, runtime-agent authority, data sensitivity, execution
placement, and deployment target. It is not merely a creation-form hint.

## Authoritative specification

`BrowserAppSpecification` is currently the persisted application-definition
record for historical compatibility, but its structure is generator-neutral.
Every revision contains:

- narrative requirements;
- personas, goals, pain points, roles, and prioritized user stories;
- independently addressable UI surfaces with routes and complete states;
- domain entities and typed fields;
- end-to-end workflows with browser, data, decision, agent, and approval steps;
- bounded runtime-agent contracts and allowlisted tools;
- external integration contracts and failure behavior;
- confirmed/proposed/rejected decisions with rationale and interview sources;
- measurable quality attributes and a product-level design brief;
- acceptance criteria traced to stable requirement IDs.

The PRD editor and blueprint are projections of this record. Moving a blueprint
node is presentation state; editing its meaning updates the same draft that the
text and specialist editors use. Saving creates a new revision and returns the
approval state to `draft`.

## OneRingAI discovery tools

Discovery agents never receive permission to replace an opaque JSON blob. They
use strict `ToolFunction` contracts with low-risk, always-allowed permission
inside an isolated draft:

- inspect a completeness summary or query a targeted node category;
- upsert one requirement, persona, story, surface, entity, workflow, runtime
  agent, integration, quality attribute, decision, or acceptance criterion;
- set the shared design brief;
- run deterministic reference and completeness validation.

Each mutating tool atomically saves a working-draft snapshot, its change ledger,
and deterministic coverage report. The split-screen interview polls that
durable session, so personas, stories, pages, workflows, data, and the visual
blueprint update during the same agent turn rather than only after it finishes.
A successful run commits the accumulated draft as one immutable specification
revision. Failed or cancelled runs keep the draft recoverable without silently
approving it. The UI shows safe reasoning summaries, tool calls, validation
progress, metrics, errors, and cancellation. Private chain-of-thought and
credentials are never exposed.

## Primary product experience

The default UI deliberately has four small areas:

1. **Applications** — start with name, desired outcome, application type, and
   audience, or reopen an existing application.
2. **Define** — conduct the interview beside live Document and Blueprint
   projections; confirm only after contradictions are resolved.
3. **Build** — use a sensible specialist team by default while retaining
   connector, model, and effort controls under an advanced disclosure.
4. **Preview** — review the actual isolated application and publish the exact
   verified artifact.

Tenancy, members, domains, visual design, architecture, and release evidence
remain accessible in **Settings**. They are not prerequisites disguised as a
large creation form.

## Generator registry

The registry exposes manifests with stable ID, version, supported application
types, availability, description, and capabilities. Today `browser-data` is
available. Full-stack/API, mobile, and workflow-automation manifests are
visible as planned modules; their applications can still complete and approve
the generic definition without invoking an incompatible compiler.

Generation requires all of the following:

1. the current specification revision is approved;
2. the application's selected generator supports its profile;
3. the generator module is available;
4. the selected OneRingAI specialists, connectors, models, and effort levels
   pass server validation.

The browser-data generator then performs deterministic contract compilation,
optional specialist proposals, immutable Mongo graph publication, admission
checks, signed preview creation, and exact-artifact promotion as described in
`BROWSER_NATIVE_APP_GENERATION.md`.
