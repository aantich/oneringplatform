import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { BuilderAgent, SpecArtifact } from './domain.js';
import { PlatformService } from './platform.service.js';
import { ControlPlaneAuthGuard, PublicControlPlane } from './control-plane-auth.guard.js';

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
  bootstrap() {
    return this.platform.bootstrap();
  }

  @Get('projects/:projectId')
  project(@Param('projectId') projectId: string) {
    return this.platform.project(projectId);
  }

  @Post('projects/:projectId/interview')
  interview(@Param('projectId') projectId: string, @Body() body: { content?: string }) {
    return this.platform.interview(projectId, body.content ?? '');
  }

  @Post('projects/:projectId/approve-prd')
  approvePrd(@Param('projectId') projectId: string) {
    return this.platform.approvePrd(projectId);
  }

  @Patch('projects/:projectId/artifacts/:artifactId')
  updateArtifact(
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: Partial<SpecArtifact>,
  ) {
    return this.platform.updateArtifact(projectId, artifactId, body);
  }

  @Patch('builder-agents/:agentId')
  updateAgent(@Param('agentId') agentId: string, @Body() body: Partial<BuilderAgent>) {
    return this.platform.updateAgent(agentId, body);
  }

  @Post('projects/:projectId/runs')
  startRun(@Param('projectId') projectId: string) {
    return this.platform.startRun(projectId);
  }

  @Post('releases/:releaseId/promote')
  promote(@Param('releaseId') releaseId: string) {
    return this.platform.promote(releaseId);
  }
}
