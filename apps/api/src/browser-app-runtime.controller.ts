import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppRuntimeService } from './browser-app-runtime.service.js';

@Controller('apps')
export class BrowserAppRuntimeController {
  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppRuntimeService) private readonly runtime: BrowserAppRuntimeService,
  ) {}

  @Get(':appKey/_or/bootstrap')
  bootstrap(@Param('appKey') appKey: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.bootstrap(appKey, req, res, this.base(appKey, req));
  }

  @Post(':appKey/_or/auth/demo-login')
  demoLogin(
    @Param('appKey') appKey: string,
    @Body() body: { role?: unknown; tenantId?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.runtime.demoLogin(appKey, body.role, body.tenantId, req, res, this.base(appKey, req));
  }

  @Post(':appKey/_or/auth/exchange')
  exchangeIdentity(
    @Param('appKey') appKey: string,
    @Body() body: { token?: unknown; tenantId?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.runtime.exchangeIdentity(appKey, body.token, body.tenantId, req, res, this.base(appKey, req));
  }

  @Post(':appKey/_or/auth/switch-organization')
  switchOrganization(
    @Param('appKey') appKey: string,
    @Body() body: { tenantId?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.runtime.switchOrganization(appKey, body.tenantId, req, res, this.base(appKey, req));
  }

  @Get(':appKey/_or/data/:entity')
  list(@Param('appKey') appKey: string, @Param('entity') entity: string, @Query('limit') limit: string | undefined, @Query('cursor') cursor: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.list(appKey, entity, limit, cursor, req, res, this.base(appKey, req));
  }

  @Get(':appKey/_or/data/:entity/:id')
  get(@Param('appKey') appKey: string, @Param('entity') entity: string, @Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.get(appKey, entity, id, req, res, this.base(appKey, req));
  }

  @Post(':appKey/_or/data/:entity')
  create(@Param('appKey') appKey: string, @Param('entity') entity: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.create(appKey, entity, body, req, res, this.base(appKey, req));
  }

  @Patch(':appKey/_or/data/:entity/:id')
  update(@Param('appKey') appKey: string, @Param('entity') entity: string, @Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.update(appKey, entity, id, body, req, res, this.base(appKey, req));
  }

  @Delete(':appKey/_or/data/:entity/:id')
  delete(@Param('appKey') appKey: string, @Param('entity') entity: string, @Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.runtime.delete(appKey, entity, id, req, res, this.base(appKey, req));
  }

  @Post(':appKey/_or/connectors/:connectorId/actions/:action')
  connector(
    @Param('appKey') appKey: string,
    @Param('connectorId') connectorId: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.runtime.connector(appKey, connectorId, action, body, req, res, this.base(appKey, req));
  }

  @Get(':appKey/_or/assets/:buildId/app.js')
  async javascript(@Param('appKey') appKey: string, @Param('buildId') buildId: string, @Res() res: Response) {
    const app = await this.repository.findApp(appKey);
    const build = app ? await this.repository.findBuild(buildId) : null;
    if (!app || !build || build.appId !== app.id || build.status !== 'passed' || !build.artifactFileId) return res.status(404).end();
    const artifact = await this.repository.readArtifact(build.artifactFileId);
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('etag', build.artifactDigest ?? build.id);
    return res.send(artifact);
  }

  @Get(':appKey/_or/assets/:buildId/app.css')
  async stylesheet(@Param('appKey') appKey: string, @Param('buildId') buildId: string, @Res() res: Response) {
    const app = await this.repository.findApp(appKey);
    const build = app ? await this.repository.findBuild(buildId) : null;
    if (!app || !build || build.appId !== app.id || build.status !== 'passed') return res.status(404).end();
    res.setHeader('content-type', 'text/css; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    return res.send(build.css);
  }

  @Get(':appKey')
  @Header('cache-control', 'no-store')
  shellRoot(@Param('appKey') appKey: string, @Req() req: Request, @Res() res: Response) {
    return this.shell(appKey, req, res);
  }

  @Get(':appKey/*path')
  @Header('cache-control', 'no-store')
  shellRoute(@Param('appKey') appKey: string, @Req() req: Request, @Res() res: Response) {
    return this.shell(appKey, req, res);
  }

  private async shell(appKey: string, req: Request, res: Response) {
    const app = await this.repository.findApp(appKey);
    const active = app ? await this.repository.activeRelease(app.id) : null;
    if (!app || !active || !active.build.artifactFileId) return res.status(404).send('Application release not found');
    const base = this.base(app.publicKey, req);
    const title = this.escape(app.name);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    return res.send(`<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="theme-color" content="${active.build.themeColor || '#090b13'}"/><title>${title}</title><link rel="stylesheet" href="${base}/_or/assets/${active.build.id}/app.css"/></head><body><div id="root" data-base="${base}"></div><script type="module" src="${base}/_or/assets/${active.build.id}/app.js"></script></body></html>`);
  }

  private base(appKey: string, req?: Request): string {
    if (req?.headers['x-onering-route-base'] === 'root') return '';
    return `/apps/${encodeURIComponent(appKey)}`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  }
}
