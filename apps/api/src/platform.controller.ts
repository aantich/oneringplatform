import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { BuilderAgent, SpecArtifact } from './domain.js';
import { PlatformService } from './platform.service.js';
import { ControlPlaneAuthGuard, PublicControlPlane, RequirePermission, type ControlPlanePrincipal } from './control-plane-auth.guard.js';

@Controller()
@UseGuards(ControlPlaneAuthGuard)
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get('health')
  @PublicControlPlane()
  health() {
    return { ok: true, service: 'onering-platform-api', time: new Date().toISOString() };
  }

  @Get('bootstrap')
  @RequirePermission('organization.read')
  bootstrap(@Req() req: Request & { controlPrincipal?: ControlPlanePrincipal }) {
    return this.platform.bootstrap(req.controlPrincipal!.permissions.includes('platform.builder_system.manage'));
  }

  @Get('projects/:projectId')
  @RequirePermission('app.read')
  project(@Param('projectId') projectId: string) {
    return this.platform.project(projectId);
  }

  @Post('projects/:projectId/interview')
  @RequirePermission('app.write')
  interview(@Param('projectId') projectId: string, @Body() body: { content?: string }) {
    return this.platform.interview(projectId, body.content ?? '');
  }

  @Post('projects/:projectId/approve-prd')
  @RequirePermission('app.write')
  approvePrd(@Param('projectId') projectId: string) {
    return this.platform.approvePrd(projectId);
  }

  @Patch('projects/:projectId/artifacts/:artifactId')
  @RequirePermission('app.write')
  updateArtifact(
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: Partial<SpecArtifact>,
  ) {
    return this.platform.updateArtifact(projectId, artifactId, body);
  }

  @Patch('builder-agents/:agentId')
  @RequirePermission('platform.builder_system.manage')
  updateAgent(@Param('agentId') agentId: string, @Body() body: Partial<BuilderAgent>) {
    return this.platform.updateAgent(agentId, body);
  }

  @Post('projects/:projectId/runs')
  @RequirePermission('release.create')
  startRun(@Param('projectId') projectId: string) {
    return this.platform.startRun(projectId);
  }

  @Post('releases/:releaseId/promote')
  @RequirePermission('release.promote')
  promote(@Param('releaseId') releaseId: string) {
    return this.platform.promote(releaseId);
  }
}
