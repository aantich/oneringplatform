import { useMemo, useState } from 'react';
import type { AppStructuredSpecification } from '../types';
import type { SpecArtifact } from '../types';
import { VisualCanvas } from './VisualCanvas';

type PositionMap = Record<string, { x: number; y: number }>;

function artifact(
  id: string,
  type: SpecArtifact['type'],
  name: string,
  description: string,
  position: { x: number; y: number },
  links: SpecArtifact['links'],
  details: Record<string, unknown>,
): SpecArtifact {
  return { id, type, name, description, position, links, details, tags: [], status: 'approved' };
}

function graph(structure: AppStructuredSpecification, positions: PositionMap): SpecArtifact[] {
  const place = (id: string, column: number, index: number) => positions[id] ?? { x: column * 270, y: index * 190 };
  const artifacts: SpecArtifact[] = [];
  structure.personas.forEach((persona, index) => artifacts.push(artifact(
    `persona:${persona.id}`, 'story', persona.name, persona.description, place(`persona:${persona.id}`, 0, index),
    structure.userStories.filter((story) => story.personaId === persona.id).map((story) => ({ targetId: `story:${story.id}`, relation: 'performs' })),
    { goals: persona.goals, painPoints: persona.painPoints, roles: persona.roleIds },
  )));
  structure.userStories.forEach((story, index) => artifacts.push(artifact(
    `story:${story.id}`, 'story', story.title, story.statement, place(`story:${story.id}`, 1, index),
    [
      ...story.surfaceIds.map((id) => ({ targetId: `surface:${id}`, relation: 'experienced in' })),
      ...story.workflowIds.map((id) => ({ targetId: `workflow:${id}`, relation: 'implemented by' })),
      ...story.acceptanceCriterionIds.map((id) => ({ targetId: `acceptance:${id}`, relation: 'verified by' })),
    ], { priority: story.priority, persona: story.personaId ?? 'unassigned' },
  )));
  structure.pages.forEach((page, index) => artifacts.push(artifact(
    `surface:${page.id}`, 'screen', page.name, page.purpose, place(`surface:${page.id}`, 2, index),
    [
      ...page.entityIds.map((id) => ({ targetId: `entity:${id}`, relation: 'uses data' })),
      ...page.workflowIds.map((id) => ({ targetId: `workflow:${id}`, relation: 'hosts' })),
      ...page.agentIds.map((id) => ({ targetId: `agent:${id}`, relation: 'uses' })),
    ], { path: page.path, public: page.public, states: page.states, roles: page.roleIds },
  )));
  structure.entities.forEach((entity, index) => artifacts.push(artifact(
    `entity:${entity.id}`, 'entity', entity.name, entity.description, place(`entity:${entity.id}`, 3, index), [],
    { fields: entity.fields.map((field) => `${field.id}: ${field.type}${field.required ? ' required' : ''}`) },
  )));
  structure.workflows.forEach((workflow, index) => artifacts.push(artifact(
    `workflow:${workflow.id}`, 'workflow', workflow.name, workflow.description, place(`workflow:${workflow.id}`, 3, structure.entities.length + index),
    workflow.steps.some((step) => step.type === 'agent') && structure.agents[0] ? [{ targetId: `agent:${structure.agents[0].id}`, relation: 'uses' }] : [],
    { trigger: workflow.trigger, steps: workflow.steps.map((step) => `${step.type}: ${step.description}`) },
  )));
  structure.agents.forEach((agent, index) => artifacts.push(artifact(
    `agent:${agent.id}`, 'agent', agent.name, agent.purpose, place(`agent:${agent.id}`, 4, index),
    agent.toolIds.flatMap((toolId) => { const integration = structure.integrations.find((candidate) => candidate.id === toolId.split(':')[0]); return integration ? [{ targetId: `integration:${integration.id}`, relation: 'calls' }] : []; }),
    { connector: agent.connector, model: agent.model, tools: agent.toolIds, iterations: agent.maximumIterations, approval: agent.humanApprovalRequired },
  )));
  structure.integrations.forEach((integration, index) => artifacts.push(artifact(
    `integration:${integration.id}`, 'integration', integration.name, integration.purpose, place(`integration:${integration.id}`, 5, index), [],
    { connector: integration.connector ?? 'unselected', operations: integration.operations, failureBehavior: integration.failureBehavior, classification: integration.dataClassification },
  )));
  structure.acceptanceCriteria.forEach((criterion, index) => artifacts.push(artifact(
    `acceptance:${criterion.id}`, 'test', criterion.id, criterion.description,
    place(`acceptance:${criterion.id}`, index % 2, Math.max(structure.personas.length, structure.userStories.length) + Math.floor(index / 2)), [],
    { requirement: criterion.requirementId, evidenceType: criterion.kind },
  )));
  return artifacts;
}

export function ApplicationBlueprint({ structure, revision, onStructure }: { structure: AppStructuredSpecification; revision: number; onStructure?: (structure: AppStructuredSpecification) => void }) {
  const [positions, setPositions] = useState<PositionMap>({});
  const artifacts = useMemo(() => graph(structure, positions), [structure, positions]);
  const updateDescription = (artifactId: string, description: string) => {
    const [kind, id] = artifactId.split(':');
    if (!id) return;
    if (!onStructure) return;
    if (kind === 'persona') onStructure({ ...structure, personas: structure.personas.map((item) => item.id === id ? { ...item, description } : item) });
    if (kind === 'story') onStructure({ ...structure, userStories: structure.userStories.map((item) => item.id === id ? { ...item, statement: description } : item) });
    if (kind === 'surface') onStructure({ ...structure, pages: structure.pages.map((item) => item.id === id ? { ...item, purpose: description } : item) });
    if (kind === 'entity') onStructure({ ...structure, entities: structure.entities.map((item) => item.id === id ? { ...item, description } : item) });
    if (kind === 'workflow') onStructure({ ...structure, workflows: structure.workflows.map((item) => item.id === id ? { ...item, description } : item) });
    if (kind === 'agent') onStructure({ ...structure, agents: structure.agents.map((item) => item.id === id ? { ...item, purpose: description } : item) });
    if (kind === 'integration') onStructure({ ...structure, integrations: structure.integrations.map((item) => item.id === id ? { ...item, purpose: description } : item) });
    if (kind === 'acceptance') onStructure({ ...structure, acceptanceCriteria: structure.acceptanceCriteria.map((item) => item.id === id ? { ...item, description } : item) });
  };
  return <div className="application-blueprint"><div className="blueprint-context"><strong>Specification revision {revision}</strong><span>{artifacts.length} traceable nodes · {onStructure ? 'semantic edits update the draft · ' : ''}layout changes are presentation-only</span></div><VisualCanvas artifacts={artifacts} onMove={(id, position) => setPositions((current) => ({ ...current, [id]: position }))} onUpdate={(id, patch) => { if (typeof patch.description === 'string') updateDescription(id, patch.description); }}/></div>;
}
