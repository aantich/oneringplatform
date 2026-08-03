import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BrowserAppService } from './browser-app.service.js';
import { BrowserAppThemeService } from './browser-app-theme.service.js';
import { BrowserAppTenancyService } from './browser-app-tenancy.service.js';
import { ControlPlaneAuthGuard, PublicControlPlane, type ControlPlanePrincipal } from './control-plane-auth.guard.js';

@Controller('browser-apps')
@UseGuards(ControlPlaneAuthGuard)
export class BrowserAppController {
  constructor(
    @Inject(BrowserAppService) private readonly browserApps: BrowserAppService,
    @Inject(BrowserAppThemeService) private readonly themes: BrowserAppThemeService,
    @Inject(BrowserAppTenancyService) private readonly tenancy: BrowserAppTenancyService,
  ) {}

  @Get()
  list(@Req() req: Request & { controlPrincipal?: ControlPlanePrincipal }) {
    return this.browserApps.list(req.controlPrincipal);
  }

  @Post()
  create(
    @Body() body: { name?: unknown; description?: unknown; mode?: unknown; ownerOrganizationId?: unknown },
    @Req() req: Request & { controlPrincipal?: ControlPlanePrincipal },
  ) {
    return this.browserApps.create(body, req.controlPrincipal!);
  }

  @Get('resolve-route')
  @PublicControlPlane()
  resolve(@Query('hostname') hostname = 'localhost', @Query('pathname') pathname = '/') {
    return this.browserApps.resolveRoute(hostname, pathname);
  }

  @Get('theme-starters')
  themeStarters() {
    return this.themes.starters();
  }

  @Get(':appId')
  detail(@Param('appId') appId: string) {
    return this.browserApps.detail(appId);
  }

  @Post(':appId/generate')
  generate(@Param('appId') appId: string, @Body() body: { instruction?: string }) {
    return this.browserApps.generate(appId, body.instruction);
  }

  @Patch(':appId/specification')
  reviseSpecification(
    @Param('appId') appId: string,
    @Body() body: { expectedRevision?: unknown; sections?: unknown },
  ) {
    return this.browserApps.reviseSpecification(appId, body);
  }

  @Post(':appId/tenancy')
  async configureTenancy(@Param('appId') appId: string, @Body() body: { mode?: unknown; organizationLabel?: unknown; defaultTenantId?: unknown }) {
    const result = await this.tenancy.configure(appId, body);
    return { ...result, detail: await this.browserApps.detail(appId) };
  }

  @Post(':appId/tenancy/preview')
  previewTenancy(@Param('appId') appId: string, @Body() body: { mode?: unknown; defaultTenantId?: unknown }) {
    return this.tenancy.preview(appId, body);
  }

  @Post(':appId/organizations')
  async createOrganization(@Param('appId') appId: string, @Body() body: { name?: unknown }) {
    const organization = await this.tenancy.createOrganization(appId, body);
    return { organization, detail: await this.browserApps.detail(appId) };
  }

  @Post(':appId/memberships')
  async inviteMembership(
    @Param('appId') appId: string,
    @Body() body: { email?: unknown; displayName?: unknown; role?: unknown; tenantId?: unknown },
  ) {
    const membership = await this.tenancy.invite(appId, body);
    return { membership, detail: await this.browserApps.detail(appId) };
  }

  @Patch(':appId/memberships/:membershipId')
  async updateMembership(
    @Param('appId') appId: string, @Param('membershipId') membershipId: string,
    @Body() body: { role?: unknown; status?: unknown },
  ) {
    const membership = await this.tenancy.updateMembership(appId, membershipId, body);
    return { membership, detail: await this.browserApps.detail(appId) };
  }

  @Patch(':appId/organizations/:tenantId')
  async updateOrganization(
    @Param('appId') appId: string, @Param('tenantId') tenantId: string, @Body() body: { status?: unknown },
  ) {
    const organization = await this.tenancy.updateOrganization(appId, tenantId, body.status);
    return { organization, detail: await this.browserApps.detail(appId) };
  }

  @Post(':appId/build')
  build(@Param('appId') appId: string) {
    return this.browserApps.build(appId);
  }

  @Post(':appId/themes')
  createTheme(@Param('appId') appId: string, @Body() body: unknown) {
    return this.themes.createDraft(appId, body);
  }

  @Post(':appId/themes/preview')
  previewTheme(@Body() body: unknown) {
    return this.themes.preview(body);
  }

  @Post(':appId/themes/generate')
  generateTheme(@Param('appId') appId: string, @Body() body: { direction?: string }) {
    return this.themes.generate(appId, body.direction ?? '');
  }

  @Post(':appId/themes/:revision/publish')
  async publishTheme(@Param('appId') appId: string, @Param('revision') revision: string) {
    const result = await this.themes.publish(appId, Number(revision));
    return { ...result, detail: await this.browserApps.detail(appId) };
  }

  @Post(':appId/bindings')
  createBinding(@Param('appId') appId: string, @Body() body: { hostname?: string; type?: string; pathPrefix?: string }) {
    return this.browserApps.createBinding(appId, body);
  }

  @Post(':appId/bindings/:bindingId/verify')
  verifyBinding(
    @Param('appId') appId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: { developmentProof?: string },
  ) {
    return this.browserApps.verifyBinding(appId, bindingId, body.developmentProof);
  }
}
