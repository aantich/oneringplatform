import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import { BrowserAppRepository } from './browser-app.repository.js';

export type ControlPlanePrincipal = { subject: string; email?: string; organizationIds: string[]; superadmin: boolean };
export const PublicControlPlane = () => SetMetadata('controlPlanePublic', true);

@Injectable()
export class ControlPlaneAuthGuard implements CanActivate {
  constructor(@Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler() as unknown as { [key: string]: unknown };
    if (Reflect.getMetadata('controlPlanePublic', handler)) return true;
    const request = context.switchToHttp().getRequest<Request & { controlPrincipal?: ControlPlanePrincipal }>();
    const principal = await this.authenticate(request);
    request.controlPrincipal = principal;
    const rawAppId = request.params?.appId;
    const appId = Array.isArray(rawAppId) ? rawAppId[0] : rawAppId;
    if (appId && !principal.superadmin) {
      const app = await this.repository.findApp(appId);
      if (!app || !principal.organizationIds.includes(app.ownerOrganizationId)) throw new ForbiddenException('Application ownership required');
    }
    return true;
  }

  private async authenticate(request: Request): Promise<ControlPlanePrincipal> {
    const secret = process.env.CONTROL_PLANE_JWT_SECRET;
    if (!secret && process.env.NODE_ENV !== 'production') {
      const address = request.ip || request.socket.remoteAddress || '';
      if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') {
        return { subject: 'local-superadmin', organizationIds: ['everworker-labs'], superadmin: true };
      }
    }
    if (!secret) throw new UnauthorizedException('Control-plane authentication is not configured');
    const authorization = request.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token required');
    try {
      const result = await jwtVerify(authorization.slice(7), new TextEncoder().encode(secret), {
        issuer: 'onering-control-plane', audience: 'onering-platform',
      });
      const organizations = Array.isArray(result.payload.organizationIds)
        ? result.payload.organizationIds.filter((value): value is string => typeof value === 'string') : [];
      return {
        subject: result.payload.sub ?? 'unknown',
        ...(typeof result.payload.email === 'string' ? { email: result.payload.email.toLowerCase() } : {}),
        organizationIds: organizations, superadmin: result.payload.superadmin === true,
      };
    } catch {
      throw new UnauthorizedException('Invalid control-plane token');
    }
  }
}
