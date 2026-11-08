import type { BuilderAgent, PlatformState, Project, SpecArtifact } from './domain.js';

const now = '2026-07-20T09:30:00.000Z';

const artifact = (
  id: string,
  type: SpecArtifact['type'],
  name: string,
  description: string,
  x: number,
  y: number,
  links: SpecArtifact['links'] = [],
  details: Record<string, unknown> = {},
  status: SpecArtifact['status'] = 'approved',
): SpecArtifact => ({
  id,
  type,
  name,
  description,
  status,
  tags: [],
  details,
  links,
  position: { x, y },
});

const project: Project = {
  id: 'fieldops-ai',
  name: 'FieldOps AI',
  description: 'Multi-tenant field-service operations with an agentic dispatch copilot.',
  stage: 'design',
  readiness: 68,
  specVersion: 12,
  updatedAt: now,
  prd: [
    {
      id: 'prd-purpose',
      title: 'Purpose & outcome',
      body: 'Help operations teams triage incoming work, dispatch the right technician, and resolve exceptions without losing human control.',
      status: 'confirmed',
    },
    {
      id: 'prd-personas',
      title: 'Personas',
      body: 'Operations manager, dispatcher, field technician, customer administrator, and platform auditor.',
      status: 'confirmed',
    },
    {
      id: 'prd-guardrails',
      title: 'Guardrails & exceptions',
      body: 'The copilot may recommend assignments but cannot dispatch high-risk work, contact customers, or change SLAs without a human approval.',
      status: 'confirmed',
    },
    {
      id: 'prd-nfr',
      title: 'Production qualities',
      body: 'Tenant isolation, complete audit history, accessible mobile UI, p95 API latency below 400ms, resumable workflows, and zero-downtime releases.',
      status: 'draft',
    },
  ],
  interview: [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'I mapped the core operating journey. Before I lock the PRD: when an urgent request has no qualified technician, should the system escalate to a manager, offer approved contractors, or do both in order?',
      createdAt: now,
    },
  ],
  artifacts: [
    artifact('persona-dispatcher', 'story', 'Dispatcher', 'Coordinates work and owns the final assignment decision.', 0, 120, [{ targetId: 'story-triage', relation: 'performs' }], { kind: 'persona' }),
    artifact('story-triage', 'story', 'Triage new request', 'As a dispatcher, I want requests classified and enriched so urgent work is handled first.', 310, 40, [{ targetId: 'story-assign', relation: 'then' }, { targetId: 'screen-cockpit', relation: 'experienced in' }], { acceptance: ['Priority and confidence are visible', 'Low confidence requests enter review'] }),
    artifact('story-assign', 'story', 'Approve assignment', 'As a dispatcher, I want ranked technician recommendations with clear reasons.', 620, 40, [{ targetId: 'workflow-dispatch', relation: 'implemented by' }, { targetId: 'screen-board', relation: 'experienced in' }], { exceptions: ['No qualified technician', 'Technician becomes unavailable', 'SLA breach imminent'] }),
    artifact('screen-cockpit', 'screen', 'Operations cockpit', 'Live queue, SLA risks, agent activity, and exceptions requiring attention.', 310, 260, [{ targetId: 'entity-workorder', relation: 'shows' }], { states: ['loading', 'empty', 'error', 'permission denied'] }),
    artifact('screen-board', 'screen', 'Dispatch board', 'Work-order timeline with ranked technicians and an approval drawer.', 620, 260, [{ targetId: 'entity-technician', relation: 'shows' }]),
    artifact('entity-workorder', 'entity', 'Work order', 'Tenant-owned request with priority, SLA, location, skills, state, and audit history.', 180, 490, [{ targetId: 'entity-tenant', relation: 'belongs to' }, { targetId: 'entity-technician', relation: 'assigned to' }], { fields: ['summary', 'priority', 'slaDueAt', 'requiredSkills', 'status', 'tenantId'] }),
    artifact('entity-technician', 'entity', 'Technician', 'Qualified field worker with skills, schedule, territory, and current capacity.', 500, 490, [{ targetId: 'entity-tenant', relation: 'belongs to' }], { fields: ['name', 'skills', 'territory', 'availability', 'tenantId'] }),
    artifact('entity-tenant', 'entity', 'Customer organization', 'Security and data-isolation boundary for every business record.', 820, 490, [], { fields: ['name', 'policy', 'dataRegion'] }),
    artifact('workflow-dispatch', 'workflow', 'Assisted dispatch', 'Ingest → classify → rank → policy check → human approval → notify → audit.', 920, 100, [{ targetId: 'agent-dispatch', relation: 'uses' }, { targetId: 'integration-slack', relation: 'notifies through' }, { targetId: 'test-dispatch', relation: 'verified by' }], { steps: ['Trigger', 'Classify', 'Rank', 'Policy gate', 'Human approval', 'Notify', 'Audit'] }),
    artifact('agent-dispatch', 'agent', 'Dispatch copilot', 'oneringai agent that classifies requests and explains ranked recommendations.', 1030, 330, [{ targetId: 'integration-maps', relation: 'calls' }], { tools: ['work_order_read', 'technician_search', 'route_estimate'], approvals: ['dispatch', 'customer_contact'] }),
    artifact('integration-maps', 'integration', 'Route & distance API', 'Provides travel estimates; circuit-broken and cached with a manual fallback.', 1310, 250, [], { auth: 'platform connector', failure: 'show distance unavailable; never block manual dispatch' }),
    artifact('integration-slack', 'integration', 'Slack notifications', 'Sends approved assignment and escalation notifications.', 1310, 410, [], { approval: 'required for external message' }),
    artifact('test-dispatch', 'test', 'Dispatch acceptance suite', 'Covers happy path, empty candidate set, stale availability, tenant isolation, and approval denial.', 1040, 570, [], { cases: 18, automated: 16, coverage: 89 }),
  ],
};

const agentDefinitions: Array<[string, string, string, string]> = [
  ['interviewer', 'Discovery interviewer', 'Diligent product interviewer', 'Discovery'],
  ['prd-critic', 'PRD critic', 'Ambiguity and edge-case reviewer', 'Discovery'],
  ['domain-architect', 'Domain architect', 'Data, tenancy, and lifecycle designer', 'Design'],
  ['ux-architect', 'UX architect', 'Journeys, screens, and accessibility designer', 'Design'],
  ['visual-designer', 'Visual designer', 'Design system and theme curator', 'Design'],
  ['agent-architect', 'Agent architect', 'oneringai agent, connector, and tool designer', 'Design'],
  ['test-architect', 'Test architect', 'Acceptance, contract, security, and eval designer', 'Verification'],
  ['implementer', 'Implementation lead', 'Module and vertical-slice implementation', 'Implementation'],
  ['reviewer', 'Independent reviewer', 'Architecture, security, DRY/KISS, and contract review', 'Implementation'],
  ['release-guardian', 'Release guardian', 'Evidence, rollback, and promotion gate', 'Release'],
];

const agents: BuilderAgent[] = agentDefinitions.map(([id, name, role, stage], index) => ({
  id,
  name,
  role,
  stage,
  connector: index % 3 === 0 ? 'anthropic-main' : 'openai-main',
  model: index % 3 === 0 ? 'claude-sonnet-5' : 'gpt-5.6-terra',
  effort: index === 7 || index === 8 ? 'high' : 'medium',
  instructions: `You are the ${role.toLowerCase()} for the One Ring managed application pipeline. Be explicit about assumptions, exceptions, evidence, and traceability.`,
  tools: index < 2 ? ['spec_read', 'spec_write', 'ask_user'] : ['spec_read', 'spec_write', 'workspace_read'],
  plugins: ['working-memory', 'traceability'],
  enabled: true,
  version: 3,
  lastEvaluatedScore: 88 + (index % 5) * 2,
}));

export const createSeedState = (): PlatformState => ({
  projects: [project],
  agents,
  runs: [],
  releases: [
    {
      id: 'rel-preview-11',
      projectId: project.id,
      version: '0.11.0-preview',
      environment: 'preview',
      status: 'ready',
      artifactDigest: 'sha256:7ec1a0f2c6b9',
      sourceCommit: '8a3f91c',
      createdAt: now,
      url: 'https://fieldops-ai.preview.onering.dev',
      evidence: { tests: 146, coverage: 87, policyChecks: 24 },
    },
  ],
  builderVersion: 'builder-2026.07.20.3',
});
