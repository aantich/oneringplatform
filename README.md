# One Ring Platform MVP

NestJS + React + oneringai implementation of the design in `DESIGN.md`.

## Included vertical slice

- Visual living application blueprint backed by stable structured-spec IDs.
- AI discovery interview using the local `@everworker/oneringai` connector-first API.
- Living PRD with approval/version semantics.
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
- A generated Pulse Tasks application with public/authenticated roles, secure Mongo CRUD, CSRF-protected sessions, and an allowlisted oneringai connector action.
- Platform-path and exact-hostname route resolution for one build-once SPA release.
- Signed, one-time production identity-broker exchange with invitation activation, membership-version revocation, and app/organization scoping.
- Cursor pagination, optimistic record versions, idempotent create retries, mutation audit events, distributed Mongo-backed connector quotas, and validated connector outputs.

The browser-native vertical slice uses a real local MongoDB and real oneringai
calls. Production identity has a signed broker-exchange contract and quotas are
Mongo-backed. The remaining intentionally local adapters are GridFS instead of
object storage/CDN and local route bindings instead of managed edge DNS/TLS.
The external OIDC broker, KMS credential broker, CDN and DNS/TLS provider still
need deployment adapters. Full-stack hosted workspaces remain simulated.

## Run

This project uses the MongoDB instance exposed by the sibling icos Docker stack
on `127.0.0.1:27017`; it does not start or own a competing database container.
If that stack is already running, start the platform directly:

```bash
cd ~/dev/oneringplatform
npm install
ONERINGAI_ENV_FILE=../oneringai/.env npm run dev
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

Open the control plane at `http://127.0.0.1:5173`, then select **Browser Apps**.
Use **Users & tenancy** to select the audience model, manage organizations and
role-bearing memberships, and publish the verified tenancy contract.
Use **Visual design** to ask the dedicated agent for an art direction, start from
a curated design system, edit every token and component treatment, preview it,
and publish the approved revision.
The generated application is directly available at
`http://127.0.0.1:5173/apps/pulse-tasks/`. The API runs at
`http://127.0.0.1:4100/api`.

The generated app starts with the `public` role and exposes a local-only role
switch for exercising viewer/editor/admin policies. Demo login is always
disabled in production; production sessions use the one-time identity exchange.

No connector secrets are stored by this repository. Connector cards expose
availability only; credentials remain in the process environment.

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
