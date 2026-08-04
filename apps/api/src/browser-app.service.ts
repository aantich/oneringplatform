import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import type { AppGraphChangeSet, AppMembership, AppStructuredSpecification, AppTenancyMode, BrowserAgentRecord, BrowserApp, BrowserAppSpecification, BrowserGenerationAgentConfiguration, BrowserGenerationOptions, BrowserGenerationProfile, EndTenant, GenerationEffort, RouteBinding, TenancyRevision, ThemeRevision } from './browser-app.domain.js';
import { AiService } from './ai.service.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { StoreService } from './store.service.js';
import { seedAgents, seedBrowserAppSpecification, seedConnectors, seedModules, seedPolicies, seedRoutes, seedSchemas, seedTheme } from './browser-app.seed.js';
import type { ControlPlanePrincipal } from './control-plane-auth.guard.js';

@Injectable()
export class BrowserAppService {
  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppBuildService) private readonly builder: BrowserAppBuildService,
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

  async create(input: { name?: unknown; description?: unknown; mode?: unknown }, principal: ControlPlanePrincipal) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) throw new BadRequestException('App name must contain 2 to 80 characters');
    if (typeof input.description !== 'string' || input.description.trim().length < 3 || input.description.trim().length > 280) throw new BadRequestException('Description must contain 3 to 280 characters');
    const modes: AppTenancyMode[] = ['personal', 'team', 'multi_organization'];
    if (typeof input.mode !== 'string' || !modes.includes(input.mode as AppTenancyMode)) throw new BadRequestException('Unknown app mode');
    const requestedOwner = principal.activePlatformOrganizationId;
    if (!requestedOwner) throw new BadRequestException('An active platform organization is required');
    const base = input.name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'app';
    let appId = base;
    for (let suffix = 1; await this.repository.findApp(appId); suffix += 1) appId = `${base}-${suffix}`;
    const now = new Date().toISOString();
    const project = this.platformStore.snapshot().projects[0];
    const app: BrowserApp = {
      id: appId, publicKey: appId, platformOrganizationId: requestedOwner, name: input.name.trim(), description: input.description.trim(),
      runtimeProfile: 'browser_data', projectId: project?.id ?? appId, specRevision: project?.specVersion ?? 1,
      generatedFromSpecRevision: project?.specVersion ?? 1,
      sourceRevision: 1, schemaRevision: 1, policyRevision: 1, connectorRevision: 1, themeRevision: 1,
      tenancyRevision: 1, tenancyMode: input.mode as AppTenancyMode,
      generationProfile: this.generationOptions().defaultProfile, createdAt: now, updatedAt: now,
    };
    const sections = project?.prd.map((section) => ({ id: section.id, title: section.title, body: section.body })) ?? [{ id: 'goal', title: 'Product goal', body: input.description.trim() }];
    const requirementIds = sections.map((section) => section.id);
    const baseStructure = structuredClone(seedBrowserAppSpecification.structure);
    const structure: AppStructuredSpecification = {
      ...baseStructure,
      purpose: input.description.trim(),
      audience: input.mode as AppTenancyMode,
      acceptanceCriteria: sections.map((section, index) => ({
        id: `accept-${section.id}`, requirementId: section.id, description: section.body,
        kind: index === 0 ? 'journey' : section.id.includes('guard') || section.id.includes('security') ? 'policy' : 'journey',
      })),
      pages: baseStructure.pages.map((page) => ({ ...page, acceptanceCriterionIds: sections.map((section) => `accept-${section.id}`) })),
    };
    const specification: BrowserAppSpecification = {
      id: randomUUID(), appId, revision: app.specRevision, projectId: app.projectId, status: 'approved', createdAt: now,
      sections, structure,
    };
    const clone = <T extends { appId: string }>(item: T): T => {
      const copy = structuredClone(item) as T & { _id?: unknown };
      delete copy._id;
      return { ...copy, appId };
    };
    const modules = seedModules.map((item) => ({ ...clone(item), requirementIds, createdAt: now }));
    const routes = seedRoutes.map((item) => ({ ...clone(item), requirementIds }));
    const schemas = seedSchemas.map((item) => ({ ...clone(item), requirementIds, physicalCollection: this.repository.expectedPhysicalCollection(appId, item.entity) }));
    const policies = seedPolicies.map((item) => ({ ...clone(item), requirementIds }));
    const connectors = seedConnectors.map((item) => ({ ...clone(item), requirementIds }));
    const agents: BrowserAgentRecord[] = seedAgents.map((item) => ({ ...clone(item), requirementIds }));
    const theme: ThemeRevision = { ...clone(seedTheme), id: randomUUID(), appId, createdAt: now };
    const tenancy: TenancyRevision = {
      id: randomUUID(), appId, revision: 1, mode: input.mode as AppTenancyMode, organizationLabel: 'Organization',
      allowMultipleMemberships: input.mode === 'multi_organization', status: 'published', createdBy: 'user', createdAt: now,
    };
    const tenants: EndTenant[] = input.mode === 'multi_organization' ? [{ id: randomUUID(), appId, slug: 'primary', name: 'Primary organization', status: 'active', createdAt: now }] : [];
    const ownerMembership: AppMembership = {
      id: randomUUID(), appId, userId: principal.subject,
      email: principal.email ?? `${principal.subject.replace(/[^a-z0-9._-]/gi, '-')}@users.invalid`,
      displayName: principal.email?.split('@')[0] ?? 'Application owner', tenantId: tenants[0]?.id,
      roles: ['admin'], status: 'active', version: 1, createdAt: now, updatedAt: now,
    };
    const demoRoles = input.mode === 'personal' ? [] as const : ['viewer', 'editor', 'admin'] as const;
    const demoMemberships: AppMembership[] = process.env.NODE_ENV === 'production' ? [] : demoRoles.map((role) => ({
      id: randomUUID(), appId, userId: `demo-${role}`, email: `${role}@${appId}.demo`, displayName: `Demo ${role}`,
      tenantId: tenants[0]?.id, roles: [role], status: 'active', version: 1, createdAt: now, updatedAt: now,
    }));
    const memberships = [ownerMembership, ...demoMemberships];
    const bindings: RouteBinding[] = [{ id: randomUUID(), appId, environment: 'production', type: 'platform_path', hostname: 'localhost', pathPrefix: `/apps/${appId}`, canonical: true, status: 'active' }];
    await this.repository.createAppGraph({ app, specification, modules, routes, schemas, policies, connectors, agents, theme, tenancy, tenants, memberships, bindings });
    const publication = await this.builder.buildAndRelease(appId);
    return { publication, detail: await this.detail(appId) };
  }

  async detail(id: string) {
    const detail = await this.repository.detail(id);
    if (!detail) throw new NotFoundException('Browser app not found');
    return detail;
  }

  async generate(id: string, instruction?: string, requestedProfile?: unknown) {
    const base = await this.detail(id);
    const generationProfile = this.resolveGenerationProfile(requestedProfile ?? base.app.generationProfile);
    const templates = new Map(this.platformStore.snapshot().agents.map((agent) => [agent.id, agent]));
    const prd = base.specification.sections.map((section) => `${section.id} — ${section.title}: ${section.body}`).join('\n');
    const graph = base.modules.map((module) => `MODULE ${module.id} (${module.kind}) requirements=${module.requirementIds.join(',')}\n${module.source}`).join('\n\n');
    const routes = base.routes.map((route) => JSON.stringify(route)).join('\n');
    const agents = base.agents.map((agent) => JSON.stringify(agent)).join('\n');
    const requiredChanges = this.compileSpecificationChanges(base);
    let context = `Approved requirements:\n${prd}\n\nStructured specification:\n${JSON.stringify(base.specification.structure)}\n\nCurrent component graph:\n${graph}\n\nRoutes:\n${routes}\n\nBrowser agents:\n${agents}\n\nRequested refinement: ${instruction?.trim() || 'Produce the next safe application graph revision.'}`;
    const failures: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let generated: AppGraphChangeSet | undefined;
      let accent = '#806cff';
      let headline = 'Turn shared work into visible progress.';
      const workers: Array<BrowserGenerationAgentConfiguration & { agent: 'oneringai' | 'fallback' }> = [];
      for (const worker of generationProfile.agents) {
        const template = templates.get(worker.templateId);
        if (!template) throw new BadRequestException(`Generation agent ${worker.templateId} is no longer available`);
        const priorProposal = generated ? `\n\nProposal from earlier specialists:\n${JSON.stringify(generated)}` : '';
        const result = await this.ai.browserAppPlan(
          `${context}${priorProposal}\n\nYour assigned generation role: ${worker.role}. Review all prior work and return the strongest complete graph change set for your specialty.`,
          { connector: worker.connector, model: worker.model, effort: worker.effort, instructions: template.instructions },
        );
        generated = generated ? this.mergeGeneratedChangeSets(generated, result.changeSet) : result.changeSet;
        accent = result.accent;
        headline = result.headline;
        workers.push({ ...worker, agent: result.agent });
      }
      const plan = {
        accent, headline, changeSet: generated ?? this.emptyChangeSet('No generation agent produced a proposal.'),
        agent: workers.some((worker) => worker.agent === 'oneringai') ? 'oneringai' as const : 'fallback' as const,
        workers,
      };
      const changeSet = this.mergeChangeSets(requiredChanges, plan.changeSet);
      try {
        const revision = await this.repository.applyGraphChangeSet(id, changeSet, plan.accent, plan.headline, generationProfile);
        const publication = await this.builder.buildAndRelease(id, { activate: false });
        return { plan, revision, publication, attempts: attempt, failures, detail: await this.detail(id) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        await this.repository.restoreGraphRevisions(id, {
          sourceRevision: base.app.sourceRevision,
          schemaRevision: base.app.schemaRevision,
          policyRevision: base.app.policyRevision,
          connectorRevision: base.app.connectorRevision,
          generatedFromSpecRevision: base.app.generatedFromSpecRevision,
          generationProfile: base.app.generationProfile,
        });
        context += `\n\nAttempt ${attempt} failed authoritative validation. Repair the graph transaction without weakening requirements or security. Failure:\n${message}`;
      }
    }
    throw new BadRequestException({ message: 'The agent could not produce a releasable revision after three bounded repair attempts', failures });
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
      schemaUpserts: [], schemaDeletes: [], policyUpserts: [], policyDeletes: [], agentUpserts: [], agentDeletes: [],
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
    const specification = await this.repository.publishSpecification(id, current.specification.revision, sections, structure, new Date().toISOString());
    return { specification, detail: await this.detail(id) };
  }

  async build(id: string) {
    const publication = await this.builder.buildAndRelease(id, { activate: false });
    return { publication, detail: await this.detail(id) };
  }

  async promote(appId: string, releaseId: string) {
    const release = await this.repository.promotePreview(appId, releaseId);
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
    const arrays = ['roles', 'pages', 'entities', 'workflows', 'agents', 'acceptanceCriteria'] as const;
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
      if (!detail.modules.some((module) => module.id === moduleId)) {
        const source = this.generatedPageSource(page, specification);
        moduleUpserts.push({ id: moduleId, kind: 'page', name: page.name, description: page.purpose, source, dependencies: [], packageImports: ['react', 'app:runtime'], requiredCapabilities: [], requirementIds: traced });
      }
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
      const candidateSchema: AppGraphChangeSet['schemaUpserts'][number] = {
        id: currentSchema?.id ?? `schema-${entity.id}`, entity: entity.id, displayName: entity.name,
        deploymentMode: currentSchema?.deploymentMode ?? 'shared_namespace', jsonSchema,
        indexes: currentSchema?.indexes ?? [{ fields: { createdAt: -1 } }],
        ...(currentSchema?.publicRecordFilter ? { publicRecordFilter: currentSchema.publicRecordFilter } : {}),
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
      const currentPolicy = currentPolicies.get(entity.id);
      const requirementsForPolicy = dataRequirementIds.length ? entityRequirementIds : (currentPolicy?.requirementIds ?? entityRequirementIds);
      const candidatePolicy: AppGraphChangeSet['policyUpserts'][number] = {
        id: currentPolicy?.id ?? `policy-${entity.id}`, entity: entity.id,
        grants: {
          public: { operations: [], readFields: [], writeFields: [], uiCapabilities: [] },
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
    return {
      summary: 'Compile authoritative specification changes.',
      moduleUpserts, moduleDeletes, routeUpserts, routeDeletes,
      schemaUpserts, schemaDeletes, policyUpserts, policyDeletes, agentUpserts, agentDeletes,
    };
  }

  private mergeChangeSets(required: AppGraphChangeSet, generated: AppGraphChangeSet): AppGraphChangeSet {
    const merge = <T extends { id: string }>(first: T[], second: T[]) => [...new Map([...first, ...second].map((item) => [item.id, item])).values()];
    return {
      summary: generated.summary,
      moduleUpserts: merge(generated.moduleUpserts, required.moduleUpserts),
      moduleDeletes: [...new Set([...required.moduleDeletes, ...generated.moduleDeletes])],
      routeUpserts: merge(generated.routeUpserts, required.routeUpserts),
      routeDeletes: [...new Set([...required.routeDeletes, ...generated.routeDeletes])],
      schemaUpserts: merge(generated.schemaUpserts, required.schemaUpserts),
      schemaDeletes: [...new Set([...required.schemaDeletes, ...generated.schemaDeletes])],
      policyUpserts: merge(generated.policyUpserts, required.policyUpserts),
      policyDeletes: [...new Set([...required.policyDeletes, ...generated.policyDeletes])],
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
    return `import React, { useEffect, useState } from 'react';
import { api, runAgent } from 'app:runtime';
const entityId = ${JSON.stringify(entity?.id ?? '')};
const fields = ${JSON.stringify(fields)};
const agentId = ${JSON.stringify(agent?.id ?? '')};
const workflows = ${JSON.stringify(workflows)};
export default function GeneratedPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((field) => [field.id, field.type === 'boolean' ? false : ''])));
  const [loading, setLoading] = useState(Boolean(entityId));
  const [error, setError] = useState('');
  const [goal, setGoal] = useState('');
  const [agentOutput, setAgentOutput] = useState('');
  async function load() {
    if (!entityId) return;
    setLoading(true); setError('');
    try { const page = await api('/data/' + encodeURIComponent(entityId)); setItems(page.items || []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load data'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function create(event) {
    event.preventDefault(); setError('');
    const value = Object.fromEntries(fields.flatMap((field) => {
      const input = form[field.id];
      if (!field.required && input === '') return [];
      return [[field.id, field.type === 'number' ? Number(input) : field.type === 'boolean' ? Boolean(input) : input]];
    }));
    try { await api('/data/' + encodeURIComponent(entityId), { method: 'POST', body: JSON.stringify(value) }); setForm(Object.fromEntries(fields.map((field) => [field.id, field.type === 'boolean' ? false : '']))); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save record'); }
  }
  async function askAgent(event) {
    event.preventDefault(); setError(''); setAgentOutput('');
    try { const result = await runAgent(agentId, goal, { maximumIterations: ${agent?.maximumIterations ?? 1}, onApproval: async (message) => window.confirm(message) }); setAgentOutput(result.output); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent failed'); }
  }
  return <main className="about-page generated-spec-page"><span className="eyebrow">{${JSON.stringify(page.name)}}</span><h1>{${JSON.stringify(page.purpose)}}</h1>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {entityId && <section className="task-layout"><div className="task-column"><h2>{${JSON.stringify(entity?.name ?? 'Records')}}</h2>{loading ? <p>Loading…</p> : items.length ? items.map((item) => <article className="task-card" key={item.id}><strong>{String(item[fields[0]?.id] || item.id)}</strong>{fields.slice(1).map((field) => <small key={field.id}>{field.id}: {String(item[field.id] ?? '—')}</small>)}</article>) : <p>No records yet. Add the first one below.</p>}</div><form className="task-form" onSubmit={create}><h2>Add {${JSON.stringify(entity?.name ?? 'record')}}</h2>{fields.map((field) => <label key={field.id}>{field.label}{field.type === 'boolean' ? <input type="checkbox" checked={Boolean(form[field.id])} onChange={(event) => setForm({ ...form, [field.id]: event.target.checked })}/> : <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'datetime-local' : 'text'} required={field.required} value={String(form[field.id] ?? '')} onChange={(event) => setForm({ ...form, [field.id]: event.target.value })}/>}</label>)}<button type="submit">Save</button></form></section>}
    {agentId && <form className="agent-panel" onSubmit={askAgent}><span>Browser agent · {agentId}</span><h2>{${JSON.stringify(agent?.purpose ?? 'Get help')}}</h2><input value={goal} minLength={3} required onChange={(event) => setGoal(event.target.value)} placeholder="What should the agent help with?"/><button type="submit">Run agent</button>{agentOutput && <p>{agentOutput}</p>}</form>}
    {workflows.length > 0 && <section className="trust-panel"><h2>How this works</h2>{workflows.map((workflow) => <article key={workflow.id}><strong>{workflow.name}</strong><p>{workflow.description}</p><ol>{workflow.steps.map((step) => <li key={step.id}>{step.description} <small>{step.type.replaceAll('_', ' ')}</small></li>)}</ol></article>)}</section>}
  </main>;
}`;
  }
}
