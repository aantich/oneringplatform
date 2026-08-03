import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as esbuild from 'esbuild';
import type { AppBuild, BrowserRelease, ReleaseCheck, RouteDefinition } from './browser-app.domain.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppThemeCompilerService } from './browser-app-theme-compiler.service.js';

export const browserRuntimeContractVersion = 2;

const runtimeModule = `const root = document.getElementById('root');
export const basePath = root?.dataset.base || '';
let cached;
export async function bootstrap(force = false) {
  if (!cached || force) {
    const response = await fetch(basePath + '/_or/bootstrap', { credentials: 'include' });
    if (!response.ok) throw new Error('Unable to initialize application session');
    cached = await response.json();
  }
  return cached;
}
export async function api(path, init = {}) {
  const context = await bootstrap();
  const response = await fetch(basePath + '/_or' + path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken, ...(init.method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Request failed (' + response.status + ')');
  return body;
}
export async function setDemoRole(role) {
  const context = await bootstrap();
  const response = await fetch(basePath + '/_or/auth/demo-login', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error('Unable to change demo role');
  cached = await response.json();
  window.dispatchEvent(new CustomEvent('onering:session', { detail: cached }));
  return cached;
}
export async function exchangeIdentity(token, tenantId) {
  const context = await bootstrap();
  const response = await fetch(basePath + '/_or/auth/exchange', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken },
    body: JSON.stringify({ token, tenantId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Unable to establish application session');
  cached = body;
  window.dispatchEvent(new CustomEvent('onering:session', { detail: cached }));
  return cached;
}
export async function switchOrganization(tenantId) {
  const context = await bootstrap();
  const response = await fetch(basePath + '/_or/auth/switch-organization', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken },
    body: JSON.stringify({ tenantId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Unable to switch organization');
  cached = body;
  window.dispatchEvent(new CustomEvent('onering:session', { detail: cached }));
  window.location.reload();
  return cached;
}`;

@Injectable()
export class BrowserAppBuildService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BrowserAppBuildService.name);
  private readonly buildQueues = new Map<string, Promise<void>>();

  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppThemeCompilerService) private readonly themeCompiler: BrowserAppThemeCompilerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const apps = await this.repository.listApps();
    for (const app of apps) {
      const active = await this.repository.activeRelease(app.id);
      if (!active || active.release.tenancyRevision !== app.tenancyRevision || active.release.runtimeVersion !== browserRuntimeContractVersion) {
        try {
          await this.buildAndRelease(app.id);
        } catch (error) {
          this.logger.error(`Browser app ${app.id} failed startup admission and was left on its last valid release`, error instanceof Error ? error.stack : String(error));
        }
      }
    }
  }

  async buildAndRelease(appId: string): Promise<{ build: AppBuild; release: BrowserRelease }> {
    const prior = this.buildQueues.get(appId) ?? Promise.resolve();
    let releaseQueue!: Promise<{ build: AppBuild; release: BrowserRelease }>;
    releaseQueue = prior.catch(() => undefined).then(() => this.executeBuildAndRelease(appId));
    const marker = releaseQueue.then(() => undefined, () => undefined);
    this.buildQueues.set(appId, marker);
    return releaseQueue.finally(() => {
      if (this.buildQueues.get(appId) === marker) this.buildQueues.delete(appId);
    });
  }

  private async executeBuildAndRelease(appId: string): Promise<{ build: AppBuild; release: BrowserRelease }> {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new Error('Browser app not found');
    const theme = detail.themes.find((candidate) => candidate.revision === detail.app.themeRevision);
    if (!theme) throw new Error(`Theme revision ${detail.app.themeRevision} not found`);
    const buildId = randomUUID();
    const createdAt = new Date().toISOString();
    const build: AppBuild = {
      id: buildId,
      appId: detail.app.id,
      sourceRevision: detail.app.sourceRevision,
      themeRevision: theme.revision,
      tenancyRevision: detail.tenancy.revision,
      runtimeVersion: browserRuntimeContractVersion,
      status: 'building',
      css: this.themeCompiler.compile(this.repository.runtimeStyles(), theme),
      themeName: theme.name,
      themeColor: theme.tokens.colors.background,
      moduleCount: detail.modules.length,
      routeCount: detail.routes.length,
      tests: 0,
      checks: [],
      createdAt,
    };
    await this.repository.writeBuild(build);

    try {
      await this.check(build, 'graph', 'Module and route graph', () => this.validateGraph(detail.modules.map((item) => item.id), detail.routes));
      await this.check(build, 'contracts', 'Schema and policy contracts', () => this.validateContracts(detail));
      await this.check(build, 'imports', 'Package allowlist', () => this.validateImports(detail.modules.map((item) => item.source)));
      await this.check(build, 'source-security', 'Browser source security scan', () => this.validateSourceSecurity(detail.modules.map((item) => item.source)));
      await this.check(build, 'tenancy', 'Tenancy isolation contract', () => {
        if (detail.tenancy.mode === 'multi_organization' && !detail.endTenants.some((tenant) => tenant.status === 'active')) throw new Error('Multi-organization apps require an active organization');
      });
      await this.check(build, 'theme', 'Theme accessibility and CSS admission', () => {
        if (theme.accessibility.issues.length) throw new Error(theme.accessibility.issues.join(' '));
        this.themeCompiler.parse(theme);
      });
      const entry = this.createEntry(detail.routes, detail.app.name);
      const modules = new Map(detail.modules.map((item) => [item.id, item.source]));
      let result!: esbuild.BuildResult<{ write: false }>;
      await this.check(build, 'compile', 'Production React compilation', async () => {
        result = await esbuild.build({
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: ['es2022'],
        jsx: 'automatic',
        minify: true,
        sourcemap: false,
        entryPoints: ['app:entry'],
        absWorkingDir: process.cwd(),
        plugins: [{
          name: 'onering-mongo-modules',
          setup(buildApi: esbuild.PluginBuild) {
            buildApi.onResolve({ filter: /^app:entry$/ }, () => ({ path: 'entry', namespace: 'onering-app' }));
            buildApi.onResolve({ filter: /^app:runtime$/ }, () => ({ path: 'runtime', namespace: 'onering-app' }));
            buildApi.onResolve({ filter: /^app:module\// }, (args: esbuild.OnResolveArgs) => ({ path: args.path.slice('app:module/'.length), namespace: 'onering-app' }));
            buildApi.onResolve({ filter: /.*/, namespace: 'onering-app' }, (args: esbuild.OnResolveArgs) =>
              buildApi.resolve(args.path, { kind: args.kind, resolveDir: process.cwd() }),
            );
            buildApi.onLoad({ filter: /^entry$/, namespace: 'onering-app' }, () => ({ contents: entry, loader: 'tsx', resolveDir: process.cwd() }));
            buildApi.onLoad({ filter: /^runtime$/, namespace: 'onering-app' }, () => ({ contents: runtimeModule, loader: 'js', resolveDir: process.cwd() }));
            buildApi.onLoad({ filter: /.*/, namespace: 'onering-app' }, (args: esbuild.OnLoadArgs) => {
              const source = modules.get(args.path);
              if (!source) return { errors: [{ text: `Unknown app module ${args.path}` }] };
              return { contents: source, loader: 'tsx', resolveDir: process.cwd() };
            });
          },
        }],
        });
      });
      const output = result.outputFiles?.find((file) => file.path.endsWith('.js')) ?? result.outputFiles?.[0];
      if (!output) throw new Error('Build produced no JavaScript artifact');
      const digest = createHash('sha256').update(output.contents).digest('hex');
      const fileId = await this.repository.writeArtifact(build.id, Buffer.from(output.contents));
      await this.check(build, 'artifact', 'Immutable artifact digest', () => {
        if (!digest || digest.length !== 64) throw new Error('Artifact digest was not produced');
      });
      const completedAt = new Date().toISOString();
      Object.assign(build, { status: 'passed', artifactFileId: fileId, artifactDigest: `sha256:${digest}`, tests: build.checks.filter((check) => check.status === 'passed').length, completedAt });
      await this.repository.updateBuild(build.id, build);

      const artifactDigest = `sha256:${digest}`;
      const releaseKey = createHash('sha256').update(JSON.stringify({
        appId: detail.app.id, source: detail.app.sourceRevision, schema: detail.app.schemaRevision,
        policy: detail.app.policyRevision, connector: detail.app.connectorRevision,
        theme: theme.revision, tenancy: detail.tenancy.revision, runtime: browserRuntimeContractVersion, artifactDigest,
      })).digest('hex');
      const release: BrowserRelease = {
        id: randomUUID(),
        appId: detail.app.id,
        version: `0.${detail.app.sourceRevision}.${theme.revision}.${detail.tenancy.revision}.${browserRuntimeContractVersion}`,
        buildId: build.id,
        sourceRevision: detail.app.sourceRevision,
        schemaRevision: detail.app.schemaRevision,
        policyRevision: detail.app.policyRevision,
        connectorRevision: detail.app.connectorRevision,
        themeRevision: theme.revision,
        tenancyRevision: detail.tenancy.revision,
        runtimeVersion: browserRuntimeContractVersion,
        artifactDigest,
        releaseKey,
        status: 'active',
        createdAt: completedAt,
      };
      const activated = await this.repository.activateRelease(release);
      this.logger.log(`Published browser app ${appId} release ${activated.version}`);
      return { build, release: activated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Object.assign(build, { status: 'failed', tests: build.checks.filter((check) => check.status === 'passed').length, error: message, completedAt: new Date().toISOString() });
      await this.repository.updateBuild(build.id, build);
      throw error;
    }
  }

  private validateGraph(moduleIds: string[], routes: RouteDefinition[]): void {
    if (!routes.length) throw new Error('A browser app must define at least one route');
    const ids = new Set(moduleIds);
    for (const route of routes) {
      if (!route.path.startsWith('/')) throw new Error(`Route ${route.id} must start with /`);
      if (!ids.has(route.pageModuleId)) throw new Error(`Route ${route.id} references missing module ${route.pageModuleId}`);
    }
  }

  private validateContracts(detail: NonNullable<Awaited<ReturnType<BrowserAppRepository['detail']>>>): void {
    const roles = ['public', 'viewer', 'editor', 'admin'];
    for (const schema of detail.schemas) {
      const policy = detail.policies.find((candidate) => candidate.entity === schema.entity);
      if (!policy) throw new Error(`Entity ${schema.entity} has no policy`);
      for (const role of roles) if (!policy.grants[role as keyof typeof policy.grants]) throw new Error(`Entity ${schema.entity} has no ${role} policy grant`);
      const properties = new Set(Object.keys((schema.jsonSchema.properties ?? {}) as object));
      for (const [role, grant] of Object.entries(policy.grants)) {
        for (const field of [...grant.writeFields, ...grant.readFields]) {
          if (!properties.has(field) && !['id', 'version', 'createdAt', 'updatedAt'].includes(field)) throw new Error(`${role} policy references unknown ${schema.entity}.${field}`);
        }
      }
      if (schema.deploymentMode === 'shared_namespace' && schema.physicalCollection !== this.repository.expectedPhysicalCollection(schema.appId, schema.entity)) {
        throw new Error(`Physical collection for ${schema.entity} is not server-derived`);
      }
    }
    for (const policy of detail.policies) if (!detail.schemas.some((schema) => schema.entity === policy.entity)) throw new Error(`Policy ${policy.id} references a missing entity`);
  }

  private validateImports(sources: string[]): void {
    const allowed = new Set(['react', 'react/jsx-runtime', 'react-router-dom', 'app:runtime']);
    for (const source of sources) {
      const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
      for (const imported of imports) if (!allowed.has(imported) && !imported.startsWith('app:module/')) throw new Error(`Package import is not allowed: ${imported}`);
    }
  }

  private validateSourceSecurity(sources: string[]): void {
    const forbidden = [
      [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'], [/\beval\s*\(/, 'eval'], [/new\s+Function\b/, 'Function constructor'],
      [/document\.cookie/, 'document.cookie'], [/\.innerHTML\s*=/, 'innerHTML assignment'], [/javascript\s*:/i, 'javascript URL'],
    ] as const;
    for (const source of sources) for (const [pattern, label] of forbidden) if (pattern.test(source)) throw new Error(`Generated source uses forbidden ${label}`);
  }

  private async check(build: AppBuild, id: string, label: string, action: () => void | Promise<void>): Promise<void> {
    const started = Date.now();
    try {
      await action();
      build.checks.push({ id, label, status: 'passed', detail: 'Verified by the server release pipeline.', durationMs: Date.now() - started });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const check: ReleaseCheck = { id, label, status: 'failed', detail, durationMs: Date.now() - started };
      build.checks.push(check);
      throw error;
    } finally {
      await this.repository.updateBuild(build.id, { checks: build.checks, tests: build.checks.filter((candidate) => candidate.status === 'passed').length });
    }
  }

  private createEntry(routes: RouteDefinition[], appName: string): string {
    const imports = routes.map((route, index) => `import Page${index} from 'app:module/${route.pageModuleId}';`).join('\n');
    const routeElements = routes.map((route, index) => `<Route path=${JSON.stringify(route.path)} element={<RouteGate isPublic={${route.public}} required={${JSON.stringify(route.requiredCapabilities)}}><Page${index} /></RouteGate>} />`).join('\n');
    const navigation = routes
      .filter((route) => route.navigation)
      .map((route) => `<NavLink to=${JSON.stringify(route.path)}>{${JSON.stringify(route.navigation?.label)}}</NavLink>`)
      .join('\n');
    return `import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { basePath, bootstrap, switchOrganization } from 'app:runtime';
${imports}
function RuntimeIdentity() {
  const [session, setSession] = useState();
  useEffect(() => {
    const receive = (event) => setSession(event.detail);
    bootstrap().then(setSession).catch(() => undefined);
    window.addEventListener('onering:session', receive);
    return () => window.removeEventListener('onering:session', receive);
  }, []);
  if (!session) return <span className="runtime-badge">Secure session</span>;
  const tenancy = session.tenancy;
  if (tenancy.mode === 'multi_organization' && session.principal.role !== 'public') {
    return <label className="runtime-identity"><span>{tenancy.organizationLabel}</span><select aria-label={'Active ' + tenancy.organizationLabel} value={tenancy.activeOrganization?.id || ''} onChange={(event) => void switchOrganization(event.target.value)}>{tenancy.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label>;
  }
  return <span className="runtime-badge">{tenancy.mode === 'personal' ? 'Personal app' : tenancy.mode === 'team' ? 'Team workspace' : 'Public access'}</span>;
}
function RouteGate({ isPublic, required, children }) {
  const [session, setSession] = useState();
  useEffect(() => { bootstrap().then(setSession).catch(() => setSession({ error: true })); }, []);
  if (!session) return <main className="about-page"><span className="eyebrow">LOADING</span><h1>Checking access…</h1></main>;
  if (session.error || (!isPublic && session.principal.role === 'public') || required.some((capability) => !session.capabilities.includes(capability))) return <main className="about-page"><span className="eyebrow">ACCESS DENIED</span><h1>You do not have permission to open this page.</h1></main>;
  return children;
}
function Application() { return <BrowserRouter basename={basePath || undefined}><div className="app-frame"><header className="app-nav"><div className="brand"><span className="brand-mark">◉</span><span>{${JSON.stringify(appName)}}</span></div><nav>${navigation}</nav><RuntimeIdentity /></header><Routes>${routeElements}<Route path="*" element={<main className="about-page"><span className="eyebrow">404</span><h1>That page is not in this release.</h1></main>} /></Routes></div></BrowserRouter> }
createRoot(document.getElementById('root')).render(<React.StrictMode><Application /></React.StrictMode>);`;
  }
}
