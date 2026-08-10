# One Ring Platform MVP

NestJS + React + oneringai implementation of the design in `DESIGN.md`.

The target control-plane boundary and migration from the current local
superadmin MVP are specified in
[`docs/SUPERADMIN_TENANCY_ARCHITECTURE.md`](docs/SUPERADMIN_TENANCY_ARCHITECTURE.md).
The implemented lightweight generation, browser-agent, preview, and release
contract is documented in
[`docs/BROWSER_NATIVE_APP_GENERATION.md`](docs/BROWSER_NATIVE_APP_GENERATION.md).
The generic profile, tool-driven discovery, structured specification, and
generator-module boundary are documented in
[`docs/APPLICATION_DEFINITION_PIPELINE.md`](docs/APPLICATION_DEFINITION_PIPELINE.md).

## Included vertical slice

- Visual living application blueprint backed by stable structured-spec IDs.
- Generic application profiles covering product type, tenancy, identity,
  agent authority, data sensitivity, execution placement, and deployment target.
- Tool-driven AI discovery using the local `@everworker/oneringai`
  connector-first API; agents perform validated, focused JSON operations.
- One versioned application definition projected as the interview, PRD,
  blueprint, pages, data, workflows, runtime agents, decisions, quality
  attributes, design brief, and acceptance evidence.
- Explicit specification approval and a capability-based generator registry;
  browser/Mongo generation is available now while other profiles remain fully
  specifiable without pretending their generator exists.
- Superadmin Builder System Studio for agents, prompts, models, tools, plugins, and connector availability.
- Persistent hosted-development run records with workspace and verification gates.
- Immutable preview releases, evidence ledger, idempotent production promotion, and rollback-ready provenance.
- Responsive dark platform UI and a seeded FieldOps AI reference project.
- A complete browser-native data-app mode whose durable source is a versioned React module graph in MongoDB rather than files.
- Declarative React routes, data schemas, role/field CRUD policies, connector grants, builds, releases, and route bindings.
- A dedicated oneringai Visual Design Agent that turns the living PRD and page graph into reviewable, immutable theme revisions.
- A Visual Design Studio with curated starting systems, live preview, semantic color and typography tokens, density/shape/layout controls, component variants, and bounded custom CSS.
- Server-authoritative contrast and CSS-safety gates; every published release pins the exact source and theme revisions for reliable rollback.
- A first-class Users & Tenancy Studio for personal, shared-team, and fully isolated multi-organization applications.
- Versioned end-tenant organizations and memberships, server-injected Mongo scopes, signed organization switching, and generated runtime organization UI.
- Migration-backed tenancy changes with immutable release pinning and negative cross-tenant integration tests.
- Server-side oneringai generation from the living PRD, followed by real esbuild compilation and GridFS artifact publication.
- Per-app generation teams: builders select up to three enabled specialists and independently choose an available OpenAI/Anthropic connector, model, and low/medium/high reasoning effort for each. Successful builds and releases pin the resolved template versions and model configuration.
- A generated Pulse Tasks application with public/authenticated roles, secure Mongo CRUD, CSRF-protected sessions, and an allowlisted oneringai connector action.
- Platform-path and exact-hostname route resolution for one build-once SPA release.
- Tenant-administered Google and Microsoft login through the existing OneRingAI connector system: encrypted connector configuration, authorization code + PKCE, provider-profile linking, organization membership enforcement, and HttpOnly control-plane sessions.
- Optional organization-scoped email/password credentials for local testing, disabled by default and independently enabled per tenant.
- Signed, one-time production identity-broker exchange with invitation activation, membership-version revocation, and app/organization scoping.
- Cursor pagination, optimistic record versions, idempotent create retries, mutation audit events, distributed Mongo-backed connector quotas, and validated connector outputs.

The browser-native vertical slice uses a real local MongoDB and real oneringai
calls. Production identity has a signed broker-exchange contract and quotas are
Mongo-backed. The remaining intentionally local adapters are GridFS instead of
object storage/CDN and local route bindings instead of managed edge DNS/TLS.
Production KMS wrapping for the existing connector encryption, CDN and DNS/TLS
providers still need deployment adapters. Full-stack hosted workspaces remain simulated.

## Run

This project uses the MongoDB instance exposed by the sibling icos Docker stack
on `127.0.0.1:27017`; it does not start or own a competing database container.
If that stack is already running, start the platform directly:

```bash
cd ~/dev/oneringplatform
npm install
cp apps/api/.env.example apps/api/.env # first run only; add provider keys
npm run dev
```

If the shared stack is not running yet, start it first with
`cd ~/dev/icos && npm run docker:up`.

`npm run dev` discovers the running `mongodb-atlas` container credentials
without printing or copying them, then connects to the dedicated
`oneringplatform` database. MongoDB creates that database on the first write,
and the API initializes its indexes, migrations, and seed data automatically.
This keeps platform data separate from both the icos databases and the test
database. Set `MONGO_URI` explicitly only when using a different MongoDB
instance.

The local scripts explicitly enable loopback-only development authentication.
The console starts as `local-superadmin` in the seeded Everworker Labs platform
organization. Use the organization switcher to create another customer
organization; apps created there are owned and listed only in that active
organization. This development authentication path is disabled in production.

The API always loads local secrets from `apps/api/.env`. Deployments should
inject environment variables through their secret manager instead. A
nonstandard external file can be selected with an absolute
`PLATFORM_ENV_FILE`; the legacy `ONERINGAI_ENV_FILE` name remains supported.

Open the control plane at `http://127.0.0.1:5173`. Tenant owners/admins can open
**Organization settings** to add a Microsoft or Google OneRingAI connector,
designate it as a login provider, restrict automatic membership by email domain,
and optionally enable local test credentials. Register
`http://127.0.0.1:4100/api/auth/oauth/callback` as the OAuth callback locally.
Then select **Applications** and create an application. First choose its type,
audience, name, and desired outcome. **Define** opens the primary split-screen
experience: a one-question-at-a-time interview on the left and the live
structured definition on the right. Every specification tool call durably
updates the document and visual **Blueprint** while the agent is working.
Personas, stories, pages, workflows, data, agent contracts, integrations, design
direction, and traceable evidence remain projections of that one source of
truth. Confirmation is blocked when deterministic validation finds conflicting
product intent or broken references.

After **Looks good — build my app**, **Build** uses a balanced specialist team by
default and shows stages, workers, safe reasoning summaries, tool calls, model
events, verification, and errors. Connector, model, reasoning effort, and build
instruction controls remain available under **Advanced build settings**. The
resolved team is stored on the app and copied into build/release provenance.
**Preview** embeds the actual isolated application; **Publish this preview**
activates the exact reviewed artifact without rebuilding. Administrative
tenancy, members, domains, technical architecture, release evidence, and visual
design controls remain available under **Settings** without interrupting the
main interview-to-build path.
The generated application is directly available at
`http://127.0.0.1:5173/apps/pulse-tasks/`. The API runs at
`http://127.0.0.1:4100/api`.

The generated app starts with the `public` role and exposes a local-only role
switch for exercising viewer/editor/admin policies. Demo login is always
disabled in production; production sessions use the one-time identity exchange.

Organization connector configurations and OAuth tokens are stored in MongoDB
with application-layer encryption. Plaintext secrets are never returned by the
API. Set an independent `CONNECTOR_ENCRYPTION_KEY` in production; local
development uses a non-production fallback when it is omitted. The original
environment-backed OpenAI/Anthropic bootstrap remains available until all
agent connector selection is migrated to the same persisted connector store.

## Verify

```bash
npm run check
```

The icos Docker stack must be running for the API integration suite and must
expose MongoDB on `127.0.0.1:27017`. The API test runner discovers the local
container credentials and connects with
`authSource=admin&directConnection=true`. Tests create and remove only the
isolated `oneringplatform_test` database; development data remains in
`oneringplatform`. Credentials are never printed or written to this repository.
CI or a nonstandard local setup can provide `MONGO_TEST_URI` explicitly.

Live provider checks are deliberately excluded from `npm run check`. To make
one low-cost request through each configured connector, run:

```bash
npm run test:ai:live
```

This requires both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in
`apps/api/.env`. Provider-specific models can be selected with
`ONERING_OPENAI_MODEL` and `ONERING_ANTHROPIC_MODEL`.
Normal app generation does not require both: the Applications studio lists the
configured OpenAI and/or Anthropic connectors and obtains their active model
catalogs from the installed OneRingAI version. Each selected specialist uses
its own connector, model, and reasoning-effort setting.

The managed launch browser journey uses a dedicated database, disables paid AI
calls, and removes its data after the run:

```bash
npm run test:e2e
```

GitHub CI runs type checks, API and component tests, production builds, and the
Chromium journey against isolated MongoDB databases. No provider credentials
are required or exposed in CI.
