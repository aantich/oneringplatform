import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import type { AppMembership, AppTenancyMode, BrowserApp, BrowserAppSpecification, EndTenant, RouteBinding, TenancyRevision, ThemeRevision } from './browser-app.domain.js';
import { AiService } from './ai.service.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { StoreService } from './store.service.js';
import { seedConnectors, seedModules, seedPolicies, seedRoutes, seedSchemas, seedTheme } from './browser-app.seed.js';
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
    const apps = principal?.superadmin ? allApps : principal ? allApps.filter((app) => principal.organizationIds.includes(app.ownerOrganizationId)) : [];
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

  async create(input: { name?: unknown; description?: unknown; mode?: unknown; ownerOrganizationId?: unknown }, principal: ControlPlanePrincipal) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) throw new BadRequestException('App name must contain 2 to 80 characters');
    if (typeof input.description !== 'string' || input.description.trim().length < 3 || input.description.trim().length > 280) throw new BadRequestException('Description must contain 3 to 280 characters');
    const modes: AppTenancyMode[] = ['personal', 'team', 'multi_organization'];
    if (typeof input.mode !== 'string' || !modes.includes(input.mode as AppTenancyMode)) throw new BadRequestException('Unknown app mode');
    const requestedOwner = typeof input.ownerOrganizationId === 'string' ? input.ownerOrganizationId : principal.organizationIds[0];
    if (!requestedOwner || (!principal.superadmin && !principal.organizationIds.includes(requestedOwner))) throw new BadRequestException('An owned platform organization is required');
    const base = input.name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'app';
    let appId = base;
    for (let suffix = 1; await this.repository.findApp(appId); suffix += 1) appId = `${base}-${suffix}`;
    const now = new Date().toISOString();
    const project = this.platformStore.snapshot().projects[0];
    const app: BrowserApp = {
      id: appId, publicKey: appId, ownerOrganizationId: requestedOwner, name: input.name.trim(), description: input.description.trim(),
      runtimeProfile: 'browser_data', projectId: project?.id ?? appId, specRevision: project?.specVersion ?? 1,
      sourceRevision: 1, schemaRevision: 1, policyRevision: 1, connectorRevision: 1, themeRevision: 1,
      tenancyRevision: 1, tenancyMode: input.mode as AppTenancyMode, createdAt: now, updatedAt: now,
    };
    const specification: BrowserAppSpecification = {
      id: randomUUID(), appId, revision: app.specRevision, projectId: app.projectId, status: 'approved', createdAt: now,
      sections: project?.prd.map((section) => ({ id: section.id, title: section.title, body: section.body })) ?? [{ id: 'goal', title: 'Product goal', body: input.description.trim() }],
    };
    const clone = <T extends { appId: string }>(item: T): T => ({ ...structuredClone(item), appId });
    const modules = seedModules.map((item) => ({ ...clone(item), createdAt: now }));
    const routes = seedRoutes.map(clone);
    const schemas = seedSchemas.map((item) => ({ ...clone(item), physicalCollection: this.repository.expectedPhysicalCollection(appId, item.entity) }));
    const policies = seedPolicies.map(clone);
    const connectors = seedConnectors.map(clone);
    const theme: ThemeRevision = { ...structuredClone(seedTheme), id: randomUUID(), appId, createdAt: now };
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
    await this.repository.createAppGraph({ app, specification, modules, routes, schemas, policies, connectors, theme, tenancy, tenants, memberships, bindings });
    const publication = await this.builder.buildAndRelease(appId);
    return { publication, detail: await this.detail(appId) };
  }

  async detail(id: string) {
    const detail = await this.repository.detail(id);
    if (!detail) throw new NotFoundException('Browser app not found');
    return detail;
  }

  async generate(id: string, instruction?: string) {
    const current = await this.detail(id);
    const prd = current.specification.sections.map((section) => `${section.title}: ${section.body}`).join('\n');
    const graph = current.modules.map((module) => `MODULE ${module.id} (${module.kind})\n${module.source}`).join('\n\n');
    const context = `${prd}\n\nCurrent component graph:\n${graph}\n\nRequested refinement: ${instruction?.trim() || 'Produce the next safe component revision.'}`;
    const plan = await this.ai.browserAppPlan(context);
    const revision = await this.repository.createGeneratedRevision(id, plan.accent, plan.headline, plan.modulePatches);
    try {
      const publication = await this.builder.buildAndRelease(id);
      return { plan, revision, publication, detail: await this.detail(id) };
    } catch (error) {
      await this.repository.restoreSourceRevision(id, current.app.sourceRevision);
      throw error;
    }
  }

  async reviseSpecification(id: string, input: { expectedRevision?: unknown; sections?: unknown }) {
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
    const specification = await this.repository.publishSpecification(id, current.specification.revision, sections, new Date().toISOString());
    return { specification, detail: await this.detail(id) };
  }

  async build(id: string) {
    const publication = await this.builder.buildAndRelease(id);
    return { publication, detail: await this.detail(id) };
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
}
