import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ApplicationDiscoveryEvent, ApplicationDiscoverySession, GenerationEffort } from './browser-app.domain.js';
import { AiService } from './ai.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppService } from './browser-app.service.js';
import { createSpecificationTools, specificationCoverage, type SpecificationDraftState } from './application-spec-tools.js';
import type { ControlPlanePrincipal } from './control-plane-auth.guard.js';

@Injectable()
export class ApplicationDiscoveryService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppService) private readonly applications: BrowserAppService,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  async session(appId: string): Promise<ApplicationDiscoverySession> {
    const detail = await this.applications.detail(appId);
    const session = await this.repository.discoverySession(appId);
    if (session.status !== 'running') {
      session.currentSpecRevision = detail.app.specRevision;
      const currentDraft = session.draft?.baseSpecRevision === detail.app.specRevision ? session.draft : undefined;
      if (!currentDraft) session.draft = undefined;
      session.coverage = specificationCoverage(currentDraft
        ? { sections: currentDraft.sections, structure: currentDraft.structure, changes: currentDraft.changes }
        : { sections: detail.specification.sections, structure: detail.specification.structure, changes: [] });
      session.updatedAt = new Date().toISOString();
      await this.repository.saveDiscoverySession(session);
    }
    return session;
  }

  async start(
    appId: string,
    content: unknown,
    principal: ControlPlanePrincipal,
    configuration?: { connector?: unknown; model?: unknown; effort?: unknown },
  ): Promise<ApplicationDiscoverySession> {
    if (typeof content !== 'string' || content.trim().length < 2 || content.trim().length > 8_000) throw new BadRequestException('Discovery answer must contain 2 to 8000 characters');
    const current = await this.applications.detail(appId);
    const session = await this.repository.discoverySession(appId);
    if (session.status === 'running') throw new BadRequestException('A discovery agent is already working on this application');
    const now = new Date().toISOString();
    session.status = 'running';
    session.progress = 5;
    session.phase = 'interpreting';
    session.baseSpecRevision = current.app.specRevision;
    session.draft = {
      baseSpecRevision: current.app.specRevision,
      sections: structuredClone(current.specification.sections),
      structure: structuredClone(current.specification.structure),
      changes: [],
      updatedAt: now,
    };
    session.error = undefined;
    session.messages.push({ id: randomUUID(), role: 'user', content: content.trim(), createdAt: now });
    session.updatedAt = now;
    await this.repository.saveDiscoverySession(session);
    const controller = new AbortController();
    this.controllers.set(appId, controller);
    void this.execute(appId, content.trim(), principal, {
      connector: typeof configuration?.connector === 'string' ? configuration.connector : undefined,
      model: typeof configuration?.model === 'string' ? configuration.model : undefined,
      effort: ['low', 'medium', 'high'].includes(String(configuration?.effort)) ? configuration?.effort as GenerationEffort : 'high',
    }, controller.signal);
    return session;
  }

  async cancel(appId: string): Promise<ApplicationDiscoverySession> {
    const session = await this.session(appId);
    if (session.status !== 'running') return session;
    this.controllers.get(appId)?.abort();
    session.status = 'idle'; session.phase = 'cancelled'; session.updatedAt = new Date().toISOString();
    await this.repository.saveDiscoverySession(session);
    return session;
  }

  private async execute(
    appId: string,
    content: string,
    principal: ControlPlanePrincipal,
    configuration: { connector?: string; model?: string; effort: GenerationEffort },
    signal: AbortSignal,
  ): Promise<void> {
    let sequence = (await this.repository.discoverySession(appId)).events.at(-1)?.sequence ?? 0;
    const emit = async (type: ApplicationDiscoveryEvent['type'], actor: string, title: string, detail?: string, durationMs?: number, metadata?: ApplicationDiscoveryEvent['metadata']) => {
      const event: ApplicationDiscoveryEvent = { id: randomUUID(), sequence: ++sequence, type, actor, title, ...(detail ? { detail } : {}), ...(durationMs === undefined ? {} : { durationMs }), ...(metadata ? { metadata } : {}), createdAt: new Date().toISOString() };
      await this.repository.appendDiscoveryEvent(appId, event);
    };
    try {
      const detail = await this.applications.detail(appId);
      const session = await this.repository.discoverySession(appId);
      const workingDraft = session.draft?.baseSpecRevision === detail.app.specRevision ? session.draft : undefined;
      const state: SpecificationDraftState = {
        sections: structuredClone(workingDraft?.sections ?? detail.specification.sections),
        structure: structuredClone(workingDraft?.structure ?? detail.specification.structure),
        changes: structuredClone(workingDraft?.changes ?? []),
      };
      await emit('status', 'Discovery orchestrator', 'Preparing the structured application definition', `Pinned specification revision ${detail.app.specRevision} and loaded the ${detail.app.profile.applicationType.replaceAll('_', ' ')} profile.`);
      await this.repository.appendDiscoveryEvent(appId, { id: randomUUID(), sequence: ++sequence, type: 'thinking', actor: 'Discovery orchestrator', title: 'Selecting specialist specification tools', detail: 'The application profile constrains tenancy, identity, execution placement, data sensitivity, agent authority, and compatible generators.', createdAt: new Date().toISOString() }, { progress: 18, phase: 'specification-analysis' });
      const profileContext = JSON.stringify({
        name: detail.app.name,
        description: detail.app.description,
        profile: detail.app.profile,
        generator: detail.app.generatorId ?? 'specification-only',
        recentConversation: (await this.repository.discoverySession(appId)).messages.slice(-10),
      });
      const result = await this.ai.discoverSpecification(
        profileContext,
        content,
        createSpecificationTools(state, async (change, draftState) => {
          const updatedAt = new Date().toISOString();
          const coverage = specificationCoverage(draftState);
          await this.repository.updateDiscoveryDraft(appId, {
            baseSpecRevision: detail.app.specRevision,
            sections: structuredClone(draftState.sections),
            structure: structuredClone(draftState.structure),
            changes: structuredClone(draftState.changes),
            updatedAt,
          }, coverage, { progress: Math.min(72, 28 + draftState.changes.length * 4), phase: 'updating-definition', updatedAt });
          await emit('specification', 'Live application definition', change.summary, `Updated ${change.targetId} in the working specification.`, undefined, {
            targetId: change.targetId,
            tool: change.tool,
            coverage: coverage.score,
          });
        }),
        { ...configuration, userId: principal.subject },
        (event) => emit(event.type === 'tool' ? 'tool' : 'thinking', 'Discovery orchestrator', event.title, event.detail, event.durationMs, event.metadata),
        signal,
      );
      if (signal.aborted) return;
      await this.repository.appendDiscoveryEvent(appId, { id: randomUUID(), sequence: ++sequence, type: 'status', actor: 'Specification validator', title: 'Validating the proposed definition', detail: `${state.changes.length} focused specification operation${state.changes.length === 1 ? '' : 's'} completed.`, createdAt: new Date().toISOString() }, { progress: 78, phase: 'validating' });
      let nextRevision = detail.app.specRevision;
      if (state.changes.length) {
        const revised = await this.applications.reviseSpecification(appId, { expectedRevision: detail.app.specRevision, sections: state.sections, structure: state.structure });
        nextRevision = revised.specification.revision;
      }
      const latest = await this.repository.discoverySession(appId);
      latest.messages.push({ id: randomUUID(), role: 'assistant', content: result.reply, createdAt: new Date().toISOString() });
      latest.status = 'idle'; latest.progress = 100; latest.phase = 'awaiting-user'; latest.currentSpecRevision = nextRevision;
      latest.coverage = specificationCoverage(state); latest.draft = undefined; latest.updatedAt = new Date().toISOString(); latest.error = undefined;
      await this.repository.saveDiscoverySession(latest);
      await emit('result', 'Discovery orchestrator', 'Application definition updated', state.changes.length ? `${state.changes.length} traceable changes were saved as specification revision ${nextRevision}.` : 'No semantic changes were needed for this answer.', undefined, { specificationRevision: nextRevision, coverage: latest.coverage.score, toolCalls: result.metrics.toolCalls, reasoningTokens: result.metrics.reasoningTokens });
      const completed = await this.repository.discoverySession(appId);
      completed.status = 'idle'; completed.progress = 100; completed.phase = 'awaiting-user'; completed.currentSpecRevision = nextRevision; completed.coverage = latest.coverage; completed.updatedAt = new Date().toISOString();
      await this.repository.saveDiscoverySession(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.repository.discoverySession(appId);
      latest.status = 'failed'; latest.phase = 'failed'; latest.error = message; latest.updatedAt = new Date().toISOString();
      await this.repository.saveDiscoverySession(latest);
      await emit('error', 'Discovery orchestrator', 'Discovery run failed safely', message);
    } finally {
      this.controllers.delete(appId);
    }
  }
}
