import type { ToolFunction } from '@everworker/oneringai';
import type { AppStructuredSpecification, BrowserAppSpecification } from './browser-app.domain.js';

export type SpecificationDraftState = {
  sections: BrowserAppSpecification['sections'];
  structure: AppStructuredSpecification;
  changes: Array<{ tool: string; targetId: string; summary: string }>;
};

export type SpecificationDraftChange = SpecificationDraftState['changes'][number];
export type SpecificationDraftObserver = (change: SpecificationDraftChange, state: SpecificationDraftState) => void | Promise<void>;

const permission = { scope: 'always' as const, riskLevel: 'low' as const };
const stableIdPattern = '^[a-z0-9][a-z0-9-]{0,63}$';

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !new RegExp(stableIdPattern).test(value)) throw new Error(`${label} needs a stable lowercase ID`);
  return value;
}

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > maximum) throw new Error(`${label} must contain 2 to ${maximum} characters`);
  return value.trim();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 100) : [];
}

function upsert<T extends { id: string }>(items: T[], candidate: T): void {
  const index = items.findIndex((item) => item.id === candidate.id);
  if (index === -1) items.push(candidate);
  else items[index] = candidate;
}

async function record(state: SpecificationDraftState, observer: SpecificationDraftObserver | undefined, tool: string, targetId: string, summary: string) {
  const change = { tool, targetId, summary };
  state.changes.push(change);
  await observer?.(change, state);
  return { success: true, targetId, summary, changeCount: state.changes.length };
}

export function specificationCoverage(state: SpecificationDraftState) {
  const structure = state.structure;
  const covered: string[] = [];
  const missing: string[] = [];
  const contradictions: string[] = [];
  const check = (condition: boolean, id: string, failure: string) => (condition ? covered.push(id) : missing.push(failure));
  const placeholder = /discovery (must|placeholder)|not fully understood|describe (this|what)|representative user can complete/i;
  check(state.sections.length >= 5 && state.sections.every((section) => section.body.length >= 40 && !placeholder.test(section.body)), 'requirements', 'Detailed, confirmed narrative requirements');
  check(structure.personas.length > 0 && structure.personas.every((persona) => persona.goals.length > 0 && persona.painPoints.length > 0 && !placeholder.test(`${persona.description} ${persona.painPoints.join(' ')}`)), 'personas', 'Specific personas, goals, and current pain points');
  check(structure.userStories.length >= structure.personas.length && structure.userStories.every((story) => story.surfaceIds.length > 0 || story.workflowIds.length > 0), 'stories', 'Prioritized user stories traced to surfaces or workflows');
  check(structure.pages.length > 0 && structure.pages.every((page) => ['loading', 'empty', 'error', 'ready'].every((required) => page.states.includes(required as typeof page.states[number])) && (page.public || page.states.includes('forbidden'))), 'surfaces', 'UI surfaces with ready, loading, empty, error, and access states');
  check(structure.entities.length > 0 && structure.entities.every((entity) => entity.fields.length > 0 && entity.fields.every((field) => field.description.length >= 2) && !placeholder.test(entity.description)), 'data', 'Specific domain entities, fields, validation, and lifecycle');
  check(structure.workflows.length > 0 && structure.workflows.every((workflow) => workflow.steps.length > 0 && !placeholder.test(workflow.description)), 'workflows', 'End-to-end workflows, decisions, exceptions, and recovery');
  check(structure.acceptanceCriteria.length >= state.sections.length && structure.acceptanceCriteria.every((criterion) => criterion.description.length >= 12 && !placeholder.test(criterion.description)), 'acceptance', 'Measurable, requirement-traced acceptance criteria');
  check(structure.qualityAttributes.length >= 4 && new Set(structure.qualityAttributes.map((attribute) => attribute.category)).size >= 4, 'quality', 'At least four measurable production-quality categories');
  check(structure.designBrief.tone.length >= 8 && structure.designBrief.principles.length >= 3, 'design', 'Product-specific visual direction and accessibility target');
  check(structure.decisions.filter((decision) => decision.status === 'confirmed').length >= 2, 'decisions', 'Confirmed product and architecture decisions with rationale');
  if (structure.agents.length) check(structure.agents.every((agent) => agent.maximumIterations > 0), 'agent-guardrails', 'Agent budgets and approval rules');
  const ids = new Set(state.sections.map((section) => section.id));
  for (const criterion of structure.acceptanceCriteria) if (!ids.has(criterion.requirementId)) contradictions.push(`${criterion.id} references missing requirement ${criterion.requirementId}`);
  const entityIds = new Set(structure.entities.map((entity) => entity.id));
  const workflowIds = new Set(structure.workflows.map((workflow) => workflow.id));
  const agentIds = new Set(structure.agents.map((agent) => agent.id));
  const criterionIds = new Set(structure.acceptanceCriteria.map((criterion) => criterion.id));
  const personaIds = new Set(structure.personas.map((persona) => persona.id));
  const surfaceIds = new Set(structure.pages.map((page) => page.id));
  for (const story of structure.userStories) {
    if (story.personaId && !personaIds.has(story.personaId)) contradictions.push(`${story.id} references missing persona ${story.personaId}`);
    for (const id of story.surfaceIds) if (!surfaceIds.has(id)) contradictions.push(`${story.id} references missing surface ${id}`);
    for (const id of story.workflowIds) if (!workflowIds.has(id)) contradictions.push(`${story.id} references missing workflow ${id}`);
    for (const id of story.acceptanceCriterionIds) if (!criterionIds.has(id)) contradictions.push(`${story.id} references missing criterion ${id}`);
  }
  for (const page of structure.pages) {
    for (const id of page.entityIds) if (!entityIds.has(id)) contradictions.push(`${page.id} references missing entity ${id}`);
    for (const id of page.workflowIds) if (!workflowIds.has(id)) contradictions.push(`${page.id} references missing workflow ${id}`);
    for (const id of page.agentIds) if (!agentIds.has(id)) contradictions.push(`${page.id} references missing agent ${id}`);
    for (const id of page.acceptanceCriterionIds) if (!criterionIds.has(id)) contradictions.push(`${page.id} references missing criterion ${id}`);
  }
  const productLanguage = [structure.purpose, ...state.sections.flatMap((section) => [section.title, section.body])].join(' ').toLowerCase();
  const surfaceLanguage = structure.pages.flatMap((page) => [page.id, page.name, page.purpose]).join(' ').toLowerCase();
  const entityLanguage = structure.entities.flatMap((entity) => [entity.id, entity.name, entity.description]).join(' ').toLowerCase();
  if (/\b(blog|blogging|journal|article|story|stories|editorial|publishing)\b/.test(productLanguage)) {
    if (!/\b(article|articles|post|posts|story|stories)\b/.test(entityLanguage)) contradictions.push('Editorial product intent has no article, post, or story entity');
    if (!/\b(article|story|stories|editor|editorial|publish|reading|journal)\b/.test(surfaceLanguage)) contradictions.push('Editorial product intent has no matching reading or editorial surfaces');
    if (/\btask board|team tasks|architecture page\b/.test(surfaceLanguage) || /\btasks?\b/.test(entityLanguage)) contradictions.push('Editorial product intent is still connected to unrelated task-demo structures');
    if (!structure.pages.some((page) => page.public) || !structure.pages.some((page) => !page.public)) contradictions.push('Editorial products need both a public reading surface and a private editorial surface');
  }
  const score = Math.max(0, Math.round((covered.length / Math.max(covered.length + missing.length, 1)) * 100) - contradictions.length * 5);
  return { score, covered, missing, contradictions };
}

export function createSpecificationTools(state: SpecificationDraftState, observer?: SpecificationDraftObserver): ToolFunction[] {
  const commit = (tool: string, targetId: string, summary: string) => record(state, observer, tool, targetId, summary);
  const getSummary: ToolFunction = {
    definition: { type: 'function', function: { name: 'spec_get_summary', description: 'Read a compact summary and deterministic completeness report for the current application-definition draft. Call this before editing.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
    execute: async () => ({
      purpose: state.structure.purpose,
      requirements: state.sections.map(({ id, title }) => ({ id, title })),
      counts: {
        personas: state.structure.personas.length, stories: state.structure.userStories.length, surfaces: state.structure.pages.length,
        entities: state.structure.entities.length, workflows: state.structure.workflows.length, agents: state.structure.agents.length,
        integrations: state.structure.integrations.length, decisions: state.structure.decisions.length,
        acceptanceCriteria: state.structure.acceptanceCriteria.length,
      },
      coverage: specificationCoverage(state),
    }),
    permission,
    describeCall: () => 'inspect application definition summary',
  };

  const queryNodes: ToolFunction<{ node_type: string; ids?: string[] }> = {
    definition: { type: 'function', function: { name: 'spec_query_nodes', description: 'Read one category of structured application-definition nodes. Use targeted reads instead of requesting the entire document.', parameters: { type: 'object', properties: { node_type: { type: 'string', enum: ['requirement', 'persona', 'story', 'surface', 'entity', 'workflow', 'runtime_agent', 'integration', 'decision', 'quality', 'acceptance'] }, ids: { type: 'array', items: { type: 'string', pattern: stableIdPattern }, maxItems: 50 } }, required: ['node_type'], additionalProperties: false } } },
    execute: async ({ node_type, ids }) => {
      const sources: Record<string, unknown[]> = {
        requirement: state.sections, persona: state.structure.personas, story: state.structure.userStories,
        surface: state.structure.pages, entity: state.structure.entities, workflow: state.structure.workflows,
        runtime_agent: state.structure.agents, integration: state.structure.integrations, decision: state.structure.decisions,
        quality: state.structure.qualityAttributes, acceptance: state.structure.acceptanceCriteria,
      };
      const source = sources[node_type];
      if (!source) throw new Error(`Unknown node type ${node_type}`);
      const requested = new Set(ids ?? []);
      return { nodeType: node_type, items: requested.size ? source.filter((item) => requested.has(String((item as { id?: unknown }).id))) : source };
    },
    permission,
    describeCall: ({ node_type }) => `read ${node_type} nodes`,
  };

  const upsertRequirement: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_requirement', description: 'Create or replace one stable narrative requirement. Use this for product outcomes, permissions, journeys, data, guardrails, non-goals, and production qualities.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, title: { type: 'string', minLength: 2, maxLength: 120 }, body: { type: 'string', minLength: 10, maxLength: 8000 } }, required: ['id', 'title', 'body'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Requirement'), title: text(args.title, 'Requirement title', 120), body: text(args.body, 'Requirement body', 8_000) };
      upsert(state.sections, candidate);
      return commit('spec_upsert_requirement', candidate.id, `Updated requirement “${candidate.title}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'requirement'),
  };

  const upsertPersona: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_persona', description: 'Create or replace a persona with explicit goals, pain points, and role mappings.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, description: { type: 'string' }, goals: { type: 'array', items: { type: 'string' } }, pain_points: { type: 'array', items: { type: 'string' } }, role_ids: { type: 'array', items: { type: 'string', pattern: stableIdPattern } } }, required: ['id', 'name', 'description', 'goals', 'pain_points', 'role_ids'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Persona'), name: text(args.name, 'Persona name', 120), description: text(args.description, 'Persona description'), goals: strings(args.goals), painPoints: strings(args.pain_points), roleIds: strings(args.role_ids) };
      upsert(state.structure.personas, candidate);
      return commit('spec_upsert_persona', candidate.id, `Updated persona “${candidate.name}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'persona'),
  };

  const upsertStory: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_user_story', description: 'Create or replace one prioritized user story and trace it to surfaces, workflows, and acceptance criteria.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, title: { type: 'string' }, persona_id: { type: 'string', pattern: stableIdPattern }, statement: { type: 'string' }, priority: { type: 'string', enum: ['must', 'should', 'could'] }, surface_ids: { type: 'array', items: { type: 'string' } }, workflow_ids: { type: 'array', items: { type: 'string' } }, acceptance_criterion_ids: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title', 'statement', 'priority'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Story'), title: text(args.title, 'Story title', 160), ...(args.persona_id ? { personaId: stableId(args.persona_id, 'Persona') } : {}), statement: text(args.statement, 'Story statement'), priority: args.priority as 'must' | 'should' | 'could', surfaceIds: strings(args.surface_ids), workflowIds: strings(args.workflow_ids), acceptanceCriterionIds: strings(args.acceptance_criterion_ids) };
      if (!['must', 'should', 'could'].includes(candidate.priority)) throw new Error('Story priority must be must, should, or could');
      upsert(state.structure.userStories, candidate);
      return commit('spec_upsert_user_story', candidate.id, `Updated user story “${candidate.title}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'story'),
  };

  const upsertSurface: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_surface', description: 'Create or replace one UI surface with route, audience, complete UI states, and references to data, workflows, agents, and evidence.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, path: { type: 'string', pattern: '^/' }, purpose: { type: 'string' }, public: { type: 'boolean' }, role_ids: { type: 'array', items: { type: 'string' } }, states: { type: 'array', items: { type: 'string', enum: ['loading', 'empty', 'error', 'forbidden', 'ready'] } }, entity_ids: { type: 'array', items: { type: 'string' } }, workflow_ids: { type: 'array', items: { type: 'string' } }, agent_ids: { type: 'array', items: { type: 'string' } }, acceptance_criterion_ids: { type: 'array', items: { type: 'string' } } }, required: ['id', 'name', 'path', 'purpose', 'public', 'role_ids', 'states'], additionalProperties: false } } },
    execute: async (args) => {
      const states = strings(args.states).filter((state): state is AppStructuredSpecification['pages'][number]['states'][number] => ['loading', 'empty', 'error', 'forbidden', 'ready'].includes(state));
      if (!states.includes('ready')) states.push('ready');
      const candidate = { id: stableId(args.id, 'Surface'), name: text(args.name, 'Surface name', 120), path: text(args.path, 'Surface path', 200), purpose: text(args.purpose, 'Surface purpose'), public: Boolean(args.public), roleIds: strings(args.role_ids), states, entityIds: strings(args.entity_ids), workflowIds: strings(args.workflow_ids), agentIds: strings(args.agent_ids), acceptanceCriterionIds: strings(args.acceptance_criterion_ids) };
      if (!candidate.path.startsWith('/')) throw new Error('Surface path must be absolute');
      upsert(state.structure.pages, candidate);
      return commit('spec_upsert_surface', candidate.id, `Updated UI surface “${candidate.name}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'surface'),
  };

  const upsertEntity: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_entity', description: 'Create or replace one domain entity with typed fields. Describe validation, ownership, sensitivity, lifecycle, and relationships in the entity and field descriptions.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, description: { type: 'string' }, fields: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['string', 'number', 'boolean', 'date', 'enum', 'object', 'array'] }, required: { type: 'boolean' }, description: { type: 'string' } }, required: ['id', 'type', 'required', 'description'], additionalProperties: false } } }, required: ['id', 'name', 'description', 'fields'], additionalProperties: false } } },
    execute: async (args) => {
      const fields = Array.isArray(args.fields) ? args.fields.map((raw) => { const field = raw as Record<string, unknown>; const type = String(field.type) as AppStructuredSpecification['entities'][number]['fields'][number]['type']; if (!['string', 'number', 'boolean', 'date', 'enum', 'object', 'array'].includes(type)) throw new Error(`Unknown field type ${type}`); return { id: stableId(field.id, 'Field'), type, required: Boolean(field.required), description: text(field.description, 'Field description', 1_000) }; }) : [];
      if (!fields.length) throw new Error('Entity needs at least one field');
      const candidate = { id: stableId(args.id, 'Entity'), name: text(args.name, 'Entity name', 120), description: text(args.description, 'Entity description'), fields };
      upsert(state.structure.entities, candidate);
      return commit('spec_upsert_entity', candidate.id, `Updated entity “${candidate.name}” with ${fields.length} fields.`);
    }, permission, describeCall: (args) => String(args.id ?? 'entity'),
  };

  const upsertWorkflow: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_workflow', description: 'Create or replace an end-to-end workflow. Include triggers, decisions, exceptions, human approvals, recovery, and agent steps explicitly.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, description: { type: 'string' }, trigger: { type: 'string' }, steps: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['browser_action', 'data_read', 'data_write', 'agent', 'decision', 'human_approval'] }, description: { type: 'string' } }, required: ['id', 'type', 'description'], additionalProperties: false } } }, required: ['id', 'name', 'description', 'trigger', 'steps'], additionalProperties: false } } },
    execute: async (args) => {
      const steps = Array.isArray(args.steps) ? args.steps.map((raw) => { const step = raw as Record<string, unknown>; const type = String(step.type) as AppStructuredSpecification['workflows'][number]['steps'][number]['type']; if (!['browser_action', 'data_read', 'data_write', 'agent', 'decision', 'human_approval'].includes(type)) throw new Error(`Unknown workflow step type ${type}`); return { id: stableId(step.id, 'Workflow step'), type, description: text(step.description, 'Workflow step description', 2_000) }; }) : [];
      if (!steps.length) throw new Error('Workflow needs at least one step');
      const candidate = { id: stableId(args.id, 'Workflow'), name: text(args.name, 'Workflow name', 120), description: text(args.description, 'Workflow description'), trigger: text(args.trigger, 'Workflow trigger'), steps };
      upsert(state.structure.workflows, candidate);
      return commit('spec_upsert_workflow', candidate.id, `Updated workflow “${candidate.name}” with ${steps.length} steps.`);
    }, permission, describeCall: (args) => String(args.id ?? 'workflow'),
  };

  const upsertAgent: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_runtime_agent', description: 'Create or replace a runtime application agent contract. Specify its bounded purpose, connector, model, allowlisted tools, iteration budget, and human-approval behavior.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, purpose: { type: 'string' }, connector: { type: 'string' }, model: { type: 'string' }, tool_ids: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9-]+:[a-z0-9-]+$' } }, maximum_iterations: { type: 'integer', minimum: 1, maximum: 12 }, human_approval_required: { type: 'boolean' } }, required: ['id', 'name', 'purpose', 'connector', 'model', 'tool_ids', 'maximum_iterations', 'human_approval_required'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Runtime agent'), name: text(args.name, 'Agent name', 120), purpose: text(args.purpose, 'Agent purpose'), connector: stableId(args.connector, 'Connector'), model: text(args.model, 'Model', 120), toolIds: strings(args.tool_ids), maximumIterations: Number(args.maximum_iterations), humanApprovalRequired: Boolean(args.human_approval_required) };
      if (!Number.isInteger(candidate.maximumIterations) || candidate.maximumIterations < 1 || candidate.maximumIterations > 12) throw new Error('Agent maximum iterations must be 1 to 12');
      upsert(state.structure.agents, candidate);
      return commit('spec_upsert_runtime_agent', candidate.id, `Updated runtime agent “${candidate.name}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'runtime agent'),
  };

  const upsertIntegration: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_integration', description: 'Create or replace one external-system contract. Record its purpose, optional OneRingAI connector, allowed operations, failure behavior, and data classification. Do not invent an integration without user evidence.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, name: { type: 'string' }, purpose: { type: 'string' }, connector: { type: 'string', pattern: stableIdPattern }, operations: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } }, failure_behavior: { type: 'string' }, data_classification: { type: 'string', enum: ['standard', 'confidential', 'regulated'] } }, required: ['id', 'name', 'purpose', 'operations', 'failure_behavior', 'data_classification'], additionalProperties: false } } },
    execute: async (args) => {
      const classification = args.data_classification as AppStructuredSpecification['integrations'][number]['dataClassification'];
      if (!['standard', 'confidential', 'regulated'].includes(classification)) throw new Error('Unknown integration data classification');
      const candidate = { id: stableId(args.id, 'Integration'), name: text(args.name, 'Integration name', 120), purpose: text(args.purpose, 'Integration purpose'), ...(args.connector ? { connector: stableId(args.connector, 'Connector') } : {}), operations: strings(args.operations), failureBehavior: text(args.failure_behavior, 'Integration failure behavior'), dataClassification: classification };
      if (!candidate.operations.length) throw new Error('Integration needs at least one operation');
      upsert(state.structure.integrations, candidate);
      return commit('spec_upsert_integration', candidate.id, `Updated integration “${candidate.name}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'integration'),
  };

  const upsertQuality: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_quality_attribute', description: 'Create or replace one measurable production-quality contract covering accessibility, performance, reliability, security, privacy, or operability.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, category: { type: 'string', enum: ['accessibility', 'performance', 'reliability', 'security', 'privacy', 'operability'] }, requirement: { type: 'string' }, measure: { type: 'string' } }, required: ['id', 'category', 'requirement', 'measure'], additionalProperties: false } } },
    execute: async (args) => {
      const category = args.category as AppStructuredSpecification['qualityAttributes'][number]['category'];
      if (!['accessibility', 'performance', 'reliability', 'security', 'privacy', 'operability'].includes(category)) throw new Error('Unknown quality category');
      const candidate = { id: stableId(args.id, 'Quality attribute'), category, requirement: text(args.requirement, 'Quality requirement'), measure: text(args.measure, 'Quality measure') };
      upsert(state.structure.qualityAttributes, candidate);
      return commit('spec_upsert_quality_attribute', candidate.id, `Updated ${candidate.category} quality contract.`);
    }, permission, describeCall: (args) => String(args.id ?? 'quality attribute'),
  };

  const setDesignBrief: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_set_design_brief', description: 'Set the product-level visual direction shared by future UI generators. Capture tone, concrete design principles, and the accessibility target without prescribing a specific framework.', parameters: { type: 'object', properties: { tone: { type: 'string' }, principles: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'string' } }, accessibility_target: { type: 'string', enum: ['AA', 'AAA'] } }, required: ['tone', 'principles', 'accessibility_target'], additionalProperties: false } } },
    execute: async (args) => {
      const accessibilityTarget = args.accessibility_target as 'AA' | 'AAA';
      if (!['AA', 'AAA'].includes(accessibilityTarget)) throw new Error('Accessibility target must be AA or AAA');
      const principles = strings(args.principles);
      if (principles.length < 2) throw new Error('Design brief needs at least two principles');
      state.structure.designBrief = { tone: text(args.tone, 'Design tone', 1_000), principles, accessibilityTarget };
      return commit('spec_set_design_brief', 'design-brief', 'Updated the visual and accessibility direction.');
    }, permission, describeCall: () => 'update design brief',
  };

  const recordDecision: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_record_decision', description: 'Record a proposed, confirmed, or rejected product/architecture decision with rationale and source interview-message IDs.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, title: { type: 'string' }, decision: { type: 'string' }, rationale: { type: 'string' }, status: { type: 'string', enum: ['proposed', 'confirmed', 'rejected'] }, source_message_ids: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title', 'decision', 'rationale', 'status'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Decision'), title: text(args.title, 'Decision title', 160), decision: text(args.decision, 'Decision'), rationale: text(args.rationale, 'Decision rationale'), status: args.status as 'proposed' | 'confirmed' | 'rejected', sourceMessageIds: strings(args.source_message_ids) };
      if (!['proposed', 'confirmed', 'rejected'].includes(candidate.status)) throw new Error('Unknown decision status');
      upsert(state.structure.decisions, candidate);
      return commit('spec_record_decision', candidate.id, `Recorded decision “${candidate.title}”.`);
    }, permission, describeCall: (args) => String(args.id ?? 'decision'),
  };

  const upsertAcceptance: ToolFunction<Record<string, unknown>> = {
    definition: { type: 'function', function: { name: 'spec_upsert_acceptance_criterion', description: 'Create or replace one measurable acceptance criterion traced to a stable narrative requirement.', parameters: { type: 'object', properties: { id: { type: 'string', pattern: stableIdPattern }, requirement_id: { type: 'string', pattern: stableIdPattern }, description: { type: 'string' }, kind: { type: 'string', enum: ['journey', 'policy', 'data', 'agent', 'accessibility'] } }, required: ['id', 'requirement_id', 'description', 'kind'], additionalProperties: false } } },
    execute: async (args) => {
      const candidate = { id: stableId(args.id, 'Acceptance criterion'), requirementId: stableId(args.requirement_id, 'Requirement'), description: text(args.description, 'Acceptance criterion'), kind: args.kind as AppStructuredSpecification['acceptanceCriteria'][number]['kind'] };
      if (!['journey', 'policy', 'data', 'agent', 'accessibility'].includes(candidate.kind)) throw new Error('Unknown acceptance kind');
      upsert(state.structure.acceptanceCriteria, candidate);
      return commit('spec_upsert_acceptance_criterion', candidate.id, `Updated acceptance criterion ${candidate.id}.`);
    }, permission, describeCall: (args) => String(args.id ?? 'acceptance criterion'),
  };

  const validateDraft: ToolFunction = {
    definition: { type: 'function', function: { name: 'spec_validate_draft', description: 'Run deterministic coverage and reference checks over the current specification draft. Call this after edits and use the result to repair gaps before answering.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
    execute: async () => specificationCoverage(state), permission, describeCall: () => 'validate specification draft',
  };

  return [getSummary, queryNodes, upsertRequirement, upsertPersona, upsertStory, upsertSurface, upsertEntity, upsertWorkflow, upsertAgent, upsertIntegration, upsertQuality, setDesignBrief, recordDecision, upsertAcceptance, validateDraft];
}
