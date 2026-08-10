import { describe, expect, it } from 'vitest';
import { createSpecificationTools, specificationCoverage, type SpecificationDraftState } from './application-spec-tools.js';

function draft(): SpecificationDraftState {
  return {
    sections: [
      { id: 'purpose', title: 'Purpose', body: 'Enable an operator to complete the primary business outcome safely and confidently.' },
      { id: 'people', title: 'People', body: 'Operators edit work while administrators control access boundaries and workspace policy.' },
      { id: 'journeys', title: 'Journeys', body: 'The primary workflow preserves entered work through exceptions and provides a clear recovery path.' },
      { id: 'data', title: 'Data', body: 'Work records have explicit ownership, validation, sensitivity, and lifecycle rules.' },
      { id: 'quality', title: 'Quality', body: 'Core journeys have measurable accessibility, reliability, security, and performance targets.' },
    ],
    structure: {
      purpose: 'Enable the primary outcome.', audience: 'team',
      personas: [{ id: 'operator', name: 'Operator', description: 'Completes the work.', goals: ['Finish safely'], painPoints: ['Manual handoffs'], roleIds: ['editor'] }],
      userStories: [{ id: 'complete-work', title: 'Complete work', personaId: 'operator', statement: 'As an operator I complete the work.', priority: 'must', surfaceIds: ['workspace'], workflowIds: ['primary-flow'], acceptanceCriterionIds: ['accept-purpose'] }],
      roles: [{ id: 'editor', name: 'Editor', description: 'Completes work.' }],
      pages: [{ id: 'workspace', name: 'Workspace', path: '/', purpose: 'Complete work.', public: false, roleIds: ['editor'], states: ['loading', 'empty', 'error', 'forbidden', 'ready'], entityIds: ['record'], workflowIds: ['primary-flow'], agentIds: [], acceptanceCriterionIds: ['accept-purpose'] }],
      entities: [{ id: 'record', name: 'Record', description: 'The work record.', fields: [{ id: 'title', type: 'string', required: true, description: 'Title.' }] }],
      workflows: [{ id: 'primary-flow', name: 'Primary flow', description: 'Complete the work.', trigger: 'User starts.', steps: [{ id: 'start', type: 'browser_action', description: 'Start work.' }] }],
      agents: [], integrations: [], decisions: [
        { id: 'managed-identity', title: 'Managed identity', decision: 'Use managed application identity.', rationale: 'Keeps authentication outside generated code.', status: 'confirmed', sourceMessageIds: [] },
        { id: 'browser-execution', title: 'Browser execution', decision: 'Run product workflows in the browser.', rationale: 'Matches the selected application profile.', status: 'confirmed', sourceMessageIds: [] },
      ], qualityAttributes: [],
      designBrief: { tone: 'Clear', principles: ['Show status', 'Support recovery'], accessibilityTarget: 'AA' },
      acceptanceCriteria: ['purpose', 'people', 'journeys', 'data', 'quality'].map((requirementId) => ({ id: `accept-${requirementId}`, requirementId, description: `Verify ${requirementId}.`, kind: requirementId === 'quality' ? 'accessibility' as const : 'journey' as const })),
    },
    changes: [],
  };
}

describe('structured application specification tools', () => {
  it('performs focused, validated upserts instead of replacing the document', async () => {
    const state = draft();
    const observed: Array<{ targetId: string; changeCount: number }> = [];
    const tools = createSpecificationTools(state, (change, current) => observed.push({ targetId: change.targetId, changeCount: current.changes.length }));
    const invoke = async (name: string, input: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.definition.function.name === name);
      if (!tool) throw new Error(`Missing ${name}`);
      return (tool.execute as (args: Record<string, unknown>, context?: unknown) => Promise<unknown>)(input, {});
    };

    await invoke('spec_upsert_integration', { id: 'crm', name: 'CRM', purpose: 'Read customer renewal context.', connector: 'microsoft-main', operations: ['read-account'], failure_behavior: 'Show stale context and allow a retry.', data_classification: 'confidential' });
    await invoke('spec_upsert_quality_attribute', { id: 'reliable-recovery', category: 'reliability', requirement: 'Users can recover from connector failures.', measure: 'All connector failures expose a retry and preserve entered work.' });
    await invoke('spec_upsert_quality_attribute', { id: 'keyboard-access', category: 'accessibility', requirement: 'Core journeys work from a keyboard.', measure: 'WCAG 2.2 AA automated and manual keyboard checks pass.' });
    await invoke('spec_upsert_quality_attribute', { id: 'secure-boundaries', category: 'security', requirement: 'Authorization is enforced outside generated code.', measure: 'Negative role and tenancy tests pass.' });
    await invoke('spec_upsert_quality_attribute', { id: 'responsive-workspace', category: 'performance', requirement: 'The workspace responds quickly to user input.', measure: 'Measured interaction latency remains under 200 milliseconds.' });
    await invoke('spec_set_design_brief', { tone: 'Calm, capable, and operationally clear.', principles: ['Lead with the next decision', 'Expose status and recovery', 'Keep dense data scannable'], accessibility_target: 'AA' });

    expect(state.structure.integrations).toEqual([expect.objectContaining({ id: 'crm', operations: ['read-account'], dataClassification: 'confidential' })]);
    expect(state.structure.qualityAttributes).toHaveLength(4);
    expect(state.structure.designBrief.principles).toHaveLength(3);
    expect(state.sections).toHaveLength(5);
    expect(state.changes.map((change) => change.tool)).toEqual(['spec_upsert_integration', 'spec_upsert_quality_attribute', 'spec_upsert_quality_attribute', 'spec_upsert_quality_attribute', 'spec_upsert_quality_attribute', 'spec_set_design_brief']);
    expect(observed).toEqual([
      { targetId: 'crm', changeCount: 1 }, { targetId: 'reliable-recovery', changeCount: 2 },
      { targetId: 'keyboard-access', changeCount: 3 }, { targetId: 'secure-boundaries', changeCount: 4 },
      { targetId: 'responsive-workspace', changeCount: 5 }, { targetId: 'design-brief', changeCount: 6 },
    ]);
    expect(specificationCoverage(state)).toMatchObject({ score: 100, missing: [], contradictions: [] });
  });

  it('rejects invalid cross references deterministically', () => {
    const state = draft();
    state.structure.pages[0]!.entityIds.push('missing-entity');
    expect(specificationCoverage(state).contradictions).toContain('workspace references missing entity missing-entity');
    expect(specificationCoverage(state).score).toBeLessThan(100);
  });

  it('rejects a product purpose that is still connected to unrelated seed structures', () => {
    const state = draft();
    state.structure.purpose = 'Create a beautiful editorial blog for writers to publish and readers to enjoy articles.';
    state.structure.pages = [{ ...state.structure.pages[0]!, id: 'task-board', name: 'Task board', purpose: 'Coordinate team tasks.' }];
    state.structure.entities = [{ ...state.structure.entities[0]!, id: 'tasks', name: 'Task', description: 'A team task.' }];
    const coverage = specificationCoverage(state);
    expect(coverage.contradictions).toContain('Editorial product intent has no article, post, or story entity');
    expect(coverage.contradictions).toContain('Editorial product intent is still connected to unrelated task-demo structures');
  });
});
