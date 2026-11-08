import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  BuilderAgent,
  ConnectorSummary,
  DevelopmentRun,
  Project,
  Release,
  SpecArtifact,
} from './domain.js';
import { AiService } from './ai.service.js';
import { StoreService } from './store.service.js';

@Injectable()
export class PlatformService {
  constructor(
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  bootstrap(includeBuilderSystem = false) {
    const state = this.store.snapshot();
    return {
      ...state,
      agents: includeBuilderSystem ? state.agents : [],
      builderVersion: includeBuilderSystem ? state.builderVersion : '',
      connectors: this.connectors(),
      aiAvailable: this.ai.available(),
    };
  }

  project(id: string): Project {
    const project = this.store.snapshot().projects.find((candidate) => candidate.id === id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async interview(projectId: string, content: string) {
    if (!content.trim()) throw new BadRequestException('Message is required');
    const project = this.project(projectId);
    const context = project.prd.map((section) => `${section.title}: ${section.body}`).join('\n');
    const reply = await this.ai.interview(content.trim(), context);
    const createdAt = new Date().toISOString();
    this.store.mutate((state) => {
      const target = state.projects.find((candidate) => candidate.id === projectId)!;
      target.interview.push(
        { id: randomUUID(), role: 'user', content: content.trim(), createdAt },
        { id: randomUUID(), role: 'assistant', content: reply, createdAt },
      );
      target.updatedAt = createdAt;
      target.specVersion += 1;
      target.readiness = Math.min(96, target.readiness + 2);
    });
    return { reply, project: this.project(projectId) };
  }

  updateArtifact(projectId: string, artifactId: string, patch: Partial<SpecArtifact>): SpecArtifact {
    let updated: SpecArtifact | undefined;
    this.store.mutate((state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new NotFoundException('Project not found');
      const artifact = project.artifacts.find((candidate) => candidate.id === artifactId);
      if (!artifact) throw new NotFoundException('Artifact not found');
      if (patch.id && patch.id !== artifactId) throw new BadRequestException('Artifact id is immutable');
      Object.assign(artifact, {
        ...patch,
        id: artifact.id,
        type: artifact.type,
        links: patch.links ?? artifact.links,
        position: patch.position ?? artifact.position,
      });
      project.specVersion += 1;
      project.updatedAt = new Date().toISOString();
      updated = structuredClone(artifact);
    });
    return updated!;
  }

  approvePrd(projectId: string): Project {
    this.store.mutate((state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new NotFoundException('Project not found');
      project.prd.forEach((section) => (section.status = 'confirmed'));
      project.stage = 'design';
      project.readiness = Math.max(project.readiness, 75);
      project.specVersion += 1;
      project.updatedAt = new Date().toISOString();
    });
    return this.project(projectId);
  }

  updateAgent(id: string, patch: Partial<BuilderAgent>): BuilderAgent {
    if (patch.effort && !['low', 'medium', 'high'].includes(patch.effort)) {
      throw new BadRequestException('Builder-agent effort must be low, medium, or high');
    }
    let updated: BuilderAgent | undefined;
    this.store.mutate((state) => {
      const agent = state.agents.find((candidate) => candidate.id === id);
      if (!agent) throw new NotFoundException('Builder agent not found');
      Object.assign(agent, {
        ...patch,
        id: agent.id,
        version: patch.version ?? agent.version + 1,
      });
      updated = structuredClone(agent);
    });
    return updated!;
  }

  startRun(projectId: string): DevelopmentRun {
    this.project(projectId);
    const runId = randomUUID();
    const run: DevelopmentRun = {
      id: runId,
      projectId,
      branch: `managed/spec-v${this.project(projectId).specVersion}`,
      workspace: `workspace-${runId.slice(0, 8)}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: ([
        ['checkout', 'Restore workspace', 'Checkout canonical Git state and pin builder configuration'],
        ['generate', 'Generate modules', 'Implement the next vertical slice from approved requirements'],
        ['unit', 'Unit & contract tests', 'Validate module contracts, invariants, and agent response schemas'],
        ['integration', 'Integration suite', 'Run cross-module, connector, tenancy, and browser journeys'],
        ['review', 'Independent review', 'Architecture, security, DRY/KISS, dependency, and policy review'],
        ['release', 'Build preview release', 'Hermetic build, SBOM, provenance, signature, and smoke checks'],
      ] as Array<[string, string, string]>).map(([id, label, detail], index) => ({
        id,
        label,
        detail,
        status: index === 0 ? 'running' : 'pending',
      })),
    };
    this.store.mutate((state) => state.runs.unshift(run));
    this.advanceRun(runId, 0);
    return run;
  }

  promote(releaseId: string): Release {
    const snapshot = this.store.snapshot();
    const requested = snapshot.releases.find((candidate) => candidate.id === releaseId);
    if (!requested) throw new NotFoundException('Release not found');
    const existingActive = snapshot.releases.find(
      (candidate) =>
        candidate.projectId === requested.projectId &&
        candidate.environment === 'production' &&
        candidate.status === 'active' &&
        candidate.artifactDigest === requested.artifactDigest,
    );
    if (existingActive) return existingActive;

    let promoted: Release | undefined;
    this.store.mutate((state) => {
      const source = state.releases.find((candidate) => candidate.id === releaseId);
      if (!source) throw new NotFoundException('Release not found');
      state.releases.forEach((release) => {
        if (release.projectId === source.projectId && release.environment === 'production') {
          release.status = 'superseded';
        }
      });
      promoted = {
        ...source,
        id: randomUUID(),
        environment: 'production',
        status: 'active',
        createdAt: new Date().toISOString(),
        url: `https://${source.projectId}.onering.app`,
      };
      state.releases.unshift(promoted);
      const project = state.projects.find((candidate) => candidate.id === source.projectId);
      if (project) project.stage = 'released';
    });
    return promoted!;
  }

  connectors(): ConnectorSummary[] {
    return [
      { id: 'openai-main', name: 'OpenAI', vendor: 'OpenAI', kind: 'llm', configured: Boolean(process.env.OPENAI_API_KEY), model: 'gpt-5.6-terra' },
      { id: 'anthropic-main', name: 'Anthropic', vendor: 'Anthropic', kind: 'llm', configured: Boolean(process.env.ANTHROPIC_API_KEY), model: 'claude-sonnet-5' },
      { id: 'google-main', name: 'Google AI', vendor: 'Google', kind: 'llm', configured: Boolean(process.env.GOOGLE_API_KEY), model: 'gemini-3.6-flash' },
      { id: 'serper', name: 'Serper Search', vendor: 'Serper', kind: 'search', configured: Boolean(process.env.SERPER_KEY) },
      { id: 'zenrows', name: 'ZenRows', vendor: 'ZenRows', kind: 'scrape', configured: Boolean(process.env.ZENROWS_API_KEY) },
    ];
  }

  private advanceRun(runId: string, index: number): void {
    setTimeout(() => {
      let completed = false;
      let projectId = '';
      this.store.mutate((state) => {
        const run = state.runs.find((candidate) => candidate.id === runId);
        if (!run || run.status !== 'running') return;
        projectId = run.projectId;
        const step = run.steps[index];
        if (!step) return;
        step.status = 'passed';
        step.durationMs = 580 + index * 173;
        const next = run.steps[index + 1];
        if (next) next.status = 'running';
        else {
          completed = true;
          run.status = 'passed';
          run.completedAt = new Date().toISOString();
          const project = state.projects.find((candidate) => candidate.id === run.projectId);
          if (project) {
            project.stage = 'verification';
            project.readiness = Math.max(project.readiness, 92);
          }
          const digest = createHash('sha256').update(`${run.id}:${run.startedAt}`).digest('hex');
          state.releases.unshift({
            id: randomUUID(),
            projectId: run.projectId,
            version: `0.${state.releases.length + 12}.0-preview`,
            environment: 'preview',
            status: 'ready',
            artifactDigest: `sha256:${digest.slice(0, 16)}`,
            sourceCommit: digest.slice(16, 23),
            createdAt: new Date().toISOString(),
            url: `https://${run.projectId}-${run.id.slice(0, 5)}.preview.onering.dev`,
            evidence: { tests: 164, coverage: 91, policyChecks: 27 },
          });
        }
      });
      if (!completed && projectId) this.advanceRun(runId, index + 1);
    }, 650);
  }
}
