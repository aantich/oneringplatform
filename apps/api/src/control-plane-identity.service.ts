import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';

export const CONTROL_PLANE_SESSION_COOKIE = 'onering_session';
const SESSION_SECONDS = 8 * 60 * 60;

export type AuthenticatedControlPlaneIdentity = {
  subject: string;
  email?: string;
  activePlatformOrganizationId?: string;
  localDevelopment: boolean;
};

@Injectable()
export class ControlPlaneIdentityService {
  async authenticate(request: Request): Promise<AuthenticatedControlPlaneIdentity> {
    const authorization = request.get('authorization');
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const cookieToken = this.readCookie(request, CONTROL_PLANE_SESSION_COOKIE);
    const token = bearerToken ?? cookieToken;
    if (token) return this.verifySession(token);

    const localEnabled = process.env.LOCAL_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production';
    const address = request.ip || request.socket.remoteAddress || '';
    if (localEnabled && (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1')) {
      const subjectHeader = request.get('x-local-subject');
      const subject = subjectHeader?.trim() || 'local-superadmin';
      const organizationHeader = request.get('x-platform-organization-id')?.trim();
      return {
        subject,
        email: `${subject.replace(/[^a-z0-9._-]/gi, '-')}@local.onering.dev`,
        ...(organizationHeader
          ? { activePlatformOrganizationId: organizationHeader }
          : subject === 'local-superadmin'
            ? { activePlatformOrganizationId: 'everworker-labs' }
            : {}),
        localDevelopment: true,
      };
    }
    throw new UnauthorizedException('Control-plane session required');
  }

  async issueSession(identity: {
    subject: string;
    email?: string;
    activePlatformOrganizationId?: string;
    localDevelopment?: boolean;
  }): Promise<string> {
    const secret = this.sessionSecret();
    return new SignJWT({
      ...(identity.email ? { email: identity.email.toLowerCase() } : {}),
      ...(identity.activePlatformOrganizationId
        ? { activePlatformOrganizationId: identity.activePlatformOrganizationId }
        : {}),
      ...(identity.localDevelopment ? { localDevelopment: true } : {}),
      sessionId: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(identity.subject)
      .setIssuer('onering-control-plane')
      .setAudience('onering-platform')
      .setIssuedAt()
      .setExpirationTime(`${SESSION_SECONDS}s`)
      .sign(new TextEncoder().encode(secret));
  }

  setSessionCookie(response: Response, token: string): void {
    response.cookie(CONTROL_PLANE_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_SECONDS * 1000,
      path: '/',
    });
  }

  clearSessionCookie(response: Response): void {
    response.clearCookie(CONTROL_PLANE_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  private async verifySession(token: string): Promise<AuthenticatedControlPlaneIdentity> {
    try {
      const result = await jwtVerify(token, new TextEncoder().encode(this.sessionSecret()), {
        issuer: 'onering-control-plane',
        audience: 'onering-platform',
      });
      if (!result.payload.sub) throw new Error('Missing subject');
      return {
        subject: result.payload.sub,
        ...(typeof result.payload.email === 'string' ? { email: result.payload.email.toLowerCase() } : {}),
        ...(typeof result.payload.activePlatformOrganizationId === 'string'
          ? { activePlatformOrganizationId: result.payload.activePlatformOrganizationId }
          : {}),
        localDevelopment: result.payload.localDevelopment === true,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired control-plane session');
    }
  }

  private sessionSecret(): string {
    const configured = process.env.CONTROL_PLANE_JWT_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CONTROL_PLANE_JWT_SECRET is required');
    }
    return 'onering-local-development-session-secret-do-not-use-in-production';
  }

  private readCookie(request: Request, name: string): string | undefined {
    const raw = request.headers.cookie;
    if (!raw) return undefined;
    for (const part of raw.split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === name) return decodeURIComponent(value.join('='));
    }
    return undefined;
  }
}
