import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ControlPlaneAuthGuard, RequirePermission, type ControlPlanePrincipal } from './control-plane-auth.guard.js';
import { OrganizationService } from './organization.service.js';

@Controller()
@UseGuards(ControlPlaneAuthGuard)
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organizations: OrganizationService) {}

  @Get('session')
  @RequirePermission('organization.create')
  session(@Req() req: Request & { controlPrincipal?: ControlPlanePrincipal }) {
    return this.organizations.session(req.controlPrincipal!);
  }

  @Post('organizations')
  @RequirePermission('organization.create')
  create(@Req() req: Request & { controlPrincipal?: ControlPlanePrincipal }, @Body() body: { name?: unknown }) {
    return this.organizations.create(req.controlPrincipal!, body);
  }
}
