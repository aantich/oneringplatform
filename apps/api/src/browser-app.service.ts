import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import type { AppGraphChangeSet, AppMembership, ApplicationProfile, AppStructuredSpecification, AppTenancyMode, BrowserApp, BrowserAppSpecification, BrowserGenerationAgentConfiguration, BrowserGenerationEvent, BrowserGenerationJob, BrowserGenerationOptions, BrowserGenerationProfile, EndTenant, GenerationEffort, RouteBinding, TenancyRevision, ThemeRevision } from './browser-app.domain.js';
import { AiService } from './ai.service.js';
import { ApplicationGeneratorRegistry } from './application-generator.registry.js';
import { normalizeApplicationProfile } from './application-profile.js';
import { specificationCoverage } from './application-spec-tools.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppThemeCompilerService } from './browser-app-theme-compiler.service.js';
import { StoreService } from './store.service.js';
import { seedTheme, themeStarters } from './browser-app.seed.js';
import type { ControlPlanePrincipal } from './control-plane-auth.guard.js';

@Injectable()
export class BrowserAppService {
  private readonly generationControllers = new Map<string, AbortController>();
  private readonly generationSequences = new Map<string, number>();

  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppBuildService) private readonly builder: BrowserAppBuildService,
    @Inject(BrowserAppThemeCompilerService) private readonly themeCompiler: BrowserAppThemeCompilerService,
    @Inject(ApplicationGeneratorRegistry) private readonly generators: ApplicationGeneratorRegistry,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(StoreService) private readonly platformStore: StoreService,
  ) {}

  async list(principal?: ControlPlanePrincipal) {
    const allApps = await this.repository.listApps();
    const apps = principal?.activePlatformOrganizationId
      ? allApps.filter((app) => app.platformOrganizationId === principal.activePlatformOrganizationId)
      : [];
    return Promise.all(apps.map(async (app) => {
      const detail = await this.repository.detail(app.id);
      return {
        ...app,
        moduleCount: detail?.modules.length ?? 0,
        routeCount: detail?.routes.length ?? 0,
        entityCount: detail?.schemas.length ?? 0,
        release: detail?.releases.find((release) => release.status === 'active'),
        url: `/apps/${app.publicKey}/`,
      };
    }));
  }

  generationOptions(): BrowserGenerationOptions {
    const connectors = this.ai.generationConnectors();
    const configuredConnector = connectors.find((connector) => connector.configured);
    const templates = this.platformStore.snapshot().agents.filter((agent) => (
      agent.enabled && ['Design', 'Implementation', 'Verification'].includes(agent.stage)
    ));
    const configurationFor = (template: typeof templates[number]): BrowserGenerationAgentConfiguration => {
      const requestedConnector = connectors.find((connector) => connector.id === template.connector);
      const connector = requestedConnector?.configured ? requestedConnector : configuredConnector ?? requestedConnector ?? connectors[0];
      if (!connector) throw new Error('No generation connectors are registered');
      const model = connector.models.some((candidate) => candidate.id === template.model)
        ? template.model
        : connector.models.find((candidate) => candidate.preferred)?.id ?? connector.models[0]?.id;
      if (!model) throw new Error(`No active models are registered for ${connector.name}`);
      return {
        templateId: template.id, templateVersion: template.version, name: template.name, role: template.role,
        connector: connector.id, model, effort: template.effort ?? 'medium',
      };
    };
    const agents = templates.map((template) => ({
      id: template.id, name: template.name, role: template.role, stage: template.stage,
      defaultConfiguration: configurationFor(template),
    }));
    const defaults = ['implementer', 'reviewer']
      .map((id) => agents.find((agent) => agent.id === id)?.defaultConfiguration)
      .filter((agent): agent is BrowserGenerationAgentConfiguration => Boolean(agent));
    return {
      agents,
      connectors,
      efforts: [
        { id: 'low', name: 'Low', description: 'Fast, economical reasoning for narrow refinements.' },
        { id: 'medium', name: 'Medium', description: 'Balanced reasoning for most application work.' },
        { id: 'high', name: 'High', description: 'Deep reasoning for architecture, security, and difficult changes.' },
      ],
      defaultProfile: { agents: defaults.length ? defaults : agents.slice(0, 1).map((agent) => agent.defaultConfiguration), updatedAt: new Date().toISOString() },
      maximumAgents: 3,
    };
  }

  async create(input: { name?: unknown; description?: unknown; mode?: unknown; profile?: unknown }, principal: ControlPlanePrincipal) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) throw new BadRequestException('App name must contain 2 to 80 characters');
    if (typeof input.description !== 'string' || input.description.trim().length < 3 || input.description.trim().length > 280) throw new BadRequestException('Description must contain 3 to 280 characters');
    const requestedMode = typeof input.mode === 'string' ? input.mode : (input.profile as { tenancyMode?: unknown } | undefined)?.tenancyMode;
    const modes: AppTenancyMode[] = ['personal', 'team', 'multi_organization'];
    if (typeof requestedMode !== 'string' || !modes.includes(requestedMode as AppTenancyMode)) throw new BadRequestException('Unknown app tenancy mode');
    const profile = normalizeApplicationProfile(input.profile, requestedMode as AppTenancyMode);
    if (profile.tenancyMode !== requestedMode) throw new BadRequestException('Application profile tenancy must match the selected tenancy mode');
    const requestedOwner = principal.activePlatformOrganizationId;
    if (!requestedOwner) throw new BadRequestException('An active platform organization is required');
    const base = input.name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'app';
    let appId = base;
    for (let suffix = 1; await this.repository.findApp(appId); suffix += 1) appId = `${base}-${suffix}`;
    const now = new Date().toISOString();
    const initial = this.initialSpecification(input.name.trim(), input.description.trim(), profile);
    const generator = this.generators.generatorFor(profile);
    const app: BrowserApp = {
      id: appId, publicKey: appId, platformOrganizationId: requestedOwner, name: input.name.trim(), description: input.description.trim(),
      runtimeProfile: profile.applicationType === 'browser_data' ? 'browser_data' : 'specification_only', profile,
      generatorId: generator?.available ? generator.id : undefined,
      projectId: appId, specRevision: 1, generatedFromSpecRevision: 0,
      sourceRevision: 0, schemaRevision: 0, policyRevision: 0, connectorRevision: 0, themeRevision: 1,
      tenancyRevision: 1, tenancyMode: profile.tenancyMode,
      generationProfile: this.generationOptions().defaultProfile, lifecycleStatus: 'draft', specificationApprovalStatus: 'draft', createdAt: now, updatedAt: now,
    };
    const specification: BrowserAppSpecification = {
      id: randomUUID(), appId, revision: 1, projectId: appId, status: 'approved', createdAt: now,
      sections: initial.sections, structure: initial.structure,
    };
    const starter = themeStarters.find((candidate) => candidate.id === seedTheme.starterId)!;
    const theme: ThemeRevision = {
      id: randomUUID(), appId, revision: 1, name: starter.name, description: starter.description, starterId: starter.id,
      tokens: structuredClone(starter.tokens), componentVariants: structuredClone(starter.componentVariants), customCss: '',
      status: 'draft', createdBy: 'system', accessibility: this.themeCompiler.accessibility(starter.tokens), createdAt: now,
    };
    const tenancy: TenancyRevision = {
      id: randomUUID(), appId, revision: 1, mode: profile.tenancyMode, organizationLabel: 'Organization',
      allowMultipleMemberships: profile.tenancyMode === 'multi_organization', status: 'published', createdBy: 'user', createdAt: now,
    };
    const tenants: EndTenant[] = profile.tenancyMode === 'multi_organization' ? [{ id: randomUUID(), appId, slug: 'primary', name: 'Primary organization', status: 'active', createdAt: now }] : [];
    const ownerMembership: AppMembership = {
      id: randomUUID(), appId, userId: principal.subject,
      email: principal.email ?? `${principal.subject.replace(/[^a-z0-9._-]/gi, '-')}@users.invalid`,
      displayName: principal.email?.split('@')[0] ?? 'Application owner', tenantId: tenants[0]?.id,
      roles: ['admin'], status: 'active', version: 1, createdAt: now, updatedAt: now,
    };
    const demoRoles = profile.tenancyMode === 'personal' ? [] as const : ['viewer', 'editor', 'admin'] as const;
    const demoMemberships: AppMembership[] = process.env.NODE_ENV === 'production' ? [] : demoRoles.map((role) => ({
      id: randomUUID(), appId, userId: `demo-${role}`, email: `${role}@${appId}.demo`, displayName: `Demo ${role}`,
      tenantId: tenants[0]?.id, roles: [role], status: 'active', version: 1, createdAt: now, updatedAt: now,
    }));
    const memberships = [ownerMembership, ...demoMemberships];
    await this.repository.createAppGraph({ app, specification, modules: [], routes: [], schemas: [], policies: [], connectors: [], agents: [], theme, tenancy, tenants, memberships, bindings: [] });
    return { publication: null, detail: await this.detail(appId) };
  }

  generatorsList() {
    return this.generators.list();
  }

  private initialSpecification(name: string, description: string, profile: ApplicationProfile): Pick<BrowserAppSpecification, 'sections' | 'structure'> {
    const sections = [
      { id: 'purpose', title: 'Purpose and outcome', body: description },
      { id: 'people', title: 'People and permissions', body: 'Discovery must identify the people using this application, their goals, responsibilities, access boundaries, and collaboration model.' },
      { id: 'journeys', title: 'Journeys and workflows', body: 'Discovery must define the important end-to-end journeys, decisions, exceptions, approvals, and recovery behavior.' },
      { id: 'data', title: 'Information and lifecycle', body: 'Discovery must define authoritative entities, relationships, validation, ownership, sensitivity, retention, and lifecycle.' },
      { id: 'guardrails', title: 'Security and agent guardrails', body: 'Privileged changes require the appropriate role. Agent suggestions never perform consequential actions without explicit policy and human approval.' },
      { id: 'quality', title: 'Production qualities', body: 'Provide accessible experiences with measurable performance, reliability, security, privacy, and operational behavior.' },
    ];
    const criterionIds = sections.map((section) => `accept-${section.id}`);
    const roles = [
      { id: 'public', name: 'Public visitor', description: 'Can use explicitly public pages and data.' },
      { id: 'viewer', name: 'Member', description: 'Can read private workspace data.' },
      { id: 'editor', name: 'Editor', description: 'Can create and edit workspace data.' },
      { id: 'admin', name: 'Administrator', description: 'Can manage data and workspace settings.' },
    ];
    const entity = {
      id: 'records', name: 'Record', description: 'A secured workspace record.', fields: [
        { id: 'title', type: 'string' as const, required: true, description: 'Title' },
        { id: 'description', type: 'string' as const, required: false, description: 'Description' },
        { id: 'status', type: 'enum' as const, required: true, description: 'Current status' },
        { id: 'visibility', type: 'enum' as const, required: true, description: 'private or public' },
      ],
    };
    const pages: AppStructuredSpecification['pages'] = [
      { id: 'home', name: 'Overview', path: '/', purpose: description, public: true, roleIds: roles.map((role) => role.id), states: ['loading', 'empty', 'error', 'ready'], entityIds: ['records'], workflowIds: [], agentIds: [], acceptanceCriterionIds: criterionIds },
      { id: 'workspace', name: 'Workspace', path: '/workspace', purpose: 'Manage secured workspace records.', public: false, roleIds: ['viewer', 'editor', 'admin'], states: ['loading', 'empty', 'error', 'forbidden', 'ready'], entityIds: ['records'], workflowIds: ['record-lifecycle'], agentIds: [], acceptanceCriterionIds: criterionIds },
    ];
    const structure: AppStructuredSpecification = {
      purpose: description, audience: profile.tenancyMode,
      personas: [{ id: 'primary-user', name: 'Primary user', description: 'The principal person whose work and goals must be clarified during discovery.', goals: ['Complete the primary application outcome.'], painPoints: ['The current process and its constraints are not fully understood yet.'], roleIds: ['viewer', 'editor'] }],
      userStories: [{ id: 'primary-outcome', title: `Achieve the ${name} outcome`, personaId: 'primary-user', statement: `As the primary user, I want ${description.toLowerCase()} so that the intended outcome is achieved.`, priority: 'must', surfaceIds: ['home'], workflowIds: ['record-lifecycle'], acceptanceCriterionIds: ['accept-purpose'] }],
      roles, pages, entities: [entity],
      workflows: [{ id: 'record-lifecycle', name: 'Primary workflow', description: 'A discovery placeholder that must be replaced with the real end-to-end journey.', trigger: 'The user starts the primary journey.', steps: [{ id: 'understand', type: 'browser_action', description: 'Collect the information needed to perform the journey.' }, { id: 'read', type: 'data_read', description: 'Load permitted records.' }, { id: 'write', type: 'data_write', description: 'Apply an authorized change.' }] }],
      agents: [], integrations: [],
      decisions: [{ id: 'application-profile', title: 'Initial application profile', decision: `${profile.applicationType.replaceAll('_', ' ')} with ${profile.tenancyMode.replaceAll('_', ' ')} tenancy.`, rationale: 'Selected during application creation and used to constrain discovery and generator compatibility.', status: 'confirmed', sourceMessageIds: [] }],
      qualityAttributes: [
        { id: 'accessibility-aa', category: 'accessibility', requirement: 'Core journeys are accessible to keyboard and assistive-technology users.', measure: 'WCAG 2.2 AA checks pass.' },
        { id: 'secure-boundaries', category: 'security', requirement: 'Identity, role, tenancy and data boundaries are enforced outside generated client code.', measure: 'Negative authorization and tenancy tests pass.' },
      ],
      designBrief: { tone: 'Clear, trustworthy and appropriate for the people and task.', principles: ['Make the primary outcome obvious', 'Show system status and recovery paths', 'Use accessible hierarchy and contrast'], accessibilityTarget: 'AA' },
      acceptanceCriteria: sections.map((section) => ({
        id: `accept-${section.id}`, requirementId: section.id,
        description: this.acceptanceDescription(section.id, section.body),
        kind: section.id === 'guardrails' ? 'policy' as const : section.id === 'quality' ? 'accessibility' as const : 'journey' as const,
      })),
    };
    return { sections, structure };
  }

  private acceptanceDescription(id: string, body: string): string {
    if (id.includes('guard') || id.includes('security')) return 'Private records and privileged actions remain inaccessible without the required membership and role.';
    if (id.includes('quality') || id.includes('nfr')) return 'Every declared page provides accessible ready, loading, empty, error, and forbidden behavior where applicable.';
    return `A representative user can complete the outcome described by this requirement: ${body}`.slice(0, 1_000);
  }

  async detail(id: string) {
    const detail = await this.repository.detail(id);
    if (!detail) throw new NotFoundException('Browser app not found');
    return { ...detail, app: { ...detail.app, url: `/apps/${detail.app.publicKey}/` } };
  }

  async startGeneration(id: string, instruction?: string, requestedProfile?: unknown): Promise<BrowserGenerationJob> {
    const base = await this.detail(id);
    this.generators.requireAvailable(base.app.generatorId, base.app.profile);
    if (base.app.specificationApprovalStatus !== 'approved') throw new BadRequestException('Approve the current application specification before generation');
    const active = await this.repository.latestGenerationJob(id);
    if (active && (active.status === 'queued' || active.status === 'running')) throw new BadRequestException('A generation job is already running for this application');
    const generationProfile = this.resolveGenerationProfile(requestedProfile ?? base.app.generationProfile);
    const now = new Date().toISOString();
    const job: BrowserGenerationJob = {
      id: randomUUID(), appId: id, specRevision: base.app.specRevision,
      instruction: instruction?.trim() || 'Produce the next safe application graph revision.', generationProfile,
      status: 'queued', phase: 'queued', progress: 0,
      workers: generationProfile.agents.map((worker) => ({
        templateId: worker.templateId, name: worker.name, role: worker.role, connector: worker.connector,
        model: worker.model, effort: worker.effort, status: 'queued',
      })),
      events: [], createdAt: now, updatedAt: now,
    };
    await this.repository.createGenerationJob(job);
    await this.repository.setAppLifecycle(id, 'generating');
    const controller = new AbortController();
    this.generationControllers.set(job.id, controller);
    void this.executeGenerationJob(job, base, controller.signal);
    return job;
  }

  async approveSpecification(id: string) {
    const detail = await this.detail(id);
    const readiness = specificationCoverage({
      sections: detail.specification.sections,
      structure: detail.specification.structure,
      changes: [],
    });
    if (readiness.contradictions.length) {
      throw new BadRequestException(`Resolve the application-definition contradiction before building: ${readiness.contradictions[0]}`);
    }
    await this.repository.setSpecificationApproval(id, detail.app.specRevision, 'approved');
    await this.repository.setAppLifecycle(id, 'specifying');
    return { detail: await this.detail(id) };
  }

  async generationJob(appId: string, jobId: string): Promise<BrowserGenerationJob> {
    const job = await this.repository.generationJob(appId, jobId);
    if (!job) throw new NotFoundException('Generation job not found');
    return job;
  }

  async latestGenerationJob(appId: string): Promise<BrowserGenerationJob | null> {
    await this.detail(appId);
    return this.repository.latestGenerationJob(appId);
  }

  async cancelGeneration(appId: string, jobId: string): Promise<BrowserGenerationJob> {
    const job = await this.generationJob(appId, jobId);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    this.generationControllers.get(job.id)?.abort();
    await this.emitGeneration(job, 'warning', 'Generation', 'Generation cancelled', 'No preview was promoted or activated.');
    await this.repository.updateGenerationJob(appId, jobId, { status: 'cancelled', phase: 'cancelled', completedAt: new Date().toISOString(), progress: job.progress });
    await this.repository.setAppLifecycle(appId, 'specifying');
    return this.generationJob(appId, jobId);
  }

  private async executeGenerationJob(job: BrowserGenerationJob, base: Awaited<ReturnType<BrowserAppService['detail']>>, signal: AbortSignal): Promise<void> {
    const revisions = {
      sourceRevision: base.app.sourceRevision, schemaRevision: base.app.schemaRevision, policyRevision: base.app.policyRevision,
      connectorRevision: base.app.connectorRevision, generatedFromSpecRevision: base.app.generatedFromSpecRevision,
      generationProfile: base.app.generationProfile,
    };
    const templates = new Map(this.platformStore.snapshot().agents.map((agent) => [agent.id, agent]));
    const profile = job.generationProfile;
    const startedAt = new Date().toISOString();
    try {
      await this.repository.updateGenerationJob(job.appId, job.id, { status: 'running', phase: 'preparing', progress: 3, startedAt });
      await this.emitGeneration(job, 'status', 'Generation', 'Preparing the application context', `Pinned specification revision ${job.specRevision} and ${profile.agents.length} selected specialist${profile.agents.length === 1 ? '' : 's'}.`);
      await this.emitGeneration(job, 'tool', 'Specification compiler', 'Loaded the authoritative specification', `${base.specification.sections.length} requirements, ${base.specification.structure.pages.length} pages, ${base.specification.structure.entities.length} entities, and ${base.specification.structure.agents.length} browser agents.`);
      const prd = base.specification.sections.map((section) => `${section.id} — ${section.title}: ${section.body}`).join('\n');
      const graph = base.modules.map((module) => `MODULE ${module.id} (${module.kind}) requirements=${module.requirementIds.join(',')}\n${module.source}`).join('\n\n');
      const routes = base.routes.map((route) => JSON.stringify(route)).join('\n');
      const agents = base.agents.map((agent) => JSON.stringify(agent)).join('\n');
      const context = `Approved requirements:\n${prd}\n\nStructured specification:\n${JSON.stringify(base.specification.structure)}\n\nCurrent component graph:\n${graph || 'No generated modules yet.'}\n\nRoutes:\n${routes || 'No generated routes yet.'}\n\nBrowser agents:\n${agents || 'No generated browser agents yet.'}\n\nRequested refinement: ${job.instruction}`;
      let generated = this.emptyChangeSet('Deterministic specification compiler only.');
      let accent = '#806cff';
      let headline = base.app.name;
      if (!this.ai.available()) {
        await this.emitGeneration(job, 'warning', 'Generation', 'Model generation is disabled', 'The deterministic compiler will build a functional preview from the approved specification. No agent work is being claimed.');
        const completedAt = new Date().toISOString();
        const workers = job.workers.map((worker) => ({ ...worker, status: 'completed' as const, startedAt, completedAt, durationMs: 0, metrics: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, toolCalls: 0 } }));
        job.workers = workers;
        await this.repository.updateGenerationJob(job.appId, job.id, { workers, progress: 60, phase: 'compiling' });
      } else {
        for (let index = 0; index < profile.agents.length; index += 1) {
          if (signal.aborted) throw new Error('Generation cancelled by the user');
          const worker = profile.agents[index]!;
          const template = templates.get(worker.templateId);
          if (!template) throw new Error(`Generation specialist ${worker.templateId} is no longer available`);
          const workerStarted = Date.now();
          job.workers = job.workers.map((item, itemIndex) => itemIndex === index ? { ...item, status: 'running', startedAt: new Date().toISOString() } : item);
          await this.repository.updateGenerationJob(job.appId, job.id, { workers: job.workers, phase: `agent:${worker.templateId}`, progress: 8 + Math.round((index / profile.agents.length) * 52) });
          await this.emitGeneration(job, 'status', worker.name, `${worker.name} started`, `${worker.connector} · ${worker.model} · ${worker.effort} reasoning`);
          const priorProposal = generated.moduleUpserts.length || generated.routeUpserts.length ? `\n\nProposal from earlier specialists:\n${JSON.stringify(generated)}` : '';
          try {
            const result = await this.ai.browserAppPlan(
              `${context}${priorProposal}\n\nYour assigned generation role: ${worker.role}. Return the strongest complete graph change set for your specialty.`,
              { connector: worker.connector, model: worker.model, effort: worker.effort, instructions: template.instructions },
              (event) => this.emitGeneration(job, event.type as BrowserGenerationEvent['type'], worker.name, event.title, event.detail, event.durationMs, event.metadata),
              signal,
            );
            generated = this.mergeGeneratedChangeSets(generated, result.changeSet);
            accent = result.accent; headline = result.headline;
            const completedAt = new Date().toISOString();
            job.workers = job.workers.map((item, itemIndex) => itemIndex === index ? { ...item, status: 'completed', completedAt, durationMs: Date.now() - workerStarted, metrics: result.metrics } : item);
            await this.repository.updateGenerationJob(job.appId, job.id, { workers: job.workers, progress: 8 + Math.round(((index + 1) / profile.agents.length) * 52) });
            await this.emitGeneration(job, 'result', worker.name, `${worker.name} completed`, result.changeSet.summary, Date.now() - workerStarted, { modules: result.changeSet.moduleUpserts.length, routes: result.changeSet.routeUpserts.length });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            job.workers = job.workers.map((item, itemIndex) => itemIndex === index ? { ...item, status: signal.aborted ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), durationMs: Date.now() - workerStarted, error: message } : item);
            await this.repository.updateGenerationJob(job.appId, job.id, { workers: job.workers });
            await this.emitGeneration(job, 'error', worker.name, `${worker.name} failed`, message, Date.now() - workerStarted);
            throw error;
          }
        }
      }
      if (signal.aborted) throw new Error('Generation cancelled by the user');
      const latest = await this.detail(job.appId);
      if (latest.app.specRevision !== job.specRevision) throw new Error('The specification changed while generation was running. Start a new generation for the latest revision.');
      await this.repository.updateGenerationJob(job.appId, job.id, { phase: 'compiling', progress: 66 });
      await this.emitGeneration(job, 'tool', 'Specification compiler', 'Compiling required contracts', 'Reconciling every declared page, route, entity, policy, connector grant, and browser agent with the generated proposal.');
      const required = this.compileSpecificationChanges(base);
      const changeSet = this.mergeChangeSets(required, generated);
      await this.emitGeneration(job, 'tool', 'Graph writer', 'Writing an immutable graph revision', `${changeSet.moduleUpserts.length} modules, ${changeSet.routeUpserts.length} routes, ${changeSet.schemaUpserts.length} schemas, and ${changeSet.policyUpserts.length} policies will be reconciled.`);
      const sourceRevision = await this.repository.applyGraphChangeSet(job.appId, changeSet, accent, headline, profile);
      await this.repository.updateGenerationJob(job.appId, job.id, { phase: 'validating', progress: 78 });
      await this.emitGeneration(job, 'tool', 'Release pipeline', 'Running preview admission', 'Checking semantic alignment, traceability, security, tenancy, accessibility, compilation, and immutable artifact integrity.');
      const publication = await this.builder.buildAndRelease(job.appId, { activate: false });
      const completedAt = new Date().toISOString();
      const result = { sourceRevision, previewReleaseId: publication.release.id, previewVersion: publication.release.version, buildId: publication.build.id };
      // Persist the terminal activity before flipping the terminal status so a
      // polling client can never observe "completed" and stop just before the
      // final outcome event is appended.
      await this.emitGeneration(job, 'result', 'Release pipeline', 'Verified preview is ready', `Preview ${publication.release.version} passed ${publication.build.checks.length} admission checks. Production is unchanged.`);
      await this.repository.updateGenerationJob(job.appId, job.id, { status: 'completed', phase: 'preview_ready', progress: 100, completedAt, result });
      await this.repository.setAppLifecycle(job.appId, 'preview_ready');
    } catch (error) {
      const cancelled = signal.aborted || (await this.repository.generationJob(job.appId, job.id))?.status === 'cancelled';
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.restoreGraphRevisions(job.appId, revisions);
      if (!cancelled) await this.emitGeneration(job, 'error', 'Generation', 'Generation stopped without a preview', message);
      await this.repository.updateGenerationJob(job.appId, job.id, {
        status: cancelled ? 'cancelled' : 'failed', phase: cancelled ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), error: message,
      });
      await this.repository.setAppLifecycle(job.appId, cancelled ? 'specifying' : 'generation_failed');
    } finally {
      this.generationControllers.delete(job.id);
      this.generationSequences.delete(job.id);
    }
  }

  private async emitGeneration(
    job: Pick<BrowserGenerationJob, 'id' | 'appId'>, type: BrowserGenerationEvent['type'], actor: string,
    title: string, detail?: string, durationMs?: number, metadata?: BrowserGenerationEvent['metadata'],
  ): Promise<void> {
    const sequence = (this.generationSequences.get(job.id) ?? 0) + 1;
    this.generationSequences.set(job.id, sequence);
    const event: BrowserGenerationEvent = {
      id: randomUUID(), sequence, type, actor, title, ...(detail ? { detail: detail.slice(0, 2_000) } : {}),
      createdAt: new Date().toISOString(), ...(durationMs === undefined ? {} : { durationMs }), ...(metadata ? { metadata } : {}),
    };
    await this.repository.appendGenerationEvent(job.appId, job.id, event);
  }

  private resolveGenerationProfile(input: unknown): BrowserGenerationProfile {
    const options = this.generationOptions();
    const value = input ?? options.defaultProfile;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('A generation profile is required');
    const requestedAgents = (value as { agents?: unknown }).agents;
    if (!Array.isArray(requestedAgents) || requestedAgents.length < 1 || requestedAgents.length > options.maximumAgents) {
      throw new BadRequestException(`Select between 1 and ${options.maximumAgents} generation agents`);
    }
    const templates = new Map(options.agents.map((agent) => [agent.id, agent]));
    const connectors = new Map(options.connectors.map((connector) => [connector.id, connector]));
    const configuredConnectorExists = options.connectors.some((connector) => connector.configured);
    const efforts = new Set<GenerationEffort>(options.efforts.map((effort) => effort.id));
    const selected = new Set<string>();
    const agents = requestedAgents.map((candidate, index): BrowserGenerationAgentConfiguration => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new BadRequestException(`Generation agent ${index + 1} is invalid`);
      const request = candidate as Record<string, unknown>;
      const templateId = typeof request.templateId === 'string' ? request.templateId : '';
      const template = templates.get(templateId);
      if (!template) throw new BadRequestException(`Unknown or disabled generation agent ${templateId || index + 1}`);
      if (selected.has(templateId)) throw new BadRequestException(`Generation agent ${template.name} can only be selected once`);
      selected.add(templateId);
      const connectorId = typeof request.connector === 'string' ? request.connector : '';
      const connector = connectors.get(connectorId);
      if (!connector) throw new BadRequestException(`Unknown generation connector ${connectorId || index + 1}`);
      if (configuredConnectorExists && !connector.configured) throw new BadRequestException(`${connector.name} is not configured for generation`);
      const model = typeof request.model === 'string' ? request.model : '';
      if (!connector.models.some((candidateModel) => candidateModel.id === model)) throw new BadRequestException(`${model || 'Selected model'} is not available through ${connector.name}`);
      const effort = request.effort as GenerationEffort;
      if (!efforts.has(effort)) throw new BadRequestException('Generation effort must be low, medium, or high');
      return {
        templateId, templateVersion: template.defaultConfiguration.templateVersion,
        name: template.name, role: template.role, connector: connector.id, model, effort,
      };
    });
    return { agents, updatedAt: new Date().toISOString() };
  }

  private emptyChangeSet(summary: string): AppGraphChangeSet {
    return {
      summary, moduleUpserts: [], moduleDeletes: [], routeUpserts: [], routeDeletes: [],
      schemaUpserts: [], schemaDeletes: [], policyUpserts: [], policyDeletes: [], connectorUpserts: [], connectorDeletes: [], agentUpserts: [], agentDeletes: [],
    };
  }

  private mergeGeneratedChangeSets(first: AppGraphChangeSet, second: AppGraphChangeSet): AppGraphChangeSet {
    const merge = <T extends { id: string }>(before: T[], after: T[]) => [...new Map([...before, ...after].map((item) => [item.id, item])).values()];
    return {
      summary: `${first.summary} ${second.summary}`.trim(),
      moduleUpserts: merge(first.moduleUpserts, second.moduleUpserts), moduleDeletes: [...new Set([...first.moduleDeletes, ...second.moduleDeletes])],
      routeUpserts: merge(first.routeUpserts, second.routeUpserts), routeDeletes: [...new Set([...first.routeDeletes, ...second.routeDeletes])],
      schemaUpserts: merge(first.schemaUpserts, second.schemaUpserts), schemaDeletes: [...new Set([...first.schemaDeletes, ...second.schemaDeletes])],
      policyUpserts: merge(first.policyUpserts, second.policyUpserts), policyDeletes: [...new Set([...first.policyDeletes, ...second.policyDeletes])],
      connectorUpserts: merge(first.connectorUpserts, second.connectorUpserts), connectorDeletes: [...new Set([...first.connectorDeletes, ...second.connectorDeletes])],
      agentUpserts: merge(first.agentUpserts, second.agentUpserts), agentDeletes: [...new Set([...first.agentDeletes, ...second.agentDeletes])],
    };
  }

  async reviseSpecification(id: string, input: { expectedRevision?: unknown; sections?: unknown; structure?: unknown }) {
    const current = await this.detail(id);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== current.specification.revision) {
      throw new BadRequestException('Requirements revision is stale; reload before saving');
    }
    if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 40) {
      throw new BadRequestException('Requirements must contain 1 to 40 sections');
    }
    const seen = new Set<string>();
    const sections = input.sections.map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') throw new BadRequestException(`Requirements section ${index + 1} is invalid`);
      const value = candidate as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      const title = typeof value.title === 'string' ? value.title.trim() : '';
      const body = typeof value.body === 'string' ? value.body.trim() : '';
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || seen.has(id)) throw new BadRequestException(`Requirements section ${index + 1} needs a unique stable ID`);
      if (title.length < 2 || title.length > 100 || body.length < 3 || body.length > 10_000) throw new BadRequestException(`Requirements section ${index + 1} has invalid content`);
      seen.add(id);
      return { id, title, body };
    });
    const structure = this.validateStructuredSpecification(input.structure ?? current.specification.structure, sections, current.app.tenancyMode);
    const acceptanceCriteria = structure.acceptanceCriteria.filter((criterion) => sections.some((section) => section.id === criterion.requirementId));
    for (const section of sections) if (!acceptanceCriteria.some((criterion) => criterion.requirementId === section.id)) {
      const kind = section.id.includes('guard') || section.id.includes('security') ? 'policy' as const
        : section.id.includes('quality') || section.id.includes('nfr') || section.body.toLowerCase().includes('accessible') ? 'accessibility' as const
          : 'journey' as const;
      acceptanceCriteria.push({ id: `accept-${section.id}`, requirementId: section.id, description: this.acceptanceDescription(section.id, section.body), kind });
    }
    const criterionIds = acceptanceCriteria.map((criterion) => criterion.id);
    const alignedStructure: AppStructuredSpecification = {
      ...structure,
      acceptanceCriteria,
      pages: structure.pages.map((page) => ({ ...page, acceptanceCriterionIds: page.acceptanceCriterionIds.filter((id) => criterionIds.includes(id)) })),
    };
    const specification = await this.repository.publishSpecification(id, current.specification.revision, sections, alignedStructure, new Date().toISOString());
    await this.repository.setAppLifecycle(id, 'specifying');
    return { specification, detail: await this.detail(id) };
  }

  async build(id: string) {
    const publication = await this.builder.buildAndRelease(id, { activate: false });
    return { publication, detail: await this.detail(id) };
  }

  async promote(appId: string, releaseId: string) {
    const release = await this.repository.promotePreview(appId, releaseId);
    const detail = await this.detail(appId);
    if (!detail.bindings.some((binding) => binding.type === 'platform_path' && binding.status === 'active')) {
      await this.repository.insertBinding({
        id: randomUUID(), appId, environment: 'production', type: 'platform_path', hostname: 'localhost',
        pathPrefix: `/apps/${detail.app.publicKey}`, canonical: true, status: 'active', certificateStatus: 'active',
      });
    }
    await this.repository.setAppLifecycle(appId, 'production');
    return { release, detail: await this.detail(appId) };
  }

  async resolveRoute(hostname: string, pathname: string) {
    const resolved = await this.repository.resolveBinding(hostname, pathname);
    if (!resolved) throw new NotFoundException('No active route binding');
    return {
      appId: resolved.app.id,
      publicKey: resolved.app.publicKey,
      binding: resolved.binding,
      activeReleaseId: resolved.app.activeReleaseId,
    };
  }

  async createBinding(appId: string, input: { hostname?: string; type?: string; pathPrefix?: string }) {
    const app = await this.repository.findApp(appId);
    if (!app) throw new NotFoundException('Browser app not found');
    const type = input.type;
    if (type !== 'platform_hostname' && type !== 'custom_hostname') {
      throw new BadRequestException('Binding type must be platform_hostname or custom_hostname');
    }
    const hostname = this.normalizeHostname(input.hostname ?? '');
    const platformZone = (process.env.PLATFORM_APP_ZONE ?? 'apps.localhost').toLowerCase();
    if (type === 'platform_hostname' && !hostname.endsWith(`.${platformZone}`)) {
      throw new BadRequestException(`Platform hostname must be under ${platformZone}`);
    }
    const exists = await this.repository.resolveBinding(hostname, '/');
    if (exists) throw new BadRequestException('Hostname is already assigned');
    const active = type === 'platform_hostname';
    const binding: RouteBinding = {
      id: randomUUID(), appId: app.id, environment: 'production' as const,
      type, hostname, pathPrefix: input.pathPrefix?.startsWith('/') ? input.pathPrefix : '/',
      canonical: false, status: active ? 'active' as const : 'pending_verification' as const,
      verificationToken: active ? undefined : randomUUID(),
      certificateStatus: active ? 'active' as const : 'pending' as const,
    };
    try {
      await this.repository.insertBinding(binding);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new BadRequestException('Hostname and path are already claimed or pending verification');
      throw error;
    }
    return binding;
  }

  async verifyBinding(appId: string, bindingId: string, developmentProof?: string) {
    const binding = await this.repository.findBinding(bindingId);
    if (!binding || binding.appId !== appId) throw new NotFoundException('Route binding not found');
    if (binding.status === 'active') return binding;
    let verified = process.env.NODE_ENV !== 'production' && Boolean(binding.verificationToken && developmentProof === binding.verificationToken);
    if (!verified && binding.verificationToken) {
      try {
        const records = await resolveTxt(`_onering-challenge.${binding.hostname}`);
        verified = records.some((parts) => parts.join('') === `onering-verification=${binding.verificationToken}`);
      } catch {
        verified = false;
      }
    }
    if (!verified) throw new BadRequestException('Domain ownership TXT record is not verified');
    return this.repository.activateBinding(binding.id);
  }

  private normalizeHostname(value: string): string {
    const ascii = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''));
    if (!ascii || ascii.length > 253 || !ascii.includes('.') || ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new BadRequestException('Invalid hostname');
    }
    return ascii;
  }

  private validateStructuredSpecification(input: unknown, sections: BrowserAppSpecification['sections'], audience: AppTenancyMode): AppStructuredSpecification {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Structured application specification is required');
    if (JSON.stringify(input).length > 250_000) throw new BadRequestException('Structured application specification is too large');
    const value = structuredClone(input) as Record<string, unknown>;
    const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : '';
    if (purpose.length < 3 || purpose.length > 2_000) throw new BadRequestException('Application purpose must contain 3 to 2000 characters');
    for (const key of ['personas', 'userStories', 'integrations', 'decisions', 'qualityAttributes'] as const) {
      if (value[key] === undefined) value[key] = [];
    }
    if (!value.designBrief || typeof value.designBrief !== 'object') value.designBrief = { tone: 'Clear and trustworthy.', principles: ['Accessible interaction'], accessibilityTarget: 'AA' };
    const arrays = ['personas', 'userStories', 'roles', 'pages', 'entities', 'workflows', 'agents', 'integrations', 'decisions', 'qualityAttributes', 'acceptanceCriteria'] as const;
    for (const key of arrays) if (!Array.isArray(value[key])) throw new BadRequestException(`Structured specification ${key} must be an array`);
    if (!(value.pages as unknown[]).length || (value.pages as unknown[]).length > 80) throw new BadRequestException('Structured specification must contain 1 to 80 pages');
    const id = (candidate: unknown, label: string) => {
      if (typeof candidate !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate)) throw new BadRequestException(`${label} needs a stable lowercase ID`);
      return candidate;
    };
    const ensureUnique = (items: unknown[], label: string) => {
      const ids = items.map((item) => id((item as Record<string, unknown>)?.id, label));
      if (new Set(ids).size !== ids.length) throw new BadRequestException(`${label} IDs must be unique`);
    };
    for (const key of arrays) ensureUnique(value[key] as unknown[], key);
    const pages = value.pages as Array<Record<string, unknown>>;
    const paths = pages.map((page) => page.path);
    if (paths.some((path) => typeof path !== 'string' || !path.startsWith('/')) || new Set(paths).size !== paths.length) throw new BadRequestException('Every page needs a unique absolute path');
    const requirementIds = new Set(sections.map((section) => section.id));
    for (const criterion of value.acceptanceCriteria as Array<Record<string, unknown>>) {
      if (typeof criterion.requirementId !== 'string' || !requirementIds.has(criterion.requirementId)) throw new BadRequestException(`Acceptance criterion ${criterion.id} references an unknown requirement`);
      if (typeof criterion.description !== 'string' || criterion.description.trim().length < 3) throw new BadRequestException(`Acceptance criterion ${criterion.id} needs a measurable description`);
    }
    const roleIds = new Set((value.roles as Array<Record<string, unknown>>).map((role) => String(role.id)));
    const entityIds = new Set((value.entities as Array<Record<string, unknown>>).map((entity) => String(entity.id)));
    const workflowIds = new Set((value.workflows as Array<Record<string, unknown>>).map((workflow) => String(workflow.id)));
    const agentIds = new Set((value.agents as Array<Record<string, unknown>>).map((agent) => String(agent.id)));
    const criterionIds = new Set((value.acceptanceCriteria as Array<Record<string, unknown>>).map((criterion) => String(criterion.id)));
    const personaIds = new Set((value.personas as Array<Record<string, unknown>>).map((persona) => String(persona.id)));
    for (const story of value.userStories as Array<Record<string, unknown>>) {
      if (story.personaId && !personaIds.has(String(story.personaId))) throw new BadRequestException(`User story ${story.id} references an unknown persona`);
      for (const [key, known] of [['surfaceIds', new Set(pages.map((page) => String(page.id)))], ['workflowIds', workflowIds], ['acceptanceCriterionIds', criterionIds]] as const) {
        if (!Array.isArray(story[key]) || story[key].some((reference) => typeof reference !== 'string' || !known.has(reference))) throw new BadRequestException(`User story ${story.id} has an unknown ${key} reference`);
      }
    }
    for (const page of pages) {
      for (const [key, known] of [['roleIds', roleIds], ['entityIds', entityIds], ['workflowIds', workflowIds], ['agentIds', agentIds], ['acceptanceCriterionIds', criterionIds]] as const) {
        if (!Array.isArray(page[key]) || page[key].some((reference) => typeof reference !== 'string' || !known.has(reference))) throw new BadRequestException(`Page ${page.id} has an unknown ${key} reference`);
      }
      if (!Array.isArray(page.states) || !page.states.includes('ready')) throw new BadRequestException(`Page ${page.id} must define its ready state`);
    }
    const fieldTypes = new Set(['string', 'number', 'boolean', 'date', 'enum', 'object', 'array']);
    for (const entity of value.entities as Array<Record<string, unknown>>) {
      if (!Array.isArray(entity.fields) || entity.fields.length < 1 || entity.fields.length > 100) throw new BadRequestException(`Entity ${entity.id} must contain 1 to 100 fields`);
      ensureUnique(entity.fields, `fields for ${entity.id}`);
      for (const field of entity.fields as Array<Record<string, unknown>>) {
        if (!fieldTypes.has(String(field.type)) || typeof field.required !== 'boolean') throw new BadRequestException(`Entity ${entity.id} field ${field.id} has an invalid type or required flag`);
      }
    }
    for (const agent of value.agents as Array<Record<string, unknown>>) {
      if (!Number.isInteger(agent.maximumIterations) || Number(agent.maximumIterations) < 1 || Number(agent.maximumIterations) > 12) throw new BadRequestException(`Agent ${agent.id} needs an iteration budget from 1 to 12`);
      if (!Array.isArray(agent.toolIds) || agent.toolIds.some((tool) => typeof tool !== 'string' || !/^[a-z0-9-]+:[a-z0-9-]+$/.test(tool))) throw new BadRequestException(`Agent ${agent.id} has an invalid tool reference`);
    }
    const workflowStepTypes = new Set(['browser_action', 'data_read', 'data_write', 'agent', 'decision', 'human_approval']);
    for (const workflow of value.workflows as Array<Record<string, unknown>>) {
      if (!Array.isArray(workflow.steps) || workflow.steps.length < 1 || workflow.steps.length > 50) throw new BadRequestException(`Workflow ${workflow.id} must contain 1 to 50 steps`);
      ensureUnique(workflow.steps, `steps for ${workflow.id}`);
      if (workflow.steps.some((step) => !workflowStepTypes.has(String((step as Record<string, unknown>).type)))) throw new BadRequestException(`Workflow ${workflow.id} has an invalid step type`);
    }
    return { ...(value as unknown as AppStructuredSpecification), purpose, audience };
  }

  private compileSpecificationChanges(detail: Awaited<ReturnType<BrowserAppService['detail']>>): AppGraphChangeSet {
    const specification = detail.specification.structure;
    const criteria = new Map(specification.acceptanceCriteria.map((criterion) => [criterion.id, criterion]));
    const routesByPage = new Map(detail.routes.map((route) => [route.specPageId, route]));
    const specifiedPageIds = new Set(specification.pages.map((page) => page.id));
    const moduleUpserts: AppGraphChangeSet['moduleUpserts'] = [];
    const routeUpserts: AppGraphChangeSet['routeUpserts'] = [];
    const moduleDeletes: string[] = [];
    const routeDeletes: string[] = [];
    for (const page of specification.pages) {
      const requirementIds = [...new Set(page.acceptanceCriterionIds.map((id) => criteria.get(id)?.requirementId).filter((id): id is string => Boolean(id)))];
      const traced = requirementIds.length ? requirementIds : detail.specification.sections.map((section) => section.id);
      const currentRoute = routesByPage.get(page.id);
      const moduleId = currentRoute?.pageModuleId ?? `${page.id}-module`;
      const source = this.generatedPageSource(page, specification);
      moduleUpserts.push({ id: moduleId, kind: 'page', name: page.name, description: page.purpose, source, dependencies: [], packageImports: ['react', 'react-router-dom', 'app:runtime'], requiredCapabilities: [], requirementIds: traced });
      if (!currentRoute || currentRoute.path !== page.path || currentRoute.public !== page.public || currentRoute.navigation?.label !== page.name) {
        routeUpserts.push({
          id: currentRoute?.id ?? `route-${page.id}`, specPageId: page.id, path: page.path, pageModuleId: moduleId,
          ...(currentRoute?.layoutModuleId ? { layoutModuleId: currentRoute.layoutModuleId } : {}),
          public: page.public, requiredCapabilities: currentRoute?.requiredCapabilities ?? [], requirementIds: traced,
          navigation: { label: page.name, order: specification.pages.indexOf(page) + 1 },
        });
      }
    }
    for (const route of detail.routes) if (!specifiedPageIds.has(route.specPageId)) {
      routeDeletes.push(route.id);
      if (detail.routes.filter((candidate) => candidate.pageModuleId === route.pageModuleId).length === 1) moduleDeletes.push(route.pageModuleId);
    }
    const currentAgents = new Map(detail.agents.map((agent) => [agent.id, agent]));
    const agentUpserts = specification.agents.flatMap((agent) => {
      const current = currentAgents.get(agent.id);
      const requirementIds = detail.specification.sections.map((section) => section.id);
      if (current && current.name === agent.name && current.description === agent.purpose && current.connector === agent.connector && current.model === agent.model && current.maximumIterations === agent.maximumIterations && current.humanApprovalRequired === agent.humanApprovalRequired && JSON.stringify(current.toolIds) === JSON.stringify(agent.toolIds)) return [];
      return [{
        id: agent.id, name: agent.name, description: agent.purpose, connector: agent.connector, model: agent.model,
        instructions: current?.instructions ?? `Fulfil this browser-owned agent purpose: ${agent.purpose}`,
        allowedRoles: current?.allowedRoles ?? ['viewer', 'editor', 'admin'], toolIds: agent.toolIds,
        maximumIterations: agent.maximumIterations, humanApprovalRequired: agent.humanApprovalRequired, requirementIds,
      } satisfies AppGraphChangeSet['agentUpserts'][number]];
    });
    const specifiedAgentIds = new Set(specification.agents.map((agent) => agent.id));
    const agentDeletes = detail.agents.filter((agent) => !specifiedAgentIds.has(agent.id)).map((agent) => agent.id);
    const dataRequirementIds = specification.acceptanceCriteria
      .filter((criterion) => criterion.kind === 'data')
      .map((criterion) => criterion.requirementId);
    const entityRequirementIds = [...new Set(dataRequirementIds.length ? dataRequirementIds : detail.specification.sections.map((section) => section.id))];
    const currentSchemas = new Map(detail.schemas.map((schema) => [schema.entity, schema]));
    const currentPolicies = new Map(detail.policies.map((policy) => [policy.entity, policy]));
    const schemaUpserts: AppGraphChangeSet['schemaUpserts'] = [];
    const policyUpserts: AppGraphChangeSet['policyUpserts'] = [];
    for (const entity of specification.entities) {
      const currentSchema = currentSchemas.get(entity.id);
      const currentProperties = (currentSchema?.jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const properties = Object.fromEntries(entity.fields.map((field) => [field.id,
        this.fieldSchemaMatchesType(currentProperties[field.id], field.type) ? currentProperties[field.id] : this.jsonSchemaForField(field.type),
      ]));
      const generatedJsonSchema = {
        type: 'object', additionalProperties: false, properties,
        required: entity.fields.filter((field) => field.required).map((field) => field.id),
      };
      const jsonSchema = currentSchema && this.entitySchemaMatches(currentSchema.jsonSchema, entity.fields)
        ? currentSchema.jsonSchema
        : generatedJsonSchema;
      const requirementsForSchema = dataRequirementIds.length ? entityRequirementIds : (currentSchema?.requirementIds ?? entityRequirementIds);
      const publicRecordFilter = entity.fields.some((field) => field.id === 'status') ? { status: 'published' }
        : entity.fields.some((field) => field.id === 'visibility') ? { visibility: 'public' } : undefined;
      const candidateSchema: AppGraphChangeSet['schemaUpserts'][number] = {
        id: currentSchema?.id ?? `schema-${entity.id}`, entity: entity.id, displayName: entity.name,
        deploymentMode: currentSchema?.deploymentMode ?? 'shared_namespace', jsonSchema,
        indexes: [
          { fields: { createdAt: -1 } },
          ...(entity.fields.some((field) => field.id === 'slug') ? [{ fields: { slug: 1 as const }, unique: true }] : []),
        ],
        ...(publicRecordFilter ? { publicRecordFilter } : {}),
        requirementIds: requirementsForSchema,
      };
      const currentComparable = currentSchema ? {
        id: currentSchema.id, entity: currentSchema.entity, displayName: currentSchema.displayName,
        deploymentMode: currentSchema.deploymentMode, jsonSchema: currentSchema.jsonSchema, indexes: currentSchema.indexes,
        ...(currentSchema.publicRecordFilter ? { publicRecordFilter: currentSchema.publicRecordFilter } : {}),
        requirementIds: currentSchema.requirementIds,
      } : undefined;
      if (JSON.stringify(currentComparable) !== JSON.stringify(candidateSchema)) schemaUpserts.push(candidateSchema);

      const readable = ['id', ...entity.fields.map((field) => field.id), 'version', 'createdAt', 'updatedAt'];
      const writable = entity.fields.map((field) => field.id);
      const read = { operations: ['read'] as const, readFields: readable, writeFields: [], uiCapabilities: [`${entity.id}:read`] };
      const edit = { operations: ['create', 'read', 'update', 'delete'] as const, readFields: readable, writeFields: writable, uiCapabilities: [`${entity.id}:read`, `${entity.id}:write`] };
      const publicRead: AppGraphChangeSet['policyUpserts'][number]['grants']['public'] = publicRecordFilter
        ? { operations: ['read'], readFilter: publicRecordFilter, readFields: readable, writeFields: [], uiCapabilities: [`${entity.id}:read-public`] }
        : { operations: [], readFields: [], writeFields: [], uiCapabilities: [] };
      const currentPolicy = currentPolicies.get(entity.id);
      const requirementsForPolicy = dataRequirementIds.length ? entityRequirementIds : (currentPolicy?.requirementIds ?? entityRequirementIds);
      const candidatePolicy: AppGraphChangeSet['policyUpserts'][number] = {
        id: currentPolicy?.id ?? `policy-${entity.id}`, entity: entity.id,
        grants: {
          public: publicRead,
          viewer: { ...read, operations: [...read.operations] }, editor: { ...edit, operations: [...edit.operations] }, admin: { ...edit, operations: [...edit.operations] },
        },
        requirementIds: requirementsForPolicy,
      };
      const currentComparablePolicy = currentPolicy ? { id: currentPolicy.id, entity: currentPolicy.entity, grants: currentPolicy.grants, requirementIds: currentPolicy.requirementIds } : undefined;
      const fieldsChanged = !currentSchema || JSON.stringify(currentComparable) !== JSON.stringify(candidateSchema);
      if (!currentPolicy || fieldsChanged || (dataRequirementIds.length > 0 && JSON.stringify(currentComparablePolicy) !== JSON.stringify(candidatePolicy))) policyUpserts.push(candidatePolicy);
    }
    const specifiedEntityIds = new Set(specification.entities.map((entity) => entity.id));
    const schemaDeletes = detail.schemas.filter((schema) => !specifiedEntityIds.has(schema.entity)).map((schema) => schema.id);
    const policyDeletes = detail.policies.filter((policy) => !specifiedEntityIds.has(policy.entity)).map((policy) => policy.id);
    const specifiedTools = new Map<string, AppGraphChangeSet['connectorUpserts'][number]>();
    for (const agent of specification.agents) for (const toolId of agent.toolIds) {
      const [id, action] = toolId.split(':');
      if (!id || !action) continue;
      specifiedTools.set(toolId, {
        id, connector: agent.connector, action, description: `${agent.name}: ${agent.purpose}`,
        allowedRoles: ['viewer', 'editor', 'admin'],
        inputSchema: { type: 'object', additionalProperties: false, properties: { context: { type: 'string', minLength: 3, maxLength: 4000 } }, required: ['context'] },
        outputSchema: { type: 'object', additionalProperties: true }, timeoutMs: 30_000, rateLimitPerMinute: 20,
        requirementIds: detail.specification.sections.map((section) => section.id),
      });
    }
    const connectorUpserts = [...specifiedTools.values()];
    const connectorDeletes = detail.connectors.filter((connector) => !specifiedTools.has(`${connector.id}:${connector.action}`)).map((connector) => connector.id);
    return {
      summary: 'Compile authoritative specification changes.',
      moduleUpserts, moduleDeletes, routeUpserts, routeDeletes,
      schemaUpserts, schemaDeletes, policyUpserts, policyDeletes, agentUpserts, agentDeletes,
      connectorUpserts, connectorDeletes,
    };
  }

  private mergeChangeSets(required: AppGraphChangeSet, generated: AppGraphChangeSet): AppGraphChangeSet {
    const merge = <T extends { id: string }>(first: T[], second: T[]) => [...new Map([...first, ...second].map((item) => [item.id, item])).values()];
    const generatedModules = new Map(generated.moduleUpserts.map((module) => [module.id, module]));
    const requiredIds = new Set(required.moduleUpserts.map((module) => module.id));
    const moduleUpserts = [
      ...required.moduleUpserts.map((contract) => {
        const proposal = generatedModules.get(contract.id);
        return proposal ? { ...contract, ...proposal, name: contract.name, description: contract.description, requirementIds: contract.requirementIds } : contract;
      }),
      ...generated.moduleUpserts.filter((module) => !requiredIds.has(module.id)),
    ];
    return {
      summary: generated.summary,
      moduleUpserts,
      moduleDeletes: [...new Set([...required.moduleDeletes, ...generated.moduleDeletes])],
      routeUpserts: merge(generated.routeUpserts, required.routeUpserts),
      routeDeletes: [...new Set([...required.routeDeletes, ...generated.routeDeletes])],
      schemaUpserts: merge(generated.schemaUpserts, required.schemaUpserts),
      schemaDeletes: [...new Set([...required.schemaDeletes, ...generated.schemaDeletes])],
      policyUpserts: merge(generated.policyUpserts, required.policyUpserts),
      policyDeletes: [...new Set([...required.policyDeletes, ...generated.policyDeletes])],
      connectorUpserts: merge(required.connectorUpserts, generated.connectorUpserts),
      connectorDeletes: [...new Set([...required.connectorDeletes, ...generated.connectorDeletes])],
      agentUpserts: merge(generated.agentUpserts, required.agentUpserts),
      agentDeletes: [...new Set([...required.agentDeletes, ...generated.agentDeletes])],
    };
  }

  private jsonSchemaForField(type: AppStructuredSpecification['entities'][number]['fields'][number]['type']): Record<string, unknown> {
    if (type === 'number') return { type: 'number' };
    if (type === 'boolean') return { type: 'boolean' };
    if (type === 'date') return { type: 'string', format: 'date-time' };
    if (type === 'object') return { type: 'object' };
    if (type === 'array') return { type: 'array', items: {} };
    return { type: 'string' };
  }

  private fieldSchemaMatchesType(schema: Record<string, unknown> | undefined, type: AppStructuredSpecification['entities'][number]['fields'][number]['type']): boolean {
    if (!schema) return false;
    if (type === 'enum') return Array.isArray(schema.enum) || schema.type === 'string';
    if (type === 'date') return schema.type === 'string' && schema.format === 'date-time';
    return schema.type === type;
  }

  private entitySchemaMatches(schema: Record<string, unknown>, fields: AppStructuredSpecification['entities'][number]['fields']): boolean {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    return Object.keys(properties).length === fields.length && fields.every((field) => (
      this.fieldSchemaMatchesType(properties[field.id], field.type) && required.has(field.id) === field.required
    ));
  }

  private generatedPageSource(
    page: AppStructuredSpecification['pages'][number],
    specification: AppStructuredSpecification,
  ): string {
    const entity = specification.entities.find((candidate) => page.entityIds.includes(candidate.id));
    const agent = specification.agents.find((candidate) => page.agentIds.includes(candidate.id));
    const workflows = specification.workflows.filter((candidate) => page.workflowIds.includes(candidate.id));
    const fields = entity?.fields.map((field) => ({ id: field.id, type: field.type, required: field.required, label: field.description || field.id })) ?? [];
    const dynamicSlug = page.path.includes(':slug');
    const detailPath = entity ? specification.pages.find((candidate) => candidate.id !== page.id && candidate.path.includes(':slug') && candidate.entityIds.includes(entity.id))?.path.replace(':slug', '') ?? '' : '';
    return `import React, { useEffect, useMemo, useState } from 'react';
	import { Link, useParams } from 'react-router-dom';
	import { api, bootstrap, runAgent } from 'app:runtime';
	const entityId = ${JSON.stringify(entity?.id ?? '')};
	const fields = ${JSON.stringify(fields)};
	const agentId = ${JSON.stringify(agent?.id ?? '')};
	const workflows = ${JSON.stringify(workflows)};
	const dynamicSlug = ${JSON.stringify(dynamicSlug)};
	const detailPath = ${JSON.stringify(detailPath)};
	function initialForm() { return Object.fromEntries(fields.map((field) => [field.id, field.type === 'boolean' ? false : field.id === 'status' ? 'draft' : ''])); }
	export default function GeneratedPage() {
	  const params = useParams();
	  const [items, setItems] = useState([]);
	  const [form, setForm] = useState(initialForm);
	  const [loading, setLoading] = useState(Boolean(entityId));
	  const [error, setError] = useState('');
	  const [session, setSession] = useState();
	  const [goal, setGoal] = useState('');
	  const [agentOutput, setAgentOutput] = useState('');
	  const [agentEvents, setAgentEvents] = useState([]);
	  const canWrite = Boolean(session?.capabilities?.includes(entityId + ':write'));
	  async function load() {
    if (!entityId) return;
    setLoading(true); setError('');
    try { const page = await api('/data/' + encodeURIComponent(entityId)); setItems(page.items || []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load data'); }
    finally { setLoading(false); }
  }
	  useEffect(() => {
	    let mounted = true;
	    const receive = (event) => { if (!mounted) return; setSession(event.detail); setAgentOutput(''); setAgentEvents([]); void load(); };
	    bootstrap().then((value) => { if (mounted) setSession(value); }).catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : 'Unable to establish a secure session'); });
	    window.addEventListener('onering:session', receive);
	    void load();
	    return () => { mounted = false; window.removeEventListener('onering:session', receive); };
	  }, []);
  async function create(event) {
    event.preventDefault(); setError('');
    const value = Object.fromEntries(fields.flatMap((field) => {
      const input = form[field.id];
      if (!field.required && input === '') return [];
      return [[field.id, field.type === 'number' ? Number(input) : field.type === 'boolean' ? Boolean(input) : input]];
    }));
	    try { await api('/data/' + encodeURIComponent(entityId), { method: 'POST', body: JSON.stringify(value) }); setForm(initialForm()); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save record'); }
  }
  async function askAgent(event) {
	    event.preventDefault(); setError(''); setAgentOutput(''); setAgentEvents([]);
	    try { const result = await runAgent(agentId, goal, { maximumIterations: ${agent?.maximumIterations ?? 1}, onApproval: async (message) => window.confirm(message), onEvent: (activity) => setAgentEvents((current) => [...current.slice(-11), activity]) }); setAgentOutput(result.output); }
	    catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent failed'); }
	  }
	  const visibleItems = useMemo(() => dynamicSlug && params.slug ? items.filter((item) => item.slug === params.slug) : items, [items, params.slug]);
	  return <main className="about-page generated-spec-page"><span className="eyebrow">{${JSON.stringify(page.name)}}</span><h1>{${JSON.stringify(page.purpose)}}</h1>
	    {error && <p role="alert" className="error-banner">{error}</p>}
	    {entityId && <section className="task-layout"><div className="task-column"><h2>{dynamicSlug ? 'Story' : ${JSON.stringify(entity?.name ?? 'Records')}}</h2>{loading ? <p role="status">Loading…</p> : visibleItems.length ? visibleItems.map((item) => <article className="task-card" key={item.id}><strong>{!dynamicSlug && detailPath && item.slug ? <Link to={detailPath + encodeURIComponent(String(item.slug))}>{String(item[fields[0]?.id] || item.id)}</Link> : String(item[fields[0]?.id] || item.id)}</strong>{fields.slice(1).map((field) => field.id === 'body' ? <p key={field.id}>{String(item[field.id] ?? '')}</p> : <small key={field.id}>{field.label}: {String(item[field.id] ?? '—')}</small>)}</article>) : <p>{dynamicSlug ? 'This story is not published or could not be found.' : 'No records yet.'}</p>}</div>{canWrite && !dynamicSlug && <form className="task-form" onSubmit={create}><h2>Add {${JSON.stringify(entity?.name ?? 'record')}}</h2>{fields.map((field) => <label key={field.id}>{field.label}{field.type === 'boolean' ? <input type="checkbox" checked={Boolean(form[field.id])} onChange={(event) => setForm({ ...form, [field.id]: event.target.checked })}/> : field.id === 'body' || field.id === 'description' ? <textarea required={field.required} value={String(form[field.id] ?? '')} onChange={(event) => setForm({ ...form, [field.id]: event.target.value })}/> : <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'datetime-local' : 'text'} required={field.required} value={String(form[field.id] ?? '')} onChange={(event) => setForm({ ...form, [field.id]: event.target.value })}/>}</label>)}<button type="submit">Save draft</button></form>}</section>}
	    {agentId && session?.principal?.role !== 'public' && <form className="agent-panel" onSubmit={askAgent}><span>Browser agent · {agentId}</span><h2>{${JSON.stringify(agent?.purpose ?? 'Get help')}}</h2><input value={goal} minLength={3} required onChange={(event) => setGoal(event.target.value)} placeholder="What should the agent help with?"/><button type="submit">Run agent</button>{agentEvents.length > 0 && <ol aria-label="Agent activity">{agentEvents.map((activity, index) => <li key={index}><strong>{activity.type.replaceAll('_', ' ')}</strong>{activity.toolId ? ' · ' + activity.toolId : ''}</li>)}</ol>}{agentOutput && <p>{agentOutput}</p>}</form>}
    {workflows.length > 0 && <section className="trust-panel"><h2>How this works</h2>{workflows.map((workflow) => <article key={workflow.id}><strong>{workflow.name}</strong><p>{workflow.description}</p><ol>{workflow.steps.map((step) => <li key={step.id}>{step.description} <small>{step.type.replaceAll('_', ' ')}</small></li>)}</ol></article>)}</section>}
  </main>;
}`;
  }
}
