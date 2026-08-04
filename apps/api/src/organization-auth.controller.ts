import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ControlPlaneAuthGuard, PublicControlPlane, RequirePermission, type ControlPlanePrincipal } from './control-plane-auth.guard.js';
import { ControlPlaneIdentityService } from './control-plane-identity.service.js';
import { OrganizationAuthService } from './organization-auth.service.js';
import type { CreateLocalUserInput, CreateOrganizationConnectorInput } from './organization-auth.types.js';
import { BrowserAppRepository } from './browser-app.repository.js';

@Controller()
@UseGuards(ControlPlaneAuthGuard)
export class OrganizationAuthController {
  constructor(
    @Inject(OrganizationAuthService) private readonly authentication: OrganizationAuthService,
    @Inject(ControlPlaneIdentityService) private readonly identities: ControlPlaneIdentityService,
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
  ) {}

  @Get('auth/organizations/:slug')
  @PublicControlPlane()
  publicConfiguration(@Param('slug') slug: string) {
    return this.authentication.publicConfiguration(slug);
  }

  @Post('auth/organizations/:slug/oauth/start')
  @PublicControlPlane()
  startOAuth(@Param('slug') slug: string, @Body() body: { connectorId?: unknown }, @Req() request: Request) {
    return this.authentication.startOAuthLogin(
      slug,
      typeof body.connectorId === 'string' ? body.connectorId : '',
      request.ip || request.socket.remoteAddress || 'unknown',
    );
  }

  @Get('auth/oauth/callback')
  @PublicControlPlane()
  async oauthCallback(
    @Query('state') state: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      const callbackUrl = `${request.protocol}://${request.get('host')}${request.originalUrl}`;
      const redirect = await this.authentication.completeOAuthLogin(callbackUrl, state, response);
      response.redirect(redirect);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      response.redirect(`${process.env.WEB_APP_ORIGIN ?? 'http://127.0.0.1:5173'}/login?error=${encodeURIComponent(message)}`);
    }
  }

  @Post('auth/organizations/:slug/password')
  @PublicControlPlane()
  passwordLogin(
    @Param('slug') slug: string,
    @Body() body: { email?: unknown; password?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authentication.loginWithPassword(
      slug,
      body.email,
      body.password,
      response,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
  }

  @Post('auth/logout')
  @PublicControlPlane()
  logout(@Res({ passthrough: true }) response: Response) {
    this.identities.clearSessionCookie(response);
    return { ok: true };
  }

  @Post('session/organization')
  @RequirePermission('organization.create')
  async switchOrganization(
    @Req() request: Request & { controlPrincipal?: ControlPlanePrincipal },
    @Body() body: { organizationId?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (typeof body.organizationId !== 'string') throw new BadRequestException('organizationId is required');
    const principal = request.controlPrincipal!;
    const membership = await this.repository.platformMembership(principal.subject, body.organizationId);
    if (!membership || membership.status !== 'active') throw new ForbiddenException('Organization membership required');
    const token = await this.identities.issueSession({
      subject: principal.subject,
      email: principal.email,
      activePlatformOrganizationId: body.organizationId,
      localDevelopment: principal.localDevelopment,
    });
    this.identities.setSessionCookie(response, token);
    return { ok: true, organizationId: body.organizationId };
  }

  @Get('organizations/:organizationId/connector-templates')
  @RequirePermission('secrets.manage')
  connectorTemplates() {
    return this.authentication.connectorTemplates();
  }

  @Get('organizations/:organizationId/connectors')
  @RequirePermission('secrets.manage')
  connectors(@Param('organizationId') organizationId: string) {
    return this.authentication.listConnectors(organizationId);
  }

  @Post('organizations/:organizationId/connectors')
  @RequirePermission('secrets.manage')
  createConnector(
    @Param('organizationId') organizationId: string,
    @Body() body: CreateOrganizationConnectorInput,
  ) {
    return this.authentication.createConnector(organizationId, body);
  }

  @Patch('organizations/:organizationId/connectors/:connectorId/login-provider')
  @RequirePermission('secrets.manage')
  setLoginProvider(
    @Param('organizationId') organizationId: string,
    @Param('connectorId') connectorId: string,
    @Body() body: { enabled?: unknown; autoCreateUsers?: unknown; allowedDomains?: unknown },
  ) {
    return this.authentication.setLoginProvider(organizationId, connectorId, body);
  }

  @Patch('organizations/:organizationId/authentication/local-password')
  @RequirePermission('organization.members.manage')
  setLocalPassword(@Param('organizationId') organizationId: string, @Body() body: { enabled?: unknown }) {
    return this.authentication.setLocalPasswordEnabled(organizationId, body.enabled);
  }

  @Post('organizations/:organizationId/local-users')
  @RequirePermission('organization.members.manage')
  createLocalUser(@Param('organizationId') organizationId: string, @Body() body: CreateLocalUserInput) {
    return this.authentication.createLocalUser(organizationId, body);
  }
}
