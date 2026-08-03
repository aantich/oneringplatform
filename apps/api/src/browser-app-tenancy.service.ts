import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppMembership, AppRole, AppTenancyMode, EndTenant, TenancyRevision } from './browser-app.domain.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';

const modes: AppTenancyMode[] = ['personal', 'team', 'multi_organization'];
const memberRoles: Exclude<AppRole, 'public'>[] = ['viewer', 'editor', 'admin'];

@Injectable()
export class BrowserAppTenancyService {
  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppBuildService) private readonly builder: BrowserAppBuildService,
  ) {}

  async preview(appId: string, input: { mode?: unknown; defaultTenantId?: unknown }) {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    if (typeof input.mode !== 'string' || !modes.includes(input.mode as AppTenancyMode)) throw new BadRequestException('Unknown tenancy mode');
    const impact = await this.repository.tenancyImpact(appId);
    return {
      fromMode: detail.tenancy.mode, toMode: input.mode as AppTenancyMode, ...impact,
      preservesExistingTenantAssignments: true,
      requiresDefaultTenant: input.mode === 'multi_organization' && impact.unscopedPrivateRecords > 0,
    };
  }

  async configure(appId: string, input: { mode?: unknown; organizationLabel?: unknown; defaultTenantId?: unknown }) {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    if (typeof input.mode !== 'string' || !modes.includes(input.mode as AppTenancyMode)) {
      throw new BadRequestException('Mode must be personal, team, or multi_organization');
    }
    const mode = input.mode as AppTenancyMode;
    const organizationLabel = this.label(input.organizationLabel, detail.tenancy.organizationLabel);
    if (mode === detail.tenancy.mode && organizationLabel === detail.tenancy.organizationLabel) {
      return { tenancy: detail.tenancy, publication: undefined };
    }

    let tenants = detail.endTenants;
    if (mode === 'multi_organization' && !tenants.length) {
      const tenant = this.tenantRecord(appId, 'Primary organization');
      await this.repository.insertEndTenant(tenant);
      tenants = [tenant];
    }
    const revision: TenancyRevision = {
      id: randomUUID(), appId, revision: (detail.tenancyRevisions[0]?.revision ?? 0) + 1,
      mode, organizationLabel, allowMultipleMemberships: mode === 'multi_organization',
      status: 'published', createdBy: 'user', createdAt: new Date().toISOString(),
    };

    let defaultTenantId: string | undefined;
    if (mode === 'multi_organization') {
      defaultTenantId = typeof input.defaultTenantId === 'string' ? input.defaultTenantId : tenants[0]?.id;
      if (!defaultTenantId || !tenants.some((tenant) => tenant.id === defaultTenantId && tenant.status === 'active')) {
        throw new BadRequestException('Select an active default organization for previously unscoped private records');
      }
    }
    const migrationResult = await this.repository.migrateEntityTenancy(appId, mode, defaultTenantId);
    await this.repository.publishTenancy(revision);
    const migration = {
      id: randomUUID(), appId, fromRevision: detail.tenancy.revision, toRevision: revision.revision,
      fromMode: detail.tenancy.mode, toMode: mode, defaultTenantId,
      ...migrationResult, status: 'completed' as const, createdAt: new Date().toISOString(),
    };
    await this.repository.writeTenancyMigration(migration);
    try {
      const publication = await this.builder.buildAndRelease(appId);
      return { tenancy: revision, publication };
    } catch (error) {
      await this.repository.restoreTenancy(appId, detail.tenancy.revision);
      await this.repository.writeTenancyMigration({ ...migration, id: randomUUID(), status: 'rolled_back', createdAt: new Date().toISOString() });
      throw error;
    }
  }

  async createOrganization(appId: string, input: { name?: unknown }) {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    if (detail.tenancy.mode !== 'multi_organization') {
      throw new BadRequestException('Organizations are available only in multi-organization apps');
    }
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) {
      throw new BadRequestException('Organization name must contain 2 to 80 characters');
    }
    const tenant = this.tenantRecord(appId, input.name.trim());
    if (detail.endTenants.some((candidate) => candidate.slug === tenant.slug)) {
      throw new BadRequestException('An organization with this name already exists');
    }
    await this.repository.insertEndTenant(tenant);
    return tenant;
  }

  async invite(appId: string, input: { email?: unknown; displayName?: unknown; role?: unknown; tenantId?: unknown }) {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    if (detail.tenancy.mode === 'personal') throw new BadRequestException('Personal apps have exactly one owner');
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new BadRequestException('A valid email is required');
    }
    if (typeof input.displayName !== 'string' || input.displayName.trim().length < 2 || input.displayName.trim().length > 80) {
      throw new BadRequestException('Display name must contain 2 to 80 characters');
    }
    if (typeof input.role !== 'string' || !memberRoles.includes(input.role as Exclude<AppRole, 'public'>)) {
      throw new BadRequestException('Role must be viewer, editor, or admin');
    }
    let tenantId: string | undefined;
    if (detail.tenancy.mode === 'multi_organization') {
      if (typeof input.tenantId !== 'string' || !(await this.repository.endTenant(appId, input.tenantId))) {
        throw new BadRequestException('An active organization is required');
      }
      tenantId = input.tenantId;
    }
    const email = input.email.trim().toLowerCase();
    const membership: AppMembership = {
      id: randomUUID(), appId, userId: `user:${email}`, email,
      displayName: input.displayName.trim(), tenantId,
      roles: [input.role as Exclude<AppRole, 'public'>], status: 'invited', version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    try {
      await this.repository.insertMembership(membership);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new BadRequestException('This user already belongs to that organization');
      throw error;
    }
    return membership;
  }

  async updateMembership(appId: string, membershipId: string, input: { role?: unknown; status?: unknown }) {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    const current = detail.memberships.find((membership) => membership.id === membershipId);
    if (!current) throw new NotFoundException('Membership not found');
    const role = input.role;
    const status = input.status;
    if (role !== undefined && (typeof role !== 'string' || !memberRoles.includes(role as Exclude<AppRole, 'public'>))) throw new BadRequestException('Unknown membership role');
    if (status !== undefined && !['invited', 'active', 'suspended'].includes(String(status))) throw new BadRequestException('Unknown membership status');
    const nextRole = role ?? current.roles[0];
    const nextStatus = status ?? current.status;
    if (current.status === 'active' && current.roles.includes('admin') && (nextStatus !== 'active' || nextRole !== 'admin')) {
      const activeAdmins = detail.memberships.filter((membership) =>
        membership.status === 'active' && membership.roles.includes('admin')
        && (detail.tenancy.mode !== 'multi_organization' || membership.tenantId === current.tenantId));
      if (activeAdmins.length <= 1) throw new BadRequestException('Assign another active administrator before changing this membership');
    }
    const updated = await this.repository.updateMembership(appId, membershipId, {
      ...(role ? { roles: [role as Exclude<AppRole, 'public'>] } : {}),
      ...(status ? { status: status as AppMembership['status'] } : {}),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) throw new NotFoundException('Membership not found');
    return updated;
  }

  async updateOrganization(appId: string, tenantId: string, status: unknown) {
    if (status !== 'active' && status !== 'suspended') throw new BadRequestException('Organization status must be active or suspended');
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    const current = detail.endTenants.find((tenant) => tenant.id === tenantId);
    if (!current) throw new NotFoundException('Organization not found');
    if (status === 'suspended' && current.status === 'active' && detail.endTenants.filter((tenant) => tenant.status === 'active').length <= 1) {
      throw new BadRequestException('A multi-organization app must retain at least one active organization');
    }
    const updated = await this.repository.updateEndTenant(appId, tenantId, status);
    if (!updated) throw new NotFoundException('Organization not found');
    return updated;
  }

  private tenantRecord(appId: string, name: string): EndTenant {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization';
    const suffix = randomUUID().slice(0, 6);
    return { id: `${base}-${suffix}`, appId, slug: `${base}-${suffix}`, name, status: 'active', createdAt: new Date().toISOString() };
  }

  private label(value: unknown, fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 40) {
      throw new BadRequestException('Organization label must contain 2 to 40 characters');
    }
    return value.trim();
  }
}
