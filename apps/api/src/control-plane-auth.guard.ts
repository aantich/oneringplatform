import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { BrowserAppRepository } from './browser-app.repository.js';
import { ControlPlaneIdentityService } from './control-plane-identity.service.js';

export const CONTROL_PLANE_PUBLIC = 'controlPlanePublic';
export const CONTROL_PLANE_PERMISSIONS = 'controlPlanePermissions';

export type PlatformRole = 'platform_root' | 'platform_operator' | 'platform_security_admin' | 'platform_support' | 'platform_billing_admin';
export type OrganizationRole = 'owner' | 'admin' | 'builder' | 'release_manager' | 'secrets_admin' | 'billing' | 'viewer';
export type ControlPlanePermission =
  | 'platform.builder_system.manage'
  | 'organization.create'
  | 'organization.read'
  | 'organization.members.manage'
  | 'app.read'
  | 'app.create'
  | 'app.write'
  | 'app.admin'
  | 'release.create'
  | 'release.promote'
  | 'secrets.manage'
  | 'billing.read';

export type ControlPlanePrincipal = {
  subject: string;
  email?: string;
  activePlatformOrganizationId?: string;
  membershipId?: string;
  membershipVersion?: number;
  organizationRole?: OrganizationRole;
  platformRoles: PlatformRole[];
  permissions: ControlPlanePermission[];
  localDevelopment: boolean;
};

const organizationPermissions: ControlPlanePermission[] = [
  'organization.create', 'organization.read', 'organization.members.manage',
  'app.read', 'app.create', 'app.write', 'app.admin', 'release.create', 'release.promote', 'secrets.manage', 'billing.read',
];

const platformRootPermissions: ControlPlanePermission[] = ['platform.builder_system.manage', 'organization.create'];

const organizationRolePermissions: Record<OrganizationRole, ControlPlanePermission[]> = {
  owner: organizationPermissions,
  admin: ['organization.create', 'organization.read', 'organization.members.manage', 'app.read', 'app.create', 'app.write', 'app.admin', 'release.create', 'release.promote', 'secrets.manage', 'billing.read'],
  builder: ['organization.create', 'organization.read', 'app.read', 'app.create', 'app.write', 'release.create'],
  release_manager: ['organization.create', 'organization.read', 'app.read', 'release.create', 'release.promote'],
  secrets_admin: ['organization.create', 'organization.read', 'app.read', 'secrets.manage'],
  billing: ['organization.create', 'organization.read', 'billing.read'],
  viewer: ['organization.create', 'organization.read', 'app.read'],
};

export const PublicControlPlane = () => SetMetadata(CONTROL_PLANE_PUBLIC, true);
export const RequirePermission = (...permissions: ControlPlanePermission[]) => SetMetadata(CONTROL_PLANE_PERMISSIONS, permissions);

@Injectable()
export class ControlPlaneAuthGuard implements CanActivate {
  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(ControlPlaneIdentityService) private readonly identities: ControlPlaneIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler() as unknown as { [key: string]: unknown };
    if (Reflect.getMetadata(CONTROL_PLANE_PUBLIC, handler)) return true;

    const request = context.switchToHttp().getRequest<Request & { controlPrincipal?: ControlPlanePrincipal }>();
    const identity = await this.identities.authenticate(request);
    const platformRoles = await this.repository.platformRoles(identity.subject);
    const membership = identity.activePlatformOrganizationId
      ? await this.repository.platformMembership(identity.subject, identity.activePlatformOrganizationId)
      : undefined;
    const permissions = new Set<ControlPlanePermission>(['organization.create']);
    if (platformRoles.includes('platform_root')) platformRootPermissions.forEach((permission) => permissions.add(permission));
    if (membership?.status === 'active') organizationRolePermissions[membership.role].forEach((permission) => permissions.add(permission));

    const principal: ControlPlanePrincipal = {
      subject: identity.subject,
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.activePlatformOrganizationId ? { activePlatformOrganizationId: identity.activePlatformOrganizationId } : {}),
      ...(membership?.status === 'active' ? {
        membershipId: membership.id,
        membershipVersion: membership.version,
        organizationRole: membership.role,
      } : {}),
      platformRoles,
      permissions: [...permissions],
      localDevelopment: identity.localDevelopment,
    };
    request.controlPrincipal = principal;

    const required = Reflect.getMetadata(CONTROL_PLANE_PERMISSIONS, handler) as ControlPlanePermission[] | undefined;
    if (!required?.length) throw new ForbiddenException('Authorization policy is missing');
    if (!required.every((permission) => permissions.has(permission))) throw new ForbiddenException('Required permission is missing');

    const rawOrganizationId = request.params?.organizationId;
    const organizationId = Array.isArray(rawOrganizationId) ? rawOrganizationId[0] : rawOrganizationId;
    if (organizationId && organizationId !== principal.activePlatformOrganizationId) {
      throw new ForbiddenException('The requested organization is not the active organization');
    }

    const rawAppId = request.params?.appId;
    const appId = Array.isArray(rawAppId) ? rawAppId[0] : rawAppId;
    if (appId) {
      const app = await this.repository.findApp(appId);
      if (!app || !principal.activePlatformOrganizationId || app.platformOrganizationId !== principal.activePlatformOrganizationId) {
        throw new ForbiddenException('Application ownership required in the active organization');
      }
    }
    return true;
  }

}
