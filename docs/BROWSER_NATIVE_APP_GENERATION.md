# Browser-native app generation

This document describes the implemented `browser_data` path. It is the launch
path for applications whose UI, calculations, workflow coordination, and agent
loops execute in the browser while One Ring supplies shared security, identity,
Mongo data, model, connector, audit, build, and release gateways.

## Authoritative representation

The approved `BrowserAppSpecification` is the source of truth. Each immutable
revision contains stable requirements plus a typed structure:

- roles and audience mode;
- pages with independent paths, roles, states, entities, workflows, agents, and
  acceptance-criterion references;
- entities and typed fields;
- browser workflows with explicitly placed UI, data, agent, decision, and human
  approval steps;
- browser-agent contracts with model connector, model, tool grants, iteration
  budget, and approval behavior;
- measurable acceptance criteria traced to stable requirement IDs.

Generated modules, routes, schemas, policies, and agents all carry requirement
IDs. `generatedFromSpecRevision` makes drift explicit: saving the specification
marks the editor graph stale until generation implements that exact revision.

## Generation and repair

```text
approved structured spec
        │
        ├─ deterministic compiler: required pages/routes/entities/policies/agents
        │
        └─ selected OneRingAI generation team (one to three specialists)
             ├─ server-resolved hidden specialist template + version
             ├─ user-selected configured connector and active model
             └─ user-selected low / medium / high reasoning effort
                         │
                         ▼
              immutable candidate graph in MongoDB
                         │
               admission build and checks
                  │ pass          │ fail
                  ▼               └─ restore prior graph pointers
            signed preview           feed authoritative error to
                                     the next bounded repair attempt
```

The repair loop is bounded to three attempts. A failure never replaces the
active production release. Entity changes create new immutable schema and
policy revisions; physical Mongo collection names are always derived by the
server. Connector tools are not invented as unrestricted HTTP calls: browser
agents can use only existing app-scoped connector-action grants.

Specialists execute in the order shown in the studio. Each receives the
authoritative app context and the accumulated proposal from earlier
specialists, so an implementer can be followed by an independent reviewer.
The browser submits only template IDs and model settings; the API rejects
disabled/duplicate templates, unknown connectors, cross-vendor models, invalid
effort values, and teams larger than three. Hidden platform instructions and
provider credentials are never returned to the tenant UI.

## Browser-agent execution

The generated runtime exports `runAgent`. The browser owns the loop state,
iteration count, tool sequencing, checkpoints, and approval callback. Each
model turn goes to `/_or/agents/:agentId/turn`; each requested tool goes through
the allowlisted connector gateway. Provider and connector credentials never
enter the bundle.

```text
browser runAgent
  → request one model turn
  → final: return result
  → approval: call the app's human-approval UI
  → tool: call the named allowlisted connector action
  → append validated result and continue within the iteration budget
```

The backend is a security and capability boundary, not the owner of the
application loop. It authenticates the release session, validates role/tool
contracts and payload schemas, enforces rate and timeout limits, invokes
OneRingAI, and writes audits.

## Admission and release lifecycle

Every candidate build runs server-authoritative checks for graph integrity,
structured-spec completeness, requirement traceability, acceptance contracts,
schema/policy/agent contracts, imports, source security, tenancy, theme
accessibility, real esbuild compilation, and artifact hashing. The resulting
JavaScript lives in GridFS locally and has an immutable SHA-256 digest.

A preview release pins the exact spec, source, schema, policy, connector, theme,
tenancy, runtime, generator, generation-team template versions/model settings,
and artifact revisions. The signed preview shell
embeds a per-tab release capability that the generated runtime sends on gateway
requests. All preview CRUD, connector, agent, and bootstrap requests resolve
those pinned revisions; a production tab continues using its active release.
Promotion changes the active pointer to that exact artifact without rebuilding
and removes the preview capability token.

## Studio workflow

1. Create an app in the active platform organization and choose personal, team,
   or multi-organization audience mode.
2. Edit the living requirements and the separate Pages, Workflows, Data model,
   Browser agents, Users & tenancy, and Visual design contracts.
3. Save the specification. The UI shows that source regeneration is required.
4. Select one to three generation specialists and choose a connector, model,
   and reasoning effort for each; then generate a preview.
5. Review repair-attempt results and release evidence.
6. Open the signed preview and exercise real Mongo data, roles, and agent flows.
7. Promote the verified preview. Production changes without a rebuild.

## Intentional platform boundaries

- App code receives no Mongo, model-provider, OAuth, or connector secret.
- The browser cannot select a physical collection, tenant scope, policy
  revision, connector revision, or agent definition.
- Public access is an explicit least-privilege role.
- Generated capability hints improve UI behavior but never replace server
  authorization.
- Incoming webhooks, schedules, and durable background execution are outside
  the browser-native profile; they require platform-owned declarative triggers
  or the future full-stack runtime.

Local development uses the shared MongoDB on `127.0.0.1:27017`, the dedicated
`oneringplatform` database, GridFS artifacts, and local path routing. Production
still needs infrastructure adapters for KMS-backed connector encryption,
object storage/CDN, and managed DNS/TLS, but those adapters do not change this
application or release contract.
