# One Ring Platform — Design Document

> **Status:** Draft v0.5 · **Date:** 2026-07-23 · **Owner:** Anton (anton@everworker.ai)
> Working title. This is a living design doc; see the Decision Log (§17) and Open Questions (§18).

---

## 1. Executive summary

We are building an **opinionated Platform-as-a-Service for heavily agentic / GenAI applications** with two first-class development surfaces and two runtime profiles. Developers can build locally — assisted by plugins we ship into **Claude Code** and **OpenAI Codex** — while non-developers can have **oneringai builder agents develop the entire app in a hosted workspace**, without installing or running local development tools. Either surface can produce a full NestJS + React application or a lower-cost **browser-native data app** whose application code is a static React SPA backed by the platform's secure data, identity, authorization, and oneringai connector gateways. All paths converge on the same server-owned validation, build, preview, and promotion pipeline.

The **initial launch is deliberately browser-native only**. We will make that complete, secure, customizable, and production-operable before resuming hosted full-stack or local Codex/Claude development modes. Those later modes remain architectural targets, not launch-scope distractions.

We also make the platform **accessible to non-coders** through an **AI app-generation pipeline** (interview → spec → hosted development → verified preview) that emits the same real codebase a developer would work on — not a locked low-code black box. Within the managed/certified capability tier, the platform can make bounded, testable production-readiness guarantees.

The product sits in a deliberate **middle ground**:

- **Generic deploy-anything PaaS** (Vercel, Railway, Render, Fly) — flexible, but "any shitty code gets deployed" and there is **no enterprise layer**.
- **Narrow agent/workflow platforms** (LangGraph Platform, our own current everworker) — enterprise-ready, but they can only run standalone agents/workflows, **not full custom apps with UI + business logic**.

**Central thesis: opinionation is the mechanism, not the compromise.** The *only* way to make enterprise governance "free and automatic" is to own an opinionated framework + base image so the platform can inject cross-cutting features at known seams. The same opinionation is *also* what makes reliable, largely-unattended AI code generation possible (fewer degrees of freedom = fewer ways to be wrong). The one-click deploy button is being commoditized industry-wide; **the defensible moat is the governance injection + reliable generation**, which generic PaaS lack and narrow agent platforms cannot apply to full apps.

We have substantial reusable assets across three existing codebases (`oneringai`, `icos`, `everworker`). This project connects them and builds the missing product systems: a hosted development plane, source/release service, runtime substrate for user-authored full apps, golden base image, hermetic build/deploy pipeline, and app-generation pipeline. Reuse must be validated component-by-component rather than treated as a delivery percentage.

---

## 2. Market positioning & target customer

### 2.1 The whitespace
Nobody today combines **(a)** an opinionated full-stack framework, **(b)** agent-native runtime, and **(c)** turnkey enterprise governance for **general full-stack custom apps**:
- **Encore.dev** proves "opinionated framework → auto-infra" works, but isn't agent-native and lacks turnkey RBAC/multitenancy.
- **Superblocks/Clark** proves "governance injected at generation time" *sells* — but only for internal tools.
- **LangGraph Platform** proves enterprise agent-runtime demand — but can't deploy a custom-UI app.

### 2.2 Beachhead ICP
**B2B AI-native startups / scaleups building multi-tenant agentic SaaS for enterprise buyers.**

This is the intersection where all our assets are load-bearing and friction is lowest:
- The **only** profile that needs the agentic engine **+ multitenancy + governance** simultaneously.
- **Low opinionation resistance** (greenfield, small teams that want one blessed way) — the PLG / "build-in-Claude-Code, one-click-deploy" motion fits naturally.
- **Governance is a real buy-reason here** because *their* customers (enterprises) demand SSO/audit/data-residency. We sell "punch above your weight upmarket."

The non-coder generation path additionally opens **domain experts / operators** inside those companies (and non-technical founders) as builders — expanding the top of the funnel without weakening the enterprise story, because the output is still production code on our governed stack.

### 2.3 Expansion path
Land ICP → expand into **enterprise dev/platform teams** as those accounts grow into enterprise deals and as we earn our own compliance posture (SOC 2, etc.). **Avoid** leading cold into enterprise (hyperscaler wall: AWS AgentCore / Azure Foundry / Google Gemini Enterprise; and we'd need our own SOC 2 first) or into internal-tools (head-to-head with Superblocks/Microsoft, wastes our multitenancy).

### 2.4 Strategic risks to plan around
1. Vercel/Cloudflare extending "AI Cloud" into the full bundle.
2. Hyperscaler agent-governance services annexing the enterprise layer from above.
3. "Assemble WorkOS + Clerk + Langfuse yourself" as a DIY alternative — countered by the fact that *maintaining* those integrations across multitenancy boundaries is exactly the toil our opinionated framework absorbs.

**Tailwind:** TypeScript became the #1 language on GitHub in 2025, explicitly attributed to AI-assisted coding — a direct validation of a TS-first, AI-codegen-first bet.

---

## 3. Goals & non-goals

### Goals
- Hosted, end-to-end AI development of a **full app** (custom UI + business logic + agents) by oneringai builder agents, requiring no local Codex/Claude Code environment.
- One-click deploy of the same kind of full app developed locally with Claude Code / Codex.
- One server-authoritative validation/build/release pipeline shared by both development paths.
- A browser-native data-app profile for lower-cost applications: React application logic in the browser, with platform-enforced data, identity, authorization, audit, and connector execution.
- Route one immutable browser-native release under a platform path, a platform-provided hostname, or a verified customer domain without rebuilding it.
- Enterprise features **injected automatically** — the app author writes none of the plumbing.
- **Opinionated, real code** in one blessed stack; developers write normal TypeScript, not a low-code DSL.
- **Accessible to non-coders** via an AI generation pipeline (interview → spec → hosted development → verified preview), while emitting real code and supporting production-scale apps within declared capability tiers.
- Hostile-workload isolation between the platform, development workspaces, and deployed apps; enforceable end-tenant isolation for the managed/certified data path.
- Reuse the existing investment (`oneringai`, `ever-tenant`, `iam`/XIAM, `ever-config`, `ever-telemetry`, portable icos domain logic/UI patterns, the everworker deploy prototype) without carrying Meteor into the new product runtime.

### Non-goals (for v1)
- Deploying arbitrary frameworks/languages (we are opinionated on purpose).
- A locked low-code/no-code black box — generated output is **real, editable code** on the blessed stack, not a proprietary runtime.
- Being a generic compute/GPU cloud (we compose managed substrates).
- Public marketing-site hosting / SSR-heavy apps (addable later; see §5.6).
- Our own foundation models (we are model-agnostic via oneringai).

---

## 4. Key concepts & terminology

- **Control plane** — what *we* operate: dashboard, builder-agent studio, tenant/user management, deploy orchestration, billing, and observability UI. Built on **NestJS + React**; selected icos logic and React UI patterns are ported rather than reusing its Meteor runtime.
- **Development plane** — hosted, isolated workspaces in which oneringai builder agents edit source, run commands and tests, and produce previewable commits. This is separate from both the control plane and the production user-app plane.
- **User-app plane** — what *customers* build and deploy: their app, running on the blessed stack, isolated per tenant.
- **Blessed app stack** — the single opinionated stack apps are written in: **NestJS (backend + agent runtime) + React/Vite (SPA UI)**, with **oneringai** as the agent engine.
- **Runtime profile** — an app-level choice independent of development surface: `full_stack` (NestJS + React + oneringai runtime) or `browser_data` (static React plus shared platform gateways). It is versioned in the spec and manifest.
- **Browser-native data app** — an app with no customer-authored server process. UX, navigation, calculations, and orchestration run in React; trusted validation, CRUD authorization, identity, secrets, audit, quotas, and connector execution remain server-side platform services.
- **Route binding** — a versioned mapping from a hostname and optional path prefix to an app environment and its active immutable release. A release can have multiple bindings and exactly one canonical binding.
- **Golden base image** — the platform-owned OCI image containing the runtime + governance packages + OTel + agent runtime pre-wired. App source is layered on top at build time. *This is the leverage point that makes enterprise features free.*
- **Governance injection** — auto-provision of tenancy, RBAC, audit, tracing, logging, secrets at framework seams (DI, guards, interceptors) — not written by the app author.
- **Managed mode** — the hosted/non-coder mode in which the durable, versioned spec is authoritative and code is derived from it. Changes go through the spec and builder agents.
- **Code mode** — the developer mode in which a Git commit is authoritative. The spec remains useful as requirements and executable acceptance criteria, but developers may edit any source file directly.
- **Hosted workspace** — an ephemeral, per-active-development-run sandbox containing a checkout of the app repository and tool processes. It is not a permanent container per user; durable state lives in Git, the spec store, and build artifacts.
- **Release artifact** — an immutable, signed application image plus provenance: source commit, spec/generator version when applicable, platform SDK version, base-image digest, policy-pack version, SBOM, and verification evidence.
- **Spec** — the durable, versioned, structured artifact (entities, roles/tenancy, user stories + acceptance criteria, screen inventory) from which managed-mode app code is generated.
- **App generation pipeline** — the non-coder path: interview → data model → hosted builder workspace → verify → preview → promote, all derived from the spec (see §6).
- **Escape hatch** — explicit ejection from spec-authoritative managed mode to Git-authoritative code mode. Designated extension modules can delay ejection but do not create a bidirectional source-of-truth promise.
- **3-layer opinionation enforcement** — how we get flexibility without "shitty code gets deployed":
  1. **Framework + platform SDK** (the conventions apps are built from)
  2. **Hosted builder-agent policy pack or Claude Code / Codex plugin** (guides what the AI generates)
  3. **Server-side validation/admission controls** (authoritatively reject non-conforming source and artifacts)
  everworker's `ai-builder` prototypes important pieces of layer 2 and the versioned contract, but authoritative server validation/admission remains new work.

---

## 5. The blessed app stack

### 5.1 Decision: NestJS + React (Vite SPA)
**Backend:** NestJS. **Frontend:** React SPA built with Vite. **Agent engine:** oneringai (embedded).

Rationale:
- **NestJS gives container-grade dependency injection + guards + interceptors** — the exact seams the platform needs to inject tenant scoping, RBAC, tracing, and cost metering per request *without trusting app-author discipline*.
- **Crisp client/server boundary** (React = browser only, NestJS = server only) removes the "where does this code run?" ambiguity of Next.js RSC/server-actions — better for humans and for AI codegen.
- **NestJS is healthy and actively developed** (v11.1.28, Jul 2026; ~11.5M weekly npm downloads; ~76k GitHub stars; weekly releases; company-backed by Trilon) with a large training corpus → Claude/Codex write it reliably.
- **Persistent process** → supports long-running agent loops, background jobs (`@Cron`, BullMQ), WebSocket gateways, and durable execution — all things Next.js/serverless handles poorly.

### 5.2 Why not Meteor anywhere in the new product (despite our history with it)
The new control plane, development plane APIs, and generated applications all use **NestJS + React**. icos remains a valuable reference implementation and source of portable TypeScript/domain logic, React components, UX patterns, schemas, tests, and governance packages, but its Meteor runtime is not carried forward:
- **No DI/interceptor container** — the exact seam injection depends on; icos had to monkey-patch `findOneAsync`/`upsertAsync` to enforce tenant scoping. Fragile.
- **AI-codegen fluency is low** (small corpus + "magic" conventions) — disqualifying for a product whose entire premise is "build with Claude Code / Codex" *and* "generate apps with AI."
- Server-stateful DDP requires sticky sessions — an operational constraint when running many autoscaled tenant apps.
- A single platform stack reduces duplicated auth, testing, deployment, observability, hiring, and agent-generation conventions.
- *Note: DDP-over-WebSocket streams fine; streaming is not the reason for removing Meteor.*

### 5.3 Data model — the Meteor "data-driven" DX, done better
We liked Meteor's model: define a datamodel in TS → 1:1 collection mapping → thin business-logic layer. NestJS + `@nestjs/mongoose` reproduces this **and** adds the DI seam:

```ts
@Schema() class Invoice {                 // 1:1 with the 'invoices' collection
  @Prop() amount: number
  @Prop() tenantId: string
}
@Injectable() class InvoiceService {      // business-logic layer, on top
  constructor(@InjectModel(Invoice.name) private m: Model<Invoice>) {}
  create(dto) { return this.m.create(dto) } // tenantId/RBAC/audit auto-injected via plugin/interceptor
}
```

This is strictly better than Meteor's global collections + patched hooks: typed, validated, migration-friendly, and the platform stamps governance onto every model op through DI. It is also the ideal generation target — a data model in the spec maps 1:1 to a `@Schema()` class.

### 5.4 Reactive data layer — a platform-provided convention
Meteor's automatic pub/sub reactivity is the one thing NestJS doesn't give for free. We make it a **platform SDK feature** so every deployed app inherits it:
- **Default:** query/request invalidation through the client data SDK; predictable and horizontally scalable for most screens.
- **Opt-in live collections:** MongoDB change streams → one logical app event relay with resume/backpressure/deduplication → WebSocket gateway/client store. Web instances do not each watch the whole database.
- Alternatives considered: a sync engine (Zero / ElectricSQL / Convex-style) as a future upgrade.
- **Outcome:** apps that need the Meteor-style DX get reactive collections plus governance without making database-wide watchers a default cost for every app.

### 5.5 Streaming
LLM token streaming via **Vercel AI SDK client hooks (`useChat`/`useCompletion`) ↔ NestJS `@Sse()` endpoints**. The AI SDK client is backend-agnostic, so we keep best-in-class streaming DX without Next.js.

### 5.6 Adding Next.js / SSR later (no lock-in)
Marketing/public/SSR pages are a **separate deployable** that talks to the same NestJS API. Add **Astro** (best for pure content/marketing, ~zero JS, great SEO) or **Next.js** whenever needed, at `domain.com` with the app at `app.domain.com`. The backend contract is frontend-independent, so this is a future decision, not a v1 commitment.

### 5.7 Agent runtime — oneringai
oneringai is the embedded agent engine (connector-first auth, permissions, multi-vendor LLM, tools, MCP, memory, orchestration). For v1 it is **bundled per-app** (simplest, most isolated). A **shared agent-runtime service** (relying on oneringai's `ScopedConnectorRegistry` / `StorageContext` for isolation) is a Phase-2 efficiency optimization.

oneringai productization needed to be the "standard engine" (tracked as work, see §18): first-class OTel/tracing exports, enforced-by-default multitenancy, a frozen/versioned API façade over its ~300 exports, and public docs.

---

## 6. Dual-path app development

The platform exposes two development surfaces, but they are inputs to one product rather than separate products. Both emit blessed-stack source into a canonical Git repository and enter the same server-authoritative validation, build, preview, and release pipeline.

### 6.1 The two development surfaces
- **Hosted managed mode:** the user describes and refines the app in the control plane. oneringai builder agents work in an isolated hosted workspace; the user never needs local Codex, Claude Code, Node, Docker, or Git. The spec is authoritative.
- **Local code mode:** the developer writes/extends real NestJS + React locally via Claude Code, Codex, or by hand. Plugins distribute our guidance and provide fast feedback, while a platform CLI/API pushes a Git commit for authoritative server validation. Git is authoritative.
- **Same deployment contract:** both paths produce real code plus a platform manifest and verification evidence. Neither path can bypass server-side policy or create a production release directly.

Development surface and runtime profile are orthogonal. Hosted managed mode and local code mode can each target either `full_stack` or `browser_data`; choosing the lightweight runtime must never create a separate, lower-quality requirements process.

### 6.2 Converged architecture

```
Hosted: user intent → spec → oneringai builder agents → isolated workspace ┐
                                                                         ├─► canonical Git commit + app manifest
Local:  Codex / Claude Code / human → local checkout → platform CLI ─────┘

commit → server policy/tests/scans → hermetic build → signed immutable release
       → preview → user/policy approval → promote the same artifact to production
```

Codex/Claude plugins and hosted builder-agent instructions are **development adapters**. The server source gateway and release service are the trust boundary.

### 6.3 Hosted development plane

Hosted development requires isolated compute for tool execution, but **not a permanently provisioned container per user**:

1. The control plane creates a versioned **development run** for an app/project.
2. A workspace scheduler allocates a sandbox from a warm pool **per active run** (usually per project/branch, not per user). The first implementation can use a container sandbox for platform-generated, restricted code; untrusted arbitrary code or shell execution uses a gVisor/microVM-grade boundary.
3. A multi-tenant oneringai builder-orchestrator service performs planning and model calls. All filesystem, shell, package, browser, and test tools are capability-scoped and execute inside the assigned workspace.
4. The workspace checks out the canonical repository, applies the platform policy pack, generates/edits code, and runs the verification loop. It has no production credentials, no control-plane credentials, bounded CPU/memory/time, and default-deny or allowlisted network access.
5. Successful changes are committed to a platform-managed branch. Durable state is stored in Git, the spec store, run logs/checkpoints, and artifact storage — never only on the workspace filesystem.
6. A preview is built and scheduled through the normal deployment pipeline in a **separate runtime**. Development workspaces are never promoted into production.
7. Idle workspaces are suspended or destroyed; later runs restore by checking out Git and, optionally, attaching a project cache. Concurrency and spend are controlled per account/project.

The economical model is therefore a **shared scheduler + warm sandbox pool + ephemeral per-active-run isolation**. A dedicated always-on development environment is an enterprise option for customers needing fixed egress, very large caches, or stronger isolation—not the default.

### 6.4 Source authority and the escape hatch

- In **managed mode**, the spec is authoritative. Builder agents may generate and refactor code, but user changes enter through the spec or structured feedback. Generated commits remain visible, exportable, and deployable.
- A user may **eject to code mode** by cloning/exporting the repository. From that point Git is authoritative and the spec is retained as requirements/test input; arbitrary edits are allowed within the platform contract.
- v1 does **not** promise lossless bidirectional synchronization from hand-edited code back into the spec. Ejection is one-way unless the user explicitly resets to a generated version.
- Designated extension modules can reduce unnecessary ejection, but they are an optimization rather than the foundation of correctness.

### 6.5 The three principles that make unattended generation trustworthy
1. **Managed-mode intent is durable and versioned.** The interview compiles to a structured spec; code and tests are derived from it. This is how a non-coder maintains an app over years: by maintaining intent, not source implementation details.
2. **A verification loop — not raw generation quality — makes "unattended" credible.** Acceptance criteria compile into executable tests. Generation runs `generate → test → self-heal → retry` and only surfaces a running preview after mandatory platform checks pass.
3. **The human stays in the loop at their own altitude.** The goal is "no developer intervention," not "no human." Non-coders validate user stories, the visualized data model, and the running app. Production promotion remains a user or explicit policy decision.

### 6.6 The managed-mode pipeline — stages, artifacts, and who validates

| # | Stage | Emits (in our stack) | Human checkpoint |
|---|---|---|---|
| 0 | **Seed / frame** | App purpose + reference analogy + primary personas/roles (incl. *their* app's tenancy) | User frames |
| 1 | **Interview → user stories** | Structured spec + visual story map: personas, goals, journeys, stories, exceptions, and acceptance criteria | User validates stories in plain language and diagrams |
| 2 | **Infer data model** | Mongoose schemas projected as a plain-language entity/relationship map | **Always visible; editing optional** — user accepts or corrects |
| 3 | **Refine stories + data model together** | Updated spec (consistent) | User refines |
| 4 | **Derive screens, workflows, agents, and integrations** | Screen map/user flows; workflow diagrams; agent/tool/connector topology; NestJS services + XIAM declarations — every element traced to stories | User accepts recommendations; resolves surfaced/high-risk ambiguities |
| 5 | **Generate in hosted workspace** | Real code + manifest in the blessed stack, constrained by the platform SDK and policy pack | — (unattended) |
| 6 | **Verify and commit** | Acceptance criteria → executable tests; `generate→test→self-heal`; canonical Git commit + evidence | — (unattended) |
| 7 | **User acceptance test** | Feedback on the **running preview** → loops back to the **spec** (not the code) | User accepts / requests changes |
| 8 | **Promote** | The verified preview release is promoted without rebuilding (§10) | User clicks or enables an explicit policy |

Show-and-correct drives the design stages: the AI proposes concrete artifacts and the user accepts or corrects them rather than facing open-ended technical questions. The data model is always presented because it is high leverage, but manual participation is optional; a non-technical user may accept the agent's explained recommendation.

### 6.7 Visual-first specification workspace

The control plane presents the living specification primarily through **simple, editable visual projections**, with prose and tables available as detail views. The diagrams are never separate source files: every node and edge maps to stable IDs in the structured spec, so edits update the same source of truth and cannot drift.

Required views:
- **Story map:** persona → goal → journey/step → user story, with exception and edge-case branches.
- **Domain map:** plain-language entity cards, important fields, ownership, and relationships; hide database notation by default.
- **Screen map:** pages/dialogs and navigation paths, including empty, loading, error, unauthorized, and destructive-confirmation states.
- **Workflow map:** trigger → action → decision → wait/human approval → success/failure/compensation, using a deliberately small symbol set.
- **Agent/integration map:** oneringai agents, delegation, tools, plugins/overlays, connectors, external systems, permissions, and data exchanged.
- **Permission view:** role/capability matrix plus visual resource ownership boundaries.
- **Traceability/coverage view:** requirement → design elements → tests → implementation modules → release status.

Visual language rules:
- Use human labels and examples, not UML/database jargon; reveal technical details progressively.
- Keep each default view small and story-focused, with drill-down rather than a single giant graph.
- Use consistent shapes/colors/icons, but never rely on color alone; every diagram has an accessible text/table equivalent.
- Let users comment, accept, reject, or ask the agent to revise a selected node/subgraph.
- Auto-layout is the default; manual positioning is presentation metadata and does not change semantics.

Implementation candidate: **React Flow** for editable diagrams/custom domain nodes, backed by the structured spec; static exports may use Mermaid/SVG where appropriate. Library choice remains behind a platform visualization adapter.

### 6.8 Authorization & tenancy in generated apps
The app the non-coder builds is itself **multi-tenant for their customers**, so the interview must extract *their* app's roles and permissions. The AI declares roles/permissions in the spec; XIAM + ever-tenant supply the standard enforcement implementation. Generated applications must still pass negative cross-tenant tests because framework enforcement prevents broad classes of mistakes but is not proof against deliberately malicious code with raw data-plane access.

### 6.9 Regeneration stability
- **Stable IDs** across the spec (story → tables → screens) + **incremental/additive** generation so a refinement is localized — no full-app coin-flip regeneration. Mirrors everworker's stable `nodeId` references + drift detection.
- Generated commits are ordinary Git commits, so every run is diffable and reversible. Managed mode avoids unbounded round-trip reconciliation by making ejection to code mode explicit.

### 6.10 Capability and assurance tiers
- **Managed/certified:** platform data APIs and SDK patterns, approved dependencies, no raw database access. Eligible for the strongest automated governance and scalability guarantees.
- **Extended:** designated custom modules and approved external dependencies. Additional testing and review; some guarantees become conditional.
- **Code mode:** full source control within the blessed stack. Infrastructure isolation remains, but the platform cannot claim that arbitrary application logic is secure or scalable merely because it built successfully.

Fully unattended completion should be measured against a maintained benchmark of representative apps. Unsupported complexity degrades first to a user decision and then to code-mode ejection, never to a dead end.

### 6.11 Reuse & guardrails
- everworker's `ai-builder` (spec/workflow-as-code on disk, drift detection, `PreToolUse` deploy guard, versioned contract) is the seed for **spec-as-source-of-truth + generation guardrails**.
- Guardrails operate at three moments: generation-time guidance, local/hosted fast feedback, and authoritative server-side validation/admission. Passing these controls certifies conformance to a declared capability tier; it does not prove arbitrary code correct.

---

## 7. Browser-native data-app runtime profile

### 7.1 Product definition and invariants

`browser_data` is a special runtime profile, not a reduced requirements process and not a separate development product. The same interview, living PRD, visual design, review, testing, release, and change-management rules apply. It differs only in the generated runtime:

- Customer-authored application code is React/TypeScript executed in the browser.
- There is no customer-authored or per-app server process in production.
- The platform supplies shared, trusted identity, policy, data, audit, and oneringai connector gateways.
- Client calculations, navigation, presentation, and workflow orchestration may be rich, but the browser is never a security boundary.
- Authorization, protected validation, tenant/app scoping, field filtering, quotas, connector credentials, and audit remain server enforced.
- One platform organization can own any number of browser-native apps. Each app belongs to exactly one organization and has its own memberships, roles, policies, data, releases, and route bindings.
- An app may support authenticated members, anonymous/public users, or both. `public` is an explicit least-privilege role, not an absence of policy.
- Every app declares one independently versioned audience contract: `personal`, `team`, or `multi_organization`. This is distinct from the platform organization that owns the app.

The two independent app coordinates are therefore:

```text
developmentSurface = hosted_managed | local_code
runtimeProfile      = full_stack     | browser_data
```

Hosted managed development is the primary v1 surface for `browser_data`; local export/import can be added without changing its runtime contract.

### 7.2 Specification additions

Before generation, the interview first asks who uses the app: **personal** (one owner), **team** (many role-bearing users in one shared workspace), or **multi-organization** (many isolated customer organizations, each with members and roles). Human selection is optional; the discovery agent may recommend and explain a choice. Before generation, the spec must contain approved, traceable definitions for:

1. **Audience, roles, and access:** tenancy mode, organization lifecycle where applicable, app roles, public access, membership lifecycle, CRUD matrix, field visibility/writability, and UI capabilities.
2. **Page inventory:** every URL, page, layout, component, route parameter, navigation entry, and role-dependent state.
3. **Page states:** loading, empty, error, offline/retry, permission denied, partial data, and destructive-action confirmation.
4. **Data model:** entity lifecycle, fields, types, validation, relationships, indexes, retention, deletion/export behavior, and expected volume.
5. **Client workflows:** triggers, browser-side transitions/calculations, server mutations, optimistic behavior, conflicts, and recovery.
6. **Connector actions:** connector, allowlisted operation, input/output schema, permitted roles, timeout, rate/spend limit, redaction, and user-visible failure behavior.
7. **Presentation:** design tokens, theme, responsive layouts, accessibility, and scoped component styles decoupled from logic.
8. **Verification:** acceptance journeys, policy-negative tests, schema/property tests, route refresh/deep-link tests, and connector contract tests.

The visual workspace presents a page/route map, component graph, entity relationship view, role-operation matrix, workflow diagram, and traceability links back to stories. Human involvement remains optional at every approval gate.

### 7.3 Visual design system and dedicated agent

Visual design is an explicit, independently versioned pass after page/component architecture. It is not embedded in page logic and is not a single hard-coded CSS template.

The superadmin Builder System Studio owns a dedicated `visual-designer` oneringai agent template: connector/model, prompt, tools, theme-starter catalog, evaluation policy, and release channel. For each app, the agent receives the approved PRD, page/component inventory, current theme, and the user's plain-language visual direction. Its output is a structured design system rather than arbitrary JSX or unconstrained CSS.

`ThemeRevision` contains:

- Semantic colors: page, surface, raised surface, text, muted text, primary/on-primary, accent, success, danger, and border.
- Typography: approved font family, base scale, and heading treatment.
- Shape/layout: corner system, border weight, density, and content width.
- Component variants: navigation, cards, and buttons, extensible to the shared component catalog.
- Optional bounded custom CSS for advanced users.
- Creator (`visual-design-agent`, user, or system), starter provenance, accessibility evidence, and status.

The control plane supplies curated complete starting systems, live application preview, direct token/variant controls, advanced CSS, agent generation, and revision history. Human review is optional: the agent can propose a complete theme, while an advanced user can change any token or select variants before publishing.

Generated React modules consume semantic classes/primitives; they never own palette, typography, spacing, radius, or component chrome. The theme compiler converts the selected revision into CSS variables and component rules. It validates types, forbids external CSS imports/URLs, calculates WCAG contrast, and blocks publication below the managed accessibility threshold. Custom CSS is length-bounded, scanned, and pinned to the immutable theme revision.

Theme publication produces a new verified release without changing source, data, policies, routes, or connector definitions. Every release pins `themeRevision`; rollback therefore restores the exact visual system together with its CSS artifact. Brand-image uploads will use the governed asset service/object storage and immutable asset IDs rather than external CSS URLs.

### 7.4 Mongo-native application graph

MongoDB is not treated as a filesystem. The durable source representation is an immutable, typed graph:

```text
AppRevision
 ├─ AppModuleRevision[]
 │   ├─ page
 │   ├─ layout
 │   ├─ component
 │   ├─ provider
 │   ├─ hook / utility
 │   └─ test
 ├─ RouteDefinition[]
 ├─ ThemeRevision
 ├─ DataSchemaVersion[]
 ├─ PolicyVersion[]
 └─ ConnectorActionVersion[]
```

An `AppModuleRevision` contains a stable logical ID, kind, name, TS/TSX source, stable module dependencies, approved package imports, optional props schema, required UI capabilities, tests, and a content hash. Declarative routes separately reference page/layout module IDs; an individual component need not have a route, but a releasable app must have at least one route.

Agents use semantic tools such as `module.list/get/create/patch/review`, `route.define/validate`, `schema.update`, `policy.update`, `connector.grant`, `build.run`, and `preview.inspect`. They do not manipulate arbitrary durable paths. Build adapters expose stable virtual module IDs such as `app://module/order-list`; a disposable in-memory or filesystem view may be materialized only when an existing compiler/test tool requires it.

Every release pins all inputs:

```text
release
 ├─ specRevision
 ├─ sourceRevision
 ├─ dataSchemaRevision
 ├─ policyRevision
 ├─ connectorRevision
 ├─ themeRevision
 ├─ builderSystemVersion
 └─ compiledArtifactDigest
```

The PRD/spec remains authoritative in hosted managed mode. Module revisions are derived but immutable so builds are reproducible, diffs are reviewable, and rollback is exact. Git is optional export/interchange, not required infrastructure for this profile.

### 7.5 Server-side generation and release pipeline

```text
interview → approved spec → oneringai generation plan → immutable module graph in Mongo
          → graph/policy/schema validation → isolated bundle/test worker
          → immutable JS/CSS artifact → preview → promote active-release pointer
```

The oneringai builder orchestrator runs as a shared platform service and receives no production data-plane credential. A pooled ephemeral worker bundles a pinned graph revision using approved packages, with package lifecycle scripts and ambient network disabled. It produces hashed JS/CSS, verification evidence, and provenance, then terminates. Browser-native apps therefore require build-time isolation but no per-app runtime container.

Source/spec/config metadata live in Mongo. Compiled artifacts use object storage + CDN in production; GridFS is a valid local/MVP implementation and optional recovery copy. Ordinary Mongo documents must not carry large bundles because of document size and database hot-path cost.

Promotion changes the environment's active release pointer; it never rebuilds. Data, memberships, and sessions survive source promotion. Rollback points to an earlier compatible release after schema-policy compatibility checks.

### 7.6 Runtime topology and trust boundary

```text
Browser
 ├─ immutable React bundle ─────────────── CDN / artifact service
 ├─ /_or/bootstrap and /_or/auth ─────── identity/session gateway
 ├─ /_or/data/:entity ────────────────── schema + policy + data gateway ── Mongo Atlas
 └─ /_or/connectors/:grant/actions/:id ─ connector gateway ── oneringai ── external API

Edge route resolver: Host + path → route binding → app/environment → active release
```

The generated bundle contains no secret, raw database connection, platform credential, or unrestricted external proxy. It receives public runtime configuration and policy-derived UI capability hints through bootstrap. UI hints hide/disable controls for usability only; every gateway repeats authoritative enforcement.

### 7.7 Flexible SPA routing and domains

One compiled release must work without rebuilding at all supported bindings:

- Platform path: `https://ourplatform.com/apps/{publicAppKey}/{spaRoute}`
- Free platform hostname: `https://{chosen-name}.apps.ourplatform.com/{spaRoute}`
- An exact deeper platform hostname when registered: `https://name.region.apps.ourplatform.com/{spaRoute}`
- Paid customer hostname: `https://app.customer.com/{spaRoute}`
- Customer apex domain where its DNS provider supports ALIAS/ANAME/CNAME flattening; universal apex proxying is infrastructure-provider dependent.

"Custom TLD" in product language means a customer-owned apex or hostname, not creation of a new ICANN top-level domain.

`RouteBinding` contains `appId`, environment, binding type, normalized hostname, path prefix, canonical flag, ownership/certificate state, and active status. `(hostname, pathPrefix)` is globally unique. A release may have multiple bindings but exactly one canonical binding for generated absolute links.

The edge/router applies this precedence:

1. Reserved platform/control APIs.
2. App-scoped `/_or` auth, data, connector, and asset routes.
3. Exact hostname + longest path-prefix route binding.
4. SPA history fallback for `GET`/`HEAD` HTML navigation only.
5. 404; never turn failed API or asset requests into HTML.

The runtime bootstrap supplies `basePath` and `apiBase`. React Router uses `BrowserRouter` with the resolved basename; HashRouter is not used. Direct refreshes and nested routes return the same app shell. Generated code uses the runtime client for links and API calls and must not hard-code a deployment hostname or `/apps/...` prefix.

Bundles are built once with relocatable module output. The route-specific HTML shell references immutable asset URLs and supplies its base path without inline executable configuration. Source maps are private release evidence, not public assets.

Free platform names are exact registered hostnames. A standard wildcard certificate covers one label; arbitrary-depth or customer wildcard names require exact/per-host certificate issuance or delegated DNS validation. We do not promise an unrestricted wildcard merely because DNS can resolve it.

Customer-domain onboarding is an asynchronous control-plane operation even though application connector actions are browser initiated: claim hostname → issue ownership token → verify DNS → provision certificate → health check → activate binding. Removing or transferring a domain revokes the binding first, preventing dangling-domain takeover. Cloudflare for SaaS or an equivalent edge provider is used behind a provider interface; standard CNAME custom hostnames are the initial target, while apex proxying may require a higher infrastructure tier.

### 7.8 Identity, roles, sessions, and UI policy

Identity is centralized but authorization is app scoped:

```text
personal:           PlatformUser ── OwnerMembership ─────────────── BrowserApp
team:               PlatformUser ── AppMembership(roleIds) ─────── BrowserApp
multi_organization: PlatformUser ── EndTenantMembership(roleIds) ─ EndTenant ─ BrowserApp
public:             AnonymousRequest ─ synthesized public principal ───────── BrowserApp
```

The same human can belong to several apps and, in multi-organization mode, several end tenants with different roles. Do not store one permanent `tenantId` directly on the user: the membership is the role-bearing relationship. This supports consultants, transfers, support access, and an organization switcher without weakening isolation.

The signed runtime session carries qualified `appId`, subject, active `endTenantId` where applicable, membership ID/version, roles, and CSRF token. The server derives the active tenant only from an active membership and never trusts a tenant ID embedded in browser data requests. Switching organization revalidates membership and rotates the CSRF/session context. The safe capability projection includes organization names and IDs the current subject may select, but not other membership or tenant data.

`TenancyRevision` is immutable and release-pinned beside source, schema, policy, connector, theme, and shared runtime-contract versions. It records mode, organization terminology, and whether multiple memberships are supported. Mode changes are free during design. Once data exists, the control plane generates a migration preview, applies server-owned scope changes, runs negative isolation tests, and publishes a new release; it is never treated as an unverified display toggle.

Sessions use secure, HttpOnly, SameSite cookies. Platform-path apps use an app-specific cookie path; hostname apps use host-only cookies. Never set a broad `.ourplatform.com` session cookie shared by generated apps. Customer-domain authentication returns through a canonical auth broker with a short-lived one-time exchange code so provider callback registration and cookies remain controlled. Mutations require CSRF protection in addition to authorization.

Policies are declarative, deny-by-default data—not evaluated JavaScript. A grant can define operations, record filters/ownership predicates, readable/writable fields, and UI capabilities. The policy compiler validates a bounded AST and produces both server enforcement and a safe client capability projection. It does not send protected predicates or hidden field definitions to the client.

Public writes, when explicitly enabled, additionally require per-IP/app quotas, bot/abuse controls, payload limits, CSRF/origin controls, and audit. Public is never implicitly granted access because a route is visible.

### 7.9 Data schemas and deployment modes

Schemas are stable-ID, versioned JSON Schema plus relationship, lifecycle, index, and retention metadata. The shared gateway uses the native Mongo driver for dynamic app schemas; creating an unbounded Mongoose model per app/entity would leak model state and memory. It enforces:

- App/environment scope on every query and mutation.
- For `multi_organization`, an additional server-injected end-tenant scope on every private query and mutation; the client cannot write, override, or query by the authoritative `tenantId` field.
- JSON Schema validation and server-owned fields.
- Operation, record-filter, and field allowlist policy.
- Cursor pagination, bounded result/field counts, allowlisted sort/filter operators, and index-aware query admission.
- Optimistic concurrency (`version`/ETag) and idempotency keys for retryable writes.
- No raw Mongo query, aggregation pipeline, `$where`, regex abuse, or client-selected physical collection.
- Audit diff, actor, route, release/policy revision, and trace correlation.

Two physical modes share one logical API:

1. **Shared namespace/free:** internally generated bounded collection names such as `a_{compactAppKey}_{environmentKey}_{entityKey}` in a shared regional database. Records also carry app/environment scope as defense in depth. Per-app entity/index/storage quotas are mandatory because Atlas limits count collections and indexes together.
2. **Dedicated database:** a logical database per app/environment inside a managed Atlas cluster, with collection-per-entity and a database-scoped gateway identity. A dedicated cluster is a separate enterprise/whale option, not implied.

The browser never receives Atlas credentials in either mode. Physical names are internal and cannot be supplied by app code. Schema changes use expand/backfill/contract migration gates; release activation is refused when an older/newer active data version is incompatible. Binary uploads use object storage with signed, policy-checked operations rather than Mongo documents.

### 7.10 Connector action gateway

Browser-native integrations are synchronous and browser initiated in v1. The generated app calls an app-scoped operation:

```text
POST {apiBase}/connectors/{grantId}/actions/{actionId}
```

The gateway resolves the app/environment from trusted route/session context, verifies CSRF and role, validates the declared input, enforces timeout/rate/spend limits, loads the encrypted credential just in time, invokes the named oneringai connector action, validates/redacts output, and writes an audit/trace event. The client never sends a credential, vendor base URL, arbitrary operation, or destination URL. Idempotency keys are required for actions with external side effects.

Incoming webhooks, scheduled connector actions, and background app workflows are outside the initial browser-native capability; adding them later uses platform-owned declarative triggers, not customer server code.

### 7.11 API surface

All runtime routes are same-origin beneath the resolved app base:

| Route | Purpose |
|---|---|
| `GET /_or/bootstrap` | Public app metadata, principal projection, CSRF token, base/API paths, safe UI capabilities |
| `POST /_or/auth/...` | Login/logout/callback or local-only demo role exchange |
| `GET/POST /_or/data/{entity}` | Policy-filtered list and validated create |
| `GET/PATCH/DELETE /_or/data/{entity}/{id}` | Policy-filtered record operations |
| `POST /_or/connectors/{grant}/actions/{action}` | Allowlisted synchronous oneringai connector invocation |
| `GET /_or/assets/{build}/{asset}` | Immutable release asset |

The edge strips client-supplied internal routing headers. The gateway independently resolves or verifies a signed route context; a public app ID is routing information, never an authorization secret.

### 7.12 Security and operational requirements

XSS is especially consequential because browser code acts with the user's session and can call allowed connectors. Managed releases therefore require strict CSP without `unsafe-eval`, no unreviewed `dangerouslySetInnerHTML`, dependency/secret scanning, private source maps, content-type/nosniff headers, safe URL handling, and generated security tests. A compromised client still cannot exceed server policies, but it may exercise everything the victim can legitimately do, so authorization alone is not sufficient.

Shared gateways are stateless and horizontally scalable. Cache route bindings and compiled schema/policy programs by revision; invalidate by versioned key rather than mutable cache eviction. Pool Mongo connections by region/deployment, never per request. Meter requests, bytes, documents, connector calls/tokens, build time, and artifact egress by organization/app/environment. Logs and traces include qualified IDs (`ownerOrganizationId`, `appId`, `environmentId`, `releaseId`, and app-user subject) without exposing source, secrets, or protected record data by default.

Production release gates include component compilation, route graph validation, package allowlist, unit/component tests, CRUD contract/property tests, negative role/field/record tests, public abuse tests, deep-link refresh at every binding shape, connector schema/timeout tests, CSP/secret scans, accessibility, responsive browser journeys, and post-release smoke checks.

### 7.13 Fit with the implemented MVP and package plan

The existing MVP already supplies the correct PRD interview, visual artifact types, Builder Studio, oneringai connector bootstrap, run/release concepts, and React/NestJS stack. The browser-native implementation adds rather than replaces those systems.

| Existing MVP | Browser-native extension |
|---|---|
| `Project` + PRD + visual artifacts | Add runtime profile and typed module/route/schema/policy graph revisions |
| JSON demo store | Mongo store for app graph/data/build/release state; migrate control-plane persistence separately |
| `AiService` oneringai interview | Add browser-app architect/generator agents and semantic graph tools |
| Simulated development run | Real graph validation, esbuild bundle, GridFS artifact, release activation |
| Relative `/api` control API | Add same-origin app-scoped `/_or` runtime gateway |
| Vite React control UI | Add Browser App Studio and generated React runtime |
| Single preview URL | Add route-binding resolver for platform path/hostname/customer domain |
| Seeded visual-designer template | Add PRD-aware theme generation, live token editor, contrast/CSS validation, and release-pinned themes |

Required/selected packages and infrastructure are deliberately small:

- Present: React, Vite, `react-router-dom`, NestJS, Zod, oneringai, Vitest.
- Added for this profile: official `mongodb` driver/GridFS, `ajv` + `ajv-formats`, `jose`, and `esbuild`.
- Next production hardening: shared runtime-client/spec/policy packages; distributed rate-limit/cache store; OTel; object-storage client; edge/domain provider adapter; Playwright browser suite; property-based policy tests; production identity broker adapter.
- Do not add Mongoose to the dynamic shared gateway, a browser TypeScript compiler, a generic HTTP proxy, per-app runtime containers, or unrestricted npm dependencies.

Local development attaches to the shared MongoDB exposed on `127.0.0.1:27017` by the sibling `~/dev/icos` Docker stack; this repository must not start a competing Mongo process or container. Platform development data lives in the dedicated `oneringplatform` database, while integration tests create and remove only `oneringplatform_test`. It uses GridFS artifacts, path routing through Vite, exact hostname resolution through the Nest ingress, and a local-only role switch. Production replaces only infrastructure adapters—Atlas, object storage/CDN, edge/custom-hostname TLS, distributed quotas, KMS/secret broker, and real OIDC—not the application graph or runtime API contracts.

---

## 8. Governance injection layer (the "magic")

All injected at NestJS seams via the golden base image; the app author writes none of it.

| Concern | Mechanism | Reused from |
|---|---|---|
| **Tenant context** | Ambient `{userId, tenantId}` via `AsyncLocalStorage`, set by a guard at every entry point; readable everywhere incl. DB hooks | icos `ExecutionContext` pattern + `ever-tenant` |
| **Multitenancy** | Row-level scoping auto-stamped on insert / injected on read via a Mongoose plugin; **fail-loud** if no context; cross-tenant writes blocked + logged | icos `groupScopingHooks` + `ever-tenant` `TenantMongoCollection` |
| **RBAC / permissions** | Framework-agnostic authorization engine (users/groups/roles/permissions + per-resource ownership); enforced via NestJS `@UseGuards` | `iam` / **XIAM** |
| **Enterprise SSO/SCIM** | The IdP handshake that *cannot* be fully automated → **WorkOS or Stytch** + an embeddable Admin Portal for tenant self-service | new (buy) |
| **Audit** | Drop-in audited collections (create/update/delete/view + diffs + query API) | icos **NimbleAudit** |
| **Observability** | OTel SDK pre-wired → platform collector; LLM/agent spans (OpenLLMetry/OpenInference) | new wiring + `ever-telemetry` (logging) |
| **Config** | Declared, code-generated typed config (scope + sensitivity); no raw `process.env` in app code | `ever-config` |
| **Secrets** | App bootstrap identity injected at schedule time; end-tenant secrets fetched just-in-time from a broker using request identity and per-tenant DEKs | icos `groupKeyManager` + `ever-tenant` wallet |
| **Cost controls** | Per-tenant budgets/rate limits at the LLM gateway + interceptors | new + oneringai resilience |

**Auth split worth noting:** XIAM owns *app-level* RBAC + resource ownership; **WorkOS/Stytch** owns *enterprise-connection* SSO/SCIM (the customer-IT handshake no vendor can automate). Stytch is strongest for agent/MCP auth if we productize agent identities.

**Enforcement boundary:** NestJS guards, `AsyncLocalStorage`, and Mongoose plugins protect the standard platform path and prevent accidental cross-tenant access. They are not a hostile-code security boundary: code with a raw database credential can bypass framework hooks. Managed/certified apps therefore cannot receive raw DB credentials and must use an enforceable platform data-access façade or broker. Code-mode apps may receive an app-scoped database credential, but their authors are then trusted with data inside that app database; microVM isolation still protects the platform and other apps.

---

## 9. The golden base image

The single most important artifact for the "automatic enterprise" promise. Platform-owned, versioned, contains:
- Node runtime + NestJS bootstrap with the governance module pre-registered (`APP_GUARD`/`APP_INTERCEPTOR` globals).
- oneringai + the frozen platform façade over it.
- `ever-tenant`, `iam`/XIAM, `ever-config`, `ever-telemetry` wired in.
- OTel SDK + GenAI instrumentation exporting to the platform collector.
- DBOS durable-execution decorators available.
- The client data SDK and optional realtime-relay integration.
- App bootstrap identity and connection to its logical DB/data-access façade; end-tenant secrets remain in the broker.
- Non-root runtime, read-only root filesystem where possible, resource limits, and explicit process types.

App build = **pinned golden base image + validated app source/lockfile → app image**. Owning the image guarantees that governance components are present, but enforceability also requires server admission policy: apps cannot replace the bootstrap, silently downgrade the platform SDK, supply an arbitrary Dockerfile, or build with production secrets. The build emits an SBOM and provenance and signs the resulting immutable artifact.

> ⚠️ Pin the OTel **GenAI semantic conventions** behind an internal abstraction — they are still "Development" status and will churn.

---

## 10. One-click deployment

### 10.1 The reframe: schedule, don't procure
Deploying an app is **scheduling a workload onto shared, always-on infrastructure** + carving a **logical** database + adding a **route** — *not* provisioning a new cluster/DB per app. Per-app physical procurement is slow, costly (idle infra per tenant), and unmanageable. Provisioning is **logical**; the enterprise magic is **baked into the base image**, not provisioned per app.

### 10.2 Converged pipeline

```
Hosted workspace commit OR local Git push / source upload
  1. Ingest: canonical commit + platform manifest + declared capability tier
  2. Validate: conformance, tests, cross-tenant tests, secret/license/vulnerability scans
  3. Build hermetically: pinned base + lockfile → image; emit SBOM/provenance; sign
  4. Provision logically: app DB/namespace, app identity, config and secret-broker grants
  5. Schedule preview: isolated web/worker/scheduler processes; add route + TLS
  6. Verify runtime: health/smoke tests, logs/traces, migration compatibility
  7. Register immutable release: source/spec/build/policy versions + evidence
  8. Promote the same artifact to staging/production; roll back by release pointer
```

### 10.3 Source adapters and server authority
Reuse everworker's `ai-builder` pattern:
- Claude Code / Codex plugin ↔ HTTP MCP server (JWT-authenticated, tenant-scoped, rate-limited).
- Hosted oneringai builders use the same versioned platform contract and policy pack.
- **Spec/app-as-code on disk**; a local `PreToolUse` hook catches drift early and keeps changes git-diffable.
- **Versioned plugin ↔ server contract** (`minServerContract` + capability negotiation).
- Capability-gated: the plugin "cannot grant more than the dashboard would."

Client hooks are convenience controls, not security boundaries. The source gateway repeats every mandatory check and accepts ordinary Git/CLI/API submissions so deployment is not coupled to a specific AI coding tool.

### 10.4 Environments, releases, and process model
- Resource hierarchy: `organization → project/app → environment → release`; the built application's own customers use a distinct `endTenantId`.
- Environments are `development/preview`, optional `staging`, and `production`, each with separate identities, data, config, routes, and secret grants.
- A successful build is immutable and promoted between environments **without rebuilding**. Rollback changes the active release pointer after compatibility checks.
- Apps declare independent **web**, **worker**, **scheduler**, and **release/migration** process types so each can scale and fail independently.
- Production rollout includes readiness/liveness checks, graceful drain, migration gates, smoke tests, and rolling/canary/blue-green policy according to tier.
- Production requirements include backup/PITR, RPO/RTO, index/schema migration strategy, data export/deletion, quotas, abuse controls, and data-residency placement.

### 10.5 Runtime substrate — staged
- **Phase 0 (MVP): Fly Machines** (managed Firecracker microVMs). Gives microVM-grade isolation and a per-app Machines API without running a hypervisor fleet or K8s control plane. Apply Fly network policy and route allowed outbound traffic through a platform-controlled egress gateway. An in-guest proxy alone is not an enforcement boundary against hostile code. Data lives on **Mongo Atlas** (shared cluster, logical DB per app).
- **Phase 1/2 (scale): AWS EKS + Cilium + a selected sandbox `RuntimeClass`** + ECR + Atlas. Benchmark **Kata** (VM-based boundary) and **gVisor** (userspace application kernel) separately for compatibility, security, density, and cost rather than treating them as equivalent.
- **Isolation is non-negotiable:** plain containers or in-process V8 isolates are not the final boundary for arbitrary untrusted code. Managed/certified workspaces may initially use restricted containers only while their executed capability surface is tightly controlled.
- **Watch:** Fly reliability — architect multi-region + health-checked failover from day one.

### 10.6 Data, secrets, realtime, and monitoring — shared + logical
- **Mongo:** shared Atlas cluster(s); **logical DB (or scoped namespace) per app** via the Atlas Admin API. Only whale tenants get dedicated clusters. Matches icos's tenancy model and reuses Mongo expertise.
- **Secrets:** inject only an app/environment bootstrap identity at schedule time. End-tenant connector secrets are retrieved just-in-time through the broker and are never materialized globally in the runtime environment.
- **Realtime:** default to request/query invalidation. When live collections are enabled, use an app-level change-stream relay with resume tokens, backpressure, and fan-out; do not let every autoscaled web instance open duplicate database-wide watchers.
- **Monitoring built-in = one shared multi-tenant stack** (Grafana LGTM + **Langfuse (MIT)** for LLM traces), fed by the base image's OTel exporter, surfaced per-app in the control-plane dashboard (largely exists via icos Observatory + Analytics UI). **Never a monitoring stack per app.**

---

## 11. Control plane

Build the control plane on the same **NestJS + React** foundation as generated apps, while keeping it a separately deployed and privileged system. Port selected icos capabilities rather than attempting an in-place Meteor migration:
- Tenant & user management, group/tenant provisioning, invitations.
- Canonical project/repository metadata, spec versions, development runs, and hosted-workspace scheduling.
- Deploy orchestration (calls the build/schedule/route pipeline).
- Billing & metering.
- Observability UI (Observatory + Analytics), audit views.
- Environment/release registry (which app, environment, immutable artifact, route, status, provenance, and rollback target).
- Host for the **visual-first specification workspace**: interview, living PRD/story map, domain model, screen/workflow/agent diagrams, traceability, preview, and acceptance.
- **Builder System Studio** for effective superadmins, extending the icos Agent Builder pattern: configure/version oneringai connectors, model policies, builder-agent templates, prompts, structured response contracts, tools, plugins/overlays, delegation topology, budgets/limits, evaluation suites, and release channels.

The Builder System Studio preserves the useful icos platform-template model:
- Platform superadmins author hidden, versioned agent templates and decide which fields tenant admins may extend.
- Connector credentials are managed separately from agents and remain scope-correct.
- Tools/plugins have catalog metadata, visibility, required connector scopes, risk levels, and approval policy.
- Development runs pin a published builder-system version for reproducibility; changes are promoted through draft/test/production and support rollback.
- Server APIs enforce privileged fields and secret projection; hiding controls in React is never the authorization boundary.

Porting rule: extract framework-independent TypeScript packages and translate React UX/component patterns to the new platform design system. Meteor publications/methods, DDP state, global collections, and Meteor role checks are replaced with NestJS modules, explicit service/repository interfaces, HTTP/SSE/WebSocket APIs, and XIAM guards.

**Boundary:** the control plane orchestrates both development workspaces and user apps **over APIs**, sharing no runtime with either. Builder planning/model calls may run in a shared oneringai service, but all app-specific tool execution occurs in the assigned workspace. Shared code is limited to framework-agnostic governance and protocol packages.

---

## 12. Durable execution

- **Default: DBOS** — embedded library, checkpoints steps; agent runs survive crashes and resume from the last step; TS + Python; invisible to app devs (the runtime wraps handlers in `@DBOS.workflow`/`@DBOS.step`).
- **Scale escape hatch: Temporal (Cloud)** for very-high-throughput/multi-region tenants.
- **Agent reasoning** (LangGraph / oneringai loops / provider SDKs) runs *inside* durable steps — never as the durability layer itself (checkpointing ≠ durable execution).
- ⚠️ **Open tension:** DBOS requires **Postgres**, but our stack is **Mongo**-centric. See §18.

---

## 13. Isolation & security model

- **Three distinct identities:** a platform organization owns projects/apps; each app has isolated environments/releases; the deployed app may itself serve many end tenants. Never use an unqualified `tenantId` across these layers.
- **Infrastructure boundary:** app and workspace code is hostile toward the control plane, other customers, and the host. Use a sandbox boundary, non-root/read-only runtime, resource quotas, network policy, scoped workload identity, and no ambient cloud/control-plane credentials.
- **Application-data boundary:** an app gets its own DB/namespace and identity. Standard framework tenant scoping protects its end tenants from application mistakes. Managed/certified apps use a platform data-access façade so generated code cannot bypass that scoping; code-mode authors with raw app DB access are trusted with data inside their own app.
- **Development boundary:** a workspace is isolated per active development run/project branch, receives only development credentials and synthetic/preview data, and cannot reach production networks or secrets. Preview deployment is a separate workload built from a committed artifact.
- **Network:** default-deny where the substrate allows it; route permitted outbound traffic through a platform-controlled egress gateway for destination policy, audit, quotas, and SSRF/data-exfiltration controls. A proxy inside a hostile guest is not sufficient.
- **Secrets:** platform/project/environment and end-tenant secrets have separate scopes. Workloads use short-lived identities; end-tenant secrets are fetched just-in-time and audited.
- **Supply chain:** builds run without production secrets, with pinned dependencies/base image, restricted package lifecycle behavior, vulnerability/license/secret scanning, SBOM/provenance, signing, and admission verification.
- **Agent identity:** each builder and runtime agent invocation carries a first-class, auditable, revocable identity and capability set; tool access is narrower than the model's textual instructions.
- **Standards to track:** OWASP Top 10 for Agentic Applications (2026), non-human-identity governance (each agent = a first-class, auditable, revocable identity), SOC 2 / ISO 27001 / ISO 42001 as we move upmarket.

---

## 14. Language strategy

- **TS-first.** Everything we have is TS; TS is #1 for AI codegen; the blessed stack is NestJS + React.
- **Python later.** When demanded, the "Meteor-for-Python" analog is **Reflex** (pure-Python full-stack, great for AI, but pre-1.0 + thin enterprise) or **Django/Litestar** (mature, safer). Deferred past v1.

---

## 15. What we reuse vs. build

| Platform component | Reuse from | Build new |
|---|---|---|
| Agent engine | **oneringai** (connectors, LLM, tools, MCP, memory, orchestration) | Frozen platform façade + OTel exports + enforced tenancy |
| Multitenancy | `ever-tenant` + icos scoping patterns | Mongoose plugin for the blessed stack |
| RBAC | `iam` / XIAM | NestJS guard adapters |
| Audit | icos NimbleAudit | — |
| Logging / config | `ever-telemetry`, `ever-config` | OTel tracing wiring (telemetry tracing is a stub today) |
| Secrets | icos `groupKeyManager` + `ever-tenant` wallet | Workload identity + just-in-time secret broker |
| Control plane | icos domain logic, schemas, tests, React UX patterns, Observatory/Analytics concepts | **New NestJS + React control plane**; port selected capabilities, no Meteor/DDP runtime |
| Visual specification workspace | icos graph/builder UI patterns where useful | Structured-spec projections: story/domain/screen/workflow/agent/permission/traceability views + visual editing |
| Hosted development plane | oneringai orchestration + `ai-builder` patterns | Workspace scheduler, sandbox tool broker, canonical repo integration, run checkpoints/cost controls |
| Deploy trigger UX | everworker **`ai-builder`** (MCP contract, PreToolUse guard, versioned contract) | Repoint payload from workflow-JSON → full app |
| Spec-as-code + gen guardrails | everworker `ai-builder` (as-code, drift detection) | Spec schema/DSL + generation pipeline |
| Blessed app stack | — | **NestJS + React starter + platform SDK** (new) |
| Golden base image | — | **New** (the core artifact) |
| Runtime substrate | — | Fly integration → EKS later |
| Source/release service | everworker contract/versioning concepts | Canonical commits, manifests, environments, immutable releases, promotion/rollback |
| Build pipeline | — | Hermetic build, tests/scans, SBOM/provenance/signing, base image + source → registry |
| Reactive layer | — | Optional app event relay (change streams + resume/backpressure → WS) |
| Enterprise SSO/SCIM | — | Integrate WorkOS/Stytch + Admin Portal |
| Durable execution | — | Integrate DBOS (+ resolve Postgres tension) |
| App generation pipeline | — | **New** (interview → spec → generate → verify → preview) |

The major new systems are the hosted development plane, canonical source/release service, golden base image, hermetic build/deploy pipeline + substrate, blessed-stack starter/platform SDK, app-generation pipeline, and oneringai productization. The percentage already built should be validated component-by-component rather than used as a delivery estimate.

---

## 16. Phased roadmap

**Phase 0 — launch browser-native apps (current exclusive product focus)**
- Complete PRD-first managed journey: diligent interview → approved stories → page/component map → data schema → roles/policies → visual design → connector actions → tests → generated preview → publish.
- Productionize the Mongo-native module/route/schema/policy/theme/connector graph and semantic oneringai builder tools; no Git or local development required.
- Finish Visual Design Studio: configurable oneringai visual agent, curated design systems, complete token/variant editing, governed assets, responsive preview, accessibility and CSS-safety gates, and immutable theme rollback.
- Replace local adapters: Atlas shared namespace/dedicated database modes, object storage/CDN, production OIDC/app membership, distributed quotas/rate limits, KMS secret broker, edge route cache, DNS ownership and managed TLS.
- Complete public/authenticated CRUD policy grammar, record/field rules, pagination/query admission, optimistic concurrency, idempotency, audit, export/deletion, backup/PITR, and abuse controls.
- Productionize synchronous oneringai connector actions with encrypted scoped credentials, input/output schemas, budgets, timeout/idempotency, redaction, audit, and traces.
- Ship platform path, free exact platform hostname, paid custom hostname/apex where supported, canonical route management, preview environments, immutable promotion and rollback.
- Launch control-plane essentials: organizations/apps, usage/billing/quotas, domain and identity setup, release evidence, logs/traces, support/admin tooling, onboarding, and deletion/export.
- Maintain a representative browser-app benchmark; launch gates include green-generation rate, negative-policy tests, accessibility, responsive/deep-link journeys, rollback, performance, zero leaked secrets, and real pilot apps.

**Phase 1 — scale and expand browser-native capability**
- Realtime collections, governed uploads/assets, collaboration, richer component/theme catalogs, reusable modules/templates, localization, offline tolerance, analytics, and enterprise SSO/SCIM.
- Multi-region data/edge placement, advanced observability/cost controls, compliance program, and larger-customer isolation tiers.
- Add declarative schedules/webhooks/background actions only after browser-initiated connector execution is stable.

**Phase 2 — resume other development/runtime modes after browser-native launch**
- Full NestJS + React runtime, golden base image, hostile-workload substrate, hosted workspaces, canonical Git/source gateway, and local Codex/Claude plugins.
- Converge those modes on the already-proven PRD, agent configuration, policy, theme, route, evidence, and release contracts.
- Revisit Python or additional runtime profiles only after the full-stack mode is operationally proven.

---

## 17. Decision log

| # | Decision | Status | Notes |
|---|---|---|---|
| D1 | App model = **opinionated framework, real code** | ✅ Locked | Not low-code/DSL; not deploy-anything |
| D2 | Product stack = **NestJS backend + React frontend** for both the platform and generated apps | ✅ Locked | oneringai is the agent engine; deployments remain plane-separated |
| D3 | **No Meteor in the new product runtime**; port selected icos assets into NestJS + React | ✅ Locked | Reuse logic/patterns, not publications/DDP/global collections |
| D4 | Beachhead ICP = **B2B AI-native startups building multi-tenant agentic SaaS for enterprise buyers** | ✅ Agreed | Expand to enterprise later |
| D5 | Reactive data = **platform-provided and opt-in** (app event relay → WS), not per-web-instance DB watchers | ✅ Locked | Recovers the DX without coupling scaling to connection count |
| D6 | Production substrate = **Fly Machines (MVP) → EKS + selected sandbox runtime (scale)** | ✅ Agreed | Benchmark Kata and gVisor separately |
| D7 | Data = **shared Atlas with shared namespaced collections or logical DB per app** | ✅ Agreed | Browser-data free tier may use bounded app/entity namespaces; dedicated clusters only for whales |
| D8 | Next.js/SSR = **deferred, additive** | ✅ Agreed | Astro/Next as separate deployable when needed |
| D9 | Language = **TS-first, Python later** | ✅ Agreed | Reflex/Django candidates |
| D10 | Enterprise SSO/SCIM = **buy (WorkOS/Stytch)**; app RBAC = **XIAM** | 🟡 Proposed | Confirm vendor |
| D11 | Durable execution = **DBOS default, Temporal escape hatch** | 🟡 Proposed | Blocked on Postgres/Mongo tension (§18) |
| D12 | **Dual-path product**: hosted oneringai development + local Codex/Claude/human development | ✅ Agreed | Both converge on the same source/release service |
| D13 | Source authority is mode-specific: **spec in managed mode; Git in code mode** | ✅ Locked | Avoids pretending arbitrary edits round-trip losslessly |
| D14 | **Mandatory verification loop** (acceptance criteria → executable tests → generate→test→self-heal→preview) before user acceptance | ✅ Locked | What makes "unattended" trustworthy |
| D15 | **Data-model confirmation = always-on first-class checkpoint** (upgraded from "maybe") | ✅ Locked | Highest-leverage artifact |
| D16 | Goal reframed to **"no developer intervention"** — non-coder stays in loop via structured decisions at their altitude | ✅ Agreed | Not "no human" |
| D17 | Escape hatch = explicit **one-way ejection to code mode** for v1 | ✅ Agreed | Extension modules reduce ejection; no lossless round-trip promise |
| D18 | Hosted tool execution uses an **ephemeral isolated workspace per active run/project branch**, not a permanent container per user | ✅ Agreed | Durable state lives in Git/spec/artifact stores; dedicated workspaces are an enterprise option |
| D19 | oneringai builder orchestration may be shared; **filesystem/shell/browser/test tools execute only inside the assigned workspace** | ✅ Agreed | Separates efficient model orchestration from untrusted execution |
| D20 | Plugins/client hooks are UX; **server validation/build/admission is authoritative** | ✅ Locked | Local and hosted paths receive identical enforcement |
| D21 | Releases are **immutable, signed, and promoted without rebuilding** | ✅ Locked | Enables provenance and safe rollback |
| D22 | Security promise distinguishes platform isolation from end-tenant data isolation | ✅ Locked | Raw app DB access is incompatible with hostile-code claims inside that DB |
| D23 | Production assurance is capability-tiered (managed/certified, extended, code mode) | 🟡 Proposed | Define exact restrictions and guarantees |
| D24 | Specification UX is **visual-first**, with diagrams as projections of the structured spec | ✅ Locked | Simple domain language, progressive detail, accessible text/table equivalents |
| D25 | Superadmin **Builder System Studio** configures and versions the oneringai development-agent system | ✅ Agreed | Extend the icos Agent Builder/template pattern in the new stack |
| D26 | Add `browser_data` as a runtime profile independent of hosted/local development surface | ✅ Locked | React application logic plus shared trusted platform gateways |
| D27 | Browser-data durable source is an immutable **typed app-module graph in Mongo**, not files or required Git | ✅ Locked | Build adapters may materialize virtual/disposable files |
| D28 | Browser-data production has **no per-app server process** | ✅ Locked | Shared identity/data/policy/connector gateways; pooled build workers only |
| D29 | One release supports platform path, exact platform hostname, and verified customer hostname bindings without rebuild | ✅ Locked | BrowserRouter basename + edge history fallback; one canonical binding |
| D30 | Browser-data integrations are **browser-initiated, synchronous, allowlisted oneringai actions** in v1 | ✅ Locked | No generic proxy, webhooks, schedules, or app workers initially |
| D31 | Compiled browser artifacts use object storage/CDN in production; GridFS is the local/MVP adapter | ✅ Locked | Source/spec/release metadata remain Mongo-native |
| D32 | The initial product launch focuses **exclusively on browser-native apps** | ✅ Locked | Full-stack hosted and local Codex/Claude modes resume only after this profile is launch-ready |
| D33 | Visual design is a first-class, immutable **`ThemeRevision`** designed by a dedicated configurable oneringai agent | ✅ Locked | Themes are informed by the PRD and page graph, editable by humans, and pinned into releases |
| D34 | Theme publication requires server-side contract, CSS-safety, and accessibility gates | ✅ Locked | Client preview is advisory; the server compiler and admission checks are authoritative |
| D35 | Browser-native apps choose one versioned audience mode: **personal, team, or multi-organization** | ✅ Locked | User count is independent of platform ownership; the choice is an early PRD/interview decision |
| D36 | Multi-organization isolation is membership-derived and server injected | ✅ Locked | `EndTenantMembership` bears roles; signed sessions select an authorized tenant; every private data and connector operation is scoped and negative-tested |

---

## 18. Open questions & risks

1. **DBOS needs Postgres; our stack is Mongo.** Options: (a) run a small Postgres just for durable execution + platform metadata (dual-store; common); (b) pick a Mongo-friendly durable engine; (c) Temporal (DB-agnostic but heavier). **Lean:** (a). Needs a decision.
2. **Runtime agent engine: bundled-per-app vs shared service.** MVP = bundled; do not confuse this with the shared builder-orchestrator in the development plane. When do we move runtime agents to a shared service, and does oneringai's tenant isolation hold?
3. **icos extraction/port plan.** Inventory which packages, schemas, tests, React components, and operational views are framework-independent; define replacement NestJS APIs before porting UI, and explicitly retire Meteor/DDP assumptions rather than reproducing them.
4. **oneringai productization gap.** Needs OTel exports, enforced-default multitenancy, a frozen versioned façade, and public docs before it's the "standard engine." Sequencing?
5. **Our own compliance posture.** Enterprise expansion requires SOC 2 / ISO — chicken-and-egg with landing enterprise logos. When do we start?
6. **OTel GenAI semconv churn** — pin behind an abstraction.
7. **Fly reliability** — multi-region failover from day one; validate before betting the substrate on it.
8. **Observability licensing** — use **Langfuse (MIT)** for the resold LLM-trace backend; **Phoenix's Elastic License forbids hosted resale**.
9. **How opinionated is "opinionated"?** Exact conventions, dependencies, raw-data access, process types, and extension points allowed in each capability tier; needs a machine-readable contract enforced by server admission.
10. **Spec schema/DSL design.** The structured form the interview compiles to (entities, roles, stories + acceptance criteria, screen inventory) is the linchpin artifact of the generation pipeline and needs its own design.
11. **Regeneration stability.** Stable IDs across spec → schema → screens + incremental/additive generation so refinements are localized (no full-app coin-flip regeneration). Mirror everworker's stable `nodeId` references.
12. **Hosted workspace substrate.** Compare managed sandbox providers, Fly Machines, and a small Kubernetes/gVisor pool on cold start, snapshot/restore, network enforcement, browser support, cache strategy, cost, and operational burden. Do not reuse the production app runtime blindly.
13. **Canonical repository strategy.** Platform-managed Git as the default; decide how external GitHub/GitLab repositories mirror commits, webhooks, branches, permissions, and deletion/export.
14. **Unattended completion benchmark.** Build a versioned corpus of representative target apps and measure green-preview rate, human decisions, retries, regressions, cost, and time instead of assuming an 80% completion rate.
15. **Managed data façade.** Decide whether certified apps use a platform data service, a restricted Mongo proxy, generated service endpoints, or physical/credential isolation to make end-tenant scoping enforceable against generated code.
16. **Development concurrency economics.** Set warm-pool size, per-account concurrency, idle timeout, storage/cache policy, build minute pricing, and when dedicated workspaces become an enterprise SKU.
17. **Visual canvas implementation.** Validate React Flow plus an auto-layout engine against large story/domain/workflow graphs, mobile/read-only views, collaboration, undo/redo, accessibility, export, and stable-ID round trips. Keep the structured spec authoritative regardless of rendering library.

---

## 19. Appendix — competitive landscape (condensed)

| Category | Players | Full custom app? | Turnkey governance? | Agent-native? |
|---|---|---|---|---|
| Generic PaaS | Railway, Render, Fly, Northflank | Yes | Partial (enterprise-gated) | Emerging |
| AI Cloud / edge | Vercel, Cloudflare | Yes | Assembled | Yes |
| Opinionated + auto-infra | Encore.ts, RedwoodSDK | Yes | Partial | Weak |
| AI app builders | Replit, Lovable, Bolt, v0 | Yes | Enterprise-gated | Build-time |
| Internal-tool builders | Retool, Superblocks/Clark | Internal-scoped | Strong (Clark injects at gen) | Yes |
| Agent orchestration | LangGraph Platform | **No (agent runtime only)** | Strong | Yes |
| **This platform** | — | **Yes** | **Yes (injected)** | **Yes** |

**The wedge:** an opinionated framework that lets the platform auto-inject enterprise governance into **full custom agentic apps** at deploy time — buildable by developers *and* non-coders. Unoccupied today.
