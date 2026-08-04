import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ControlPlanePrincipal } from './control-plane-auth.guard.js';
import { BrowserAppRepository } from './browser-app.repository.js';

@Injectable()
export class OrganizationService {
  constructor(@Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository) {}

  async session(principal: ControlPlanePrincipal) {
    const organizations = await this.repository.platformOrganizations(principal.subject);
    const activeOrganization = organizations.find((organization) => organization.id === principal.activePlatformOrganizationId);
    return {
      principal: {
        subject: principal.subject,
        email: principal.email,
        displayName: principal.email?.split('@')[0] ?? principal.subject,
        platformRoles: principal.platformRoles,
        organizationRole: principal.organizationRole,
        permissions: principal.permissions,
        localDevelopment: principal.localDevelopment,
      },
      activeOrganization,
      organizations,
    };
  }

  async create(principal: ControlPlanePrincipal, input: { name?: unknown }) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) {
      throw new BadRequestException('Organization name must contain 2 to 80 characters');
    }
    try {
      return await this.repository.createPlatformOrganization({
        name: input.name.trim(),
        subject: principal.subject,
        email: principal.email,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('Organization already exists');
      throw error;
    }
  }
}
