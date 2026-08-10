export const browserRuntimeContractVersion = 4;

export type BrowserRuntimeOperation = {
  id: string;
  helper: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  purpose: string;
  mutates: boolean;
  concurrency?: 'idempotency-key' | 'if-match';
};

/**
 * The single source of truth for the browser runtime exposed to generated apps.
 * It is used by the runtime bootstrap response and by generation-agent context,
 * so adding an operation here makes it discoverable in both places.
 */
export const browserRuntimeOperations: readonly BrowserRuntimeOperation[] = [
  { id: 'session.bootstrap', helper: 'bootstrap()', method: 'GET', path: '/_or/bootstrap', purpose: 'Load the effective identity, tenancy boundary, release contract, and available capabilities.', mutates: false },
  { id: 'data.list', helper: 'data.list(entity, options?)', method: 'GET', path: '/_or/data/:entity', purpose: 'Read one cursor-paginated page of policy-filtered records.', mutates: false },
  { id: 'data.get', helper: 'data.get(entity, id)', method: 'GET', path: '/_or/data/:entity/:id', purpose: 'Read one policy-filtered record.', mutates: false },
  { id: 'data.create', helper: 'data.create(entity, value)', method: 'POST', path: '/_or/data/:entity', purpose: 'Validate and create a tenant-scoped record.', mutates: true, concurrency: 'idempotency-key' },
  { id: 'data.update', helper: 'data.update(entity, id, value, version)', method: 'PATCH', path: '/_or/data/:entity/:id', purpose: 'Validate and update a record with optimistic concurrency.', mutates: true, concurrency: 'if-match' },
  { id: 'data.delete', helper: 'data.remove(entity, id, version)', method: 'DELETE', path: '/_or/data/:entity/:id', purpose: 'Delete a record with optimistic concurrency.', mutates: true, concurrency: 'if-match' },
  { id: 'connector.invoke', helper: 'invokeConnector(connectorId, action, input)', method: 'POST', path: '/_or/connectors/:connectorId/actions/:action', purpose: 'Invoke an allowlisted server-side connector action without exposing credentials.', mutates: true, concurrency: 'idempotency-key' },
  { id: 'agent.run', helper: 'runAgent(agentId, goal, options?)', method: 'POST', path: '/_or/agents/:agentId/turn', purpose: 'Run a bounded browser-orchestrated agent loop through approved tools.', mutates: true, concurrency: 'idempotency-key' },
  { id: 'identity.exchange', helper: 'exchangeIdentity(token, tenantId?)', method: 'POST', path: '/_or/auth/exchange', purpose: 'Exchange a one-time platform identity assertion for an app-scoped session.', mutates: true },
  { id: 'identity.switchOrganization', helper: 'switchOrganization(tenantId)', method: 'POST', path: '/_or/auth/switch-organization', purpose: 'Change the active end-tenant after membership verification.', mutates: true },
] as const;

export function browserRuntimeAgentGuide(): string {
  const operations = browserRuntimeOperations
    .map((operation) => `- ${operation.id}: ${operation.helper} — ${operation.purpose}`)
    .join('\n');
  return `Browser runtime contract v${browserRuntimeContractVersion}. Import helpers only from app:runtime; direct network calls are forbidden.\n${operations}\nThe bootstrap response contains runtime.operations plus the effective entities, connector actions, and agents for the current release and role. Prefer the named helpers over the low-level api() escape hatch.`;
}
