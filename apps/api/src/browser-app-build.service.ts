import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as esbuild from 'esbuild';
import type { AppBuild, BrowserRelease, ReleaseCheck, RouteDefinition } from './browser-app.domain.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppThemeCompilerService } from './browser-app-theme-compiler.service.js';
import { browserRuntimeContractVersion } from './browser-runtime-capabilities.js';

export { browserRuntimeContractVersion } from './browser-runtime-capabilities.js';
export const browserGeneratorVersion = 'browser-graph-v2';

const runtimeModule = `const root = document.getElementById('root');
export const basePath = root?.dataset.base || '';
const previewHeaders = root?.dataset.previewRelease && root?.dataset.previewToken ? {
  'x-onering-preview-release': root.dataset.previewRelease,
  'x-onering-preview-token': root.dataset.previewToken,
} : {};
let cached;
export async function bootstrap(force = false) {
  if (!cached || force) {
    const response = await fetch(basePath + '/_or/bootstrap', { credentials: 'include', headers: previewHeaders });
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
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken, ...previewHeaders, ...(init.method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Request failed (' + response.status + ')');
  return body;
}
const segment = (value) => encodeURIComponent(String(value));
export const data = Object.freeze({
  list(entity, options = {}) {
    const query = new URLSearchParams();
    if (options.limit != null) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', String(options.cursor));
    const suffix = query.size ? '?' + query.toString() : '';
    return api('/data/' + segment(entity) + suffix);
  },
  get(entity, id) { return api('/data/' + segment(entity) + '/' + segment(id)); },
  create(entity, value) { return api('/data/' + segment(entity), { method: 'POST', body: JSON.stringify(value) }); },
  update(entity, id, value, version) { return api('/data/' + segment(entity) + '/' + segment(id), { method: 'PATCH', headers: { 'if-match': String(version) }, body: JSON.stringify(value) }); },
  remove(entity, id, version) { return api('/data/' + segment(entity) + '/' + segment(id), { method: 'DELETE', headers: { 'if-match': String(version) } }); },
});
export function invokeConnector(connectorId, action, input = {}) {
  return api('/connectors/' + segment(connectorId) + '/actions/' + segment(action), { method: 'POST', body: JSON.stringify(input) });
}
export async function setDemoRole(role) {
  const context = await bootstrap();
  const response = await fetch(basePath + '/_or/auth/demo-login', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken, ...previewHeaders },
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
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken, ...previewHeaders },
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
    headers: { 'content-type': 'application/json', 'x-csrf-token': context.csrfToken, ...previewHeaders },
    body: JSON.stringify({ tenantId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Unable to switch organization');
  cached = body;
  window.dispatchEvent(new CustomEvent('onering:session', { detail: cached }));
  window.location.reload();
  return cached;
}
export async function runAgent(agentId, goal, options = {}) {
  if (typeof agentId !== 'string' || typeof goal !== 'string' || goal.trim().length < 3) throw new Error('Agent and goal are required');
  const history = Array.isArray(options.history) ? [...options.history] : [];
  const maximum = Number.isInteger(options.maximumIterations) ? Math.min(12, Math.max(1, options.maximumIterations)) : 8;
  for (let iteration = 1; iteration <= maximum; iteration += 1) {
    const turn = await api('/agents/' + encodeURIComponent(agentId) + '/turn', {
      method: 'POST', body: JSON.stringify({ goal: goal.trim(), iteration, history }),
    });
    options.onEvent?.({ type: 'turn', iteration, turn });
    if (turn.type === 'final') return { output: turn.output, iterations: iteration, history };
    if (turn.type === 'approval') {
      if (typeof options.onApproval !== 'function') throw new Error(turn.message || 'This agent action requires approval');
      const approved = await options.onApproval(turn.message);
      if (!approved) throw new Error('Agent action was not approved');
      history.push({ role: 'assistant', content: 'Human approval granted: ' + turn.message });
    } else if (turn.type === 'tool') {
      const separator = String(turn.toolId).indexOf(':');
      if (separator < 1) throw new Error('Agent requested an invalid tool');
      const connectorId = turn.toolId.slice(0, separator);
      const action = turn.toolId.slice(separator + 1);
      history.push({ role: 'assistant', content: JSON.stringify({ toolId: turn.toolId, input: turn.input }) });
      const result = await api('/connectors/' + encodeURIComponent(connectorId) + '/actions/' + encodeURIComponent(action), {
        method: 'POST', body: JSON.stringify(turn.input || {}),
      });
      history.push({ role: 'tool', content: JSON.stringify({ toolId: turn.toolId, result }) });
      options.onEvent?.({ type: 'tool', iteration, toolId: turn.toolId, result });
    } else throw new Error('Agent returned an unknown turn type');
    await options.onCheckpoint?.({ agentId, goal, iteration, history: [...history] });
    if (turn.maximumIterations && iteration >= turn.maximumIterations) break;
  }
  throw new Error('Agent reached its iteration limit without a final response');
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
      await this.repository.expireIncompatiblePreviews(app.id, browserRuntimeContractVersion, browserGeneratorVersion);
      if (app.sourceRevision === 0 || app.lifecycleStatus === 'draft' || app.lifecycleStatus === 'specifying' || app.lifecycleStatus === 'generation_failed') continue;
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

  async buildAndRelease(appId: string, options: { activate?: boolean } = {}): Promise<{ build: AppBuild; release: BrowserRelease }> {
    const prior = this.buildQueues.get(appId) ?? Promise.resolve();
    let releaseQueue!: Promise<{ build: AppBuild; release: BrowserRelease }>;
    releaseQueue = prior.catch(() => undefined).then(() => this.executeBuildAndRelease(appId, options.activate ?? true));
    const marker = releaseQueue.then(() => undefined, () => undefined);
    this.buildQueues.set(appId, marker);
    return releaseQueue.finally(() => {
      if (this.buildQueues.get(appId) === marker) this.buildQueues.delete(appId);
    });
  }

  private async executeBuildAndRelease(appId: string, activate: boolean): Promise<{ build: AppBuild; release: BrowserRelease }> {
    const detail = await this.repository.detail(appId);
    if (!detail) throw new Error('Browser app not found');
    const theme = detail.themes.find((candidate) => candidate.revision === detail.app.themeRevision);
    if (!theme) throw new Error(`Theme revision ${detail.app.themeRevision} not found`);
    const buildId = randomUUID();
    const createdAt = new Date().toISOString();
    const build: AppBuild = {
      id: buildId,
      appId: detail.app.id,
      specRevision: detail.app.specRevision,
      sourceRevision: detail.app.sourceRevision,
      themeRevision: theme.revision,
      tenancyRevision: detail.tenancy.revision,
      runtimeVersion: browserRuntimeContractVersion,
      generationProfile: detail.app.generationProfile,
      status: 'building',
      css: this.themeCompiler.compile(this.repository.runtimeStyles(), theme),
      themeName: theme.name,
      themeColor: theme.tokens.colors.background,
      moduleCount: detail.modules.length,
      routeCount: detail.routes.length,
      tests: 0,
      checks: [],
      acceptance: { total: detail.specification.structure.acceptanceCriteria.length, covered: 0, requirementIds: [] },
      createdAt,
    };
    await this.repository.writeBuild(build);

    try {
      await this.check(build, 'graph', 'Module and route graph', () => this.validateGraph(detail.modules.map((item) => item.id), detail.routes));
      await this.check(build, 'specification', 'Structured specification contract', () => this.validateSpecification(detail));
      await this.check(build, 'semantic-alignment', 'Specification and generated experience alignment', () => this.validateSemanticAlignment(detail));
      await this.check(build, 'traceability', 'Requirement and acceptance coverage', () => {
        build.acceptance = this.validateTraceability(detail);
      });
      await this.check(build, 'acceptance', 'Executable acceptance contracts', () => this.validateAcceptance(detail));
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
        appId: detail.app.id, spec: detail.app.specRevision, source: detail.app.sourceRevision, schema: detail.app.schemaRevision,
        policy: detail.app.policyRevision, connector: detail.app.connectorRevision,
        theme: theme.revision, tenancy: detail.tenancy.revision, runtime: browserRuntimeContractVersion,
        generationAgents: detail.app.generationProfile?.agents, artifactDigest,
      })).digest('hex');
      const release: BrowserRelease = {
        id: randomUUID(),
        appId: detail.app.id,
        specRevision: detail.app.specRevision,
        version: `0.${detail.app.specRevision}.${detail.app.sourceRevision}.${theme.revision}.${detail.tenancy.revision}.${browserRuntimeContractVersion}`,
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
        environment: activate ? 'production' : 'preview',
        status: activate ? 'active' : 'preview',
        ...(activate ? {} : { previewToken: randomUUID() }),
        generatorVersion: browserGeneratorVersion,
        generationProfile: detail.app.generationProfile,
        createdAt: completedAt,
      };
      const published = activate ? await this.repository.activateRelease(release) : await this.repository.publishPreview(release);
      this.logger.log(`${activate ? 'Published' : 'Prepared preview for'} browser app ${appId} release ${published.version}`);
      return { build, release: published };
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
    const connectorTools = new Set(detail.connectors.map((connector) => `${connector.id}:${connector.action}`));
    for (const agent of detail.agents) {
      for (const toolId of agent.toolIds) if (!connectorTools.has(toolId)) throw new Error(`Browser agent ${agent.id} references missing connector tool ${toolId}`);
      if (agent.maximumIterations < 1 || agent.maximumIterations > 12) throw new Error(`Browser agent ${agent.id} has an invalid iteration budget`);
    }
  }

  private validateSpecification(detail: NonNullable<Awaited<ReturnType<BrowserAppRepository['detail']>>>): void {
    const specification = detail.specification.structure;
    if (detail.app.generatedFromSpecRevision !== detail.app.specRevision) throw new Error('Source graph was not generated from the current specification revision');
    if (!specification.purpose.trim()) throw new Error('The structured specification needs an application purpose');
    if (!specification.pages.length) throw new Error('The structured specification needs at least one page');
    const paths = new Set(detail.routes.map((route) => route.path));
    const specifiedPaths = new Set(specification.pages.map((page) => page.path));
    const specifiedPageIds = new Set(specification.pages.map((page) => page.id));
    for (const page of specification.pages) {
      if (!paths.has(page.path)) throw new Error(`Specified page ${page.id} has no route at ${page.path}`);
      if (!detail.routes.some((route) => route.specPageId === page.id && route.path === page.path)) throw new Error(`Specified page ${page.id} is not linked to its route`);
      if (!page.states.includes('ready')) throw new Error(`Specified page ${page.id} must define its ready state`);
    }
    for (const route of detail.routes) if (!specifiedPaths.has(route.path) || !specifiedPageIds.has(route.specPageId)) throw new Error(`Route ${route.id} is not declared by the structured specification`);
    const entityIds = new Set(detail.schemas.map((schema) => schema.entity));
    for (const entity of specification.entities) if (!entityIds.has(entity.id)) throw new Error(`Specified entity ${entity.id} has no data schema`);
    const specifiedEntityIds = new Set(specification.entities.map((entity) => entity.id));
    for (const entity of detail.schemas) if (!specifiedEntityIds.has(entity.entity)) throw new Error(`Data schema ${entity.entity} is not declared by the structured specification`);
    const agentIds = new Set(detail.agents.map((agent) => agent.id));
    for (const agent of specification.agents) if (!agentIds.has(agent.id)) throw new Error(`Specified browser agent ${agent.id} has no executable agent definition`);
    const specifiedAgentIds = new Set(specification.agents.map((agent) => agent.id));
    for (const agent of detail.agents) if (!specifiedAgentIds.has(agent.id)) throw new Error(`Browser agent ${agent.id} is not declared by the structured specification`);
    const criterionIds = new Set(specification.acceptanceCriteria.map((criterion) => criterion.id));
    for (const page of specification.pages) for (const id of page.acceptanceCriterionIds) {
      if (!criterionIds.has(id)) throw new Error(`Page ${page.id} references unknown acceptance criterion ${id}`);
    }
    for (const workflow of specification.workflows) {
      const pages = specification.pages.filter((page) => page.workflowIds.includes(workflow.id));
      if (!pages.length) throw new Error(`Browser workflow ${workflow.id} is not attached to a page`);
      if (workflow.steps.some((step) => step.type === 'agent') && !pages.some((page) => page.agentIds.length)) throw new Error(`Browser workflow ${workflow.id} has an agent step but no page agent`);
      if (workflow.steps.some((step) => step.type === 'data_read' || step.type === 'data_write') && !pages.some((page) => page.entityIds.length)) throw new Error(`Browser workflow ${workflow.id} has a data step but no page entity`);
    }
  }

  private validateTraceability(detail: NonNullable<Awaited<ReturnType<BrowserAppRepository['detail']>>>) {
    const requirementIds = new Set(detail.specification.sections.map((section) => section.id));
    const referenced = new Set([
      ...detail.modules.flatMap((item) => item.requirementIds),
      ...detail.routes.flatMap((item) => item.requirementIds),
      ...detail.schemas.flatMap((item) => item.requirementIds),
      ...detail.policies.flatMap((item) => item.requirementIds),
      ...detail.connectors.flatMap((item) => item.requirementIds),
      ...detail.agents.flatMap((item) => item.requirementIds),
    ]);
    for (const id of referenced) if (!requirementIds.has(id)) throw new Error(`Generated graph references unknown requirement ${id}`);
    const covered = [...requirementIds].filter((id) => referenced.has(id));
    if (covered.length !== requirementIds.size) {
      throw new Error(`Requirements without generated coverage: ${[...requirementIds].filter((id) => !referenced.has(id)).join(', ')}`);
    }
    const acceptanceRequirementIds = detail.specification.structure.acceptanceCriteria.map((criterion) => criterion.requirementId);
    for (const id of acceptanceRequirementIds) if (!requirementIds.has(id)) throw new Error(`Acceptance criterion references unknown requirement ${id}`);
    return { total: acceptanceRequirementIds.length, covered: acceptanceRequirementIds.filter((id) => referenced.has(id)).length, requirementIds: covered };
  }

  private validateSemanticAlignment(detail: NonNullable<Awaited<ReturnType<BrowserAppRepository['detail']>>>): void {
    const specification = detail.specification;
    const declared = [
      specification.structure.purpose,
      ...specification.sections.flatMap((section) => [section.title, section.body]),
      ...specification.structure.pages.flatMap((page) => [page.name, page.purpose]),
      ...specification.structure.entities.flatMap((entity) => [entity.name, entity.description]),
      ...specification.structure.agents.flatMap((agent) => [agent.name, agent.purpose]),
    ].join('\n').toLowerCase();
    const generated = detail.modules.map((module) => `${module.name}\n${module.description}\n${module.source}`).join('\n').toLowerCase();
    const criteria = specification.structure.acceptanceCriteria.map((criterion) => criterion.description).join('\n').toLowerCase();
    const contamination = [
      { phrase: 'fieldops', declaredConcept: /field\s*ops|field service|technician/ },
      { phrase: 'technician assigned', declaredConcept: /technician|field service/ },
      { phrase: 'team tasks', declaredConcept: /task|work item|team work/ },
      { phrase: 'suggest my next task', declaredConcept: /task|work item|team work/ },
      { phrase: 'make progress visible', declaredConcept: /task|progress|team work/ },
      { phrase: 'acme operations', declaredConcept: /acme|operations|operational/ },
    ];
    for (const { phrase, declaredConcept } of contamination) {
      if (!declaredConcept.test(declared) && (generated.includes(phrase) || criteria.includes(phrase))) {
        throw new Error(`Generated experience contains unrelated seeded concept: ${phrase}`);
      }
    }
    for (const page of specification.structure.pages) {
      const route = detail.routes.find((candidate) => candidate.specPageId === page.id);
      const module = route && detail.modules.find((candidate) => candidate.id === route.pageModuleId);
      if (!module) throw new Error(`Page ${page.name} has no generated module`);
      if (module.name !== page.name || module.description !== page.purpose) throw new Error(`Page ${page.name} implementation metadata is stale`);
      const expectedRequirementIds = new Set(page.acceptanceCriterionIds.flatMap((criterionId) => {
        const criterion = specification.structure.acceptanceCriteria.find((candidate) => candidate.id === criterionId);
        return criterion ? [criterion.requirementId] : [];
      }));
      for (const requirementId of expectedRequirementIds) if (!module.requirementIds.includes(requirementId)) throw new Error(`Page ${page.name} does not trace requirement ${requirementId}`);
    }
    const editorialSignals = [
      specification.structure.purpose,
      ...specification.structure.pages.flatMap((page) => [page.id, page.name, page.purpose]),
      ...specification.structure.entities.flatMap((entity) => [entity.id, entity.name, entity.description]),
      ...specification.structure.agents.flatMap((agent) => [agent.id, agent.name, agent.purpose]),
    ].join('\n').toLowerCase();
    const purposeLooksEditorial = /\b(blog|blogging|journal|article|story|stories|editorial|publishing)\b/.test(editorialSignals);
    if (purposeLooksEditorial) {
      if (!specification.structure.entities.some((entity) => entity.id === 'articles')) throw new Error('Editorial applications require an articles entity');
      if (!specification.structure.pages.some((page) => page.public) || !specification.structure.pages.some((page) => !page.public)) throw new Error('Editorial applications require both public reading and private editorial pages');
      const articleSchema = detail.schemas.find((schema) => schema.entity === 'articles');
      const articlePolicy = detail.policies.find((policy) => policy.entity === 'articles');
      if (!articleSchema?.publicRecordFilter || !articlePolicy?.grants.public.operations.includes('read')) throw new Error('Published articles need an explicit public-read filter and policy');
    }
  }

  private validateAcceptance(detail: NonNullable<Awaited<ReturnType<BrowserAppRepository['detail']>>>): void {
    const specification = detail.specification.structure;
    for (const criterion of specification.acceptanceCriteria) {
      const pages = specification.pages.filter((page) => page.acceptanceCriterionIds.includes(criterion.id));
      if (criterion.kind === 'journey' && !pages.length) throw new Error(`Journey criterion ${criterion.id} is not attached to a page`);
      const accessibilityPages = pages.length ? pages : specification.pages;
      if (criterion.kind === 'accessibility' && (!accessibilityPages.length || accessibilityPages.some((page) => !page.states.includes('ready')))) {
        throw new Error(`Accessibility criterion ${criterion.id} has no ready-state page contract`);
      }
      if (criterion.kind === 'data') {
        const entities = detail.schemas.filter((schema) => schema.requirementIds.includes(criterion.requirementId));
        if (!entities.length || entities.some((schema) => !detail.policies.some((policy) => policy.entity === schema.entity && policy.requirementIds.includes(criterion.requirementId)))) {
          throw new Error(`Data criterion ${criterion.id} is not covered by a schema and policy pair`);
        }
      }
      if (criterion.kind === 'policy' && !detail.policies.some((policy) => policy.requirementIds.includes(criterion.requirementId))) {
        throw new Error(`Policy criterion ${criterion.id} has no policy evidence`);
      }
      if (criterion.kind === 'agent' && !detail.agents.some((agent) => agent.requirementIds.includes(criterion.requirementId))) {
        throw new Error(`Agent criterion ${criterion.id} has no browser-agent evidence`);
      }
    }
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
      [/\bfetch\s*\(/, 'direct fetch (use app:runtime)'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
      [/\bWebSocket\s*\(/, 'WebSocket'], [/\bEventSource\s*\(/, 'EventSource'], [/sendBeacon\s*\(/, 'sendBeacon'],
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
      .filter((route) => route.navigation && !route.path.includes(':'))
      .map((route) => `<NavLink to=${JSON.stringify(route.path)}>{${JSON.stringify(route.navigation?.label)}}</NavLink>`)
      .join('\n');
    return `import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { basePath, bootstrap, setDemoRole, switchOrganization } from 'app:runtime';
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
  if (session.demoAuthentication) {
    return <div className="runtime-identity-cluster"><label className="runtime-identity"><span>Test role</span><select aria-label="Test application role" value={session.principal.role} onChange={(event) => void setDemoRole(event.target.value)}>{['public','viewer','editor','admin'].map((role) => <option key={role} value={role}>{role}</option>)}</select></label>{tenancy.mode === 'multi_organization' && session.principal.role !== 'public' && <label className="runtime-identity"><span>{tenancy.organizationLabel}</span><select aria-label={'Active ' + tenancy.organizationLabel} value={tenancy.activeOrganization?.id || ''} onChange={(event) => void switchOrganization(event.target.value)}>{tenancy.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label>}</div>;
  }
  if (tenancy.mode === 'multi_organization' && session.principal.role !== 'public') {
    return <label className="runtime-identity"><span>{tenancy.organizationLabel}</span><select aria-label={'Active ' + tenancy.organizationLabel} value={tenancy.activeOrganization?.id || ''} onChange={(event) => void switchOrganization(event.target.value)}>{tenancy.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label>;
  }
  return <span className="runtime-badge">{tenancy.mode === 'personal' ? 'Personal app' : tenancy.mode === 'team' ? 'Team workspace' : 'Public access'}</span>;
}
function RouteGate({ isPublic, required, children }) {
  const [session, setSession] = useState();
  useEffect(() => {
    const receive = (event) => setSession(event.detail);
    bootstrap().then(setSession).catch(() => setSession({ error: true }));
    window.addEventListener('onering:session', receive);
    return () => window.removeEventListener('onering:session', receive);
  }, []);
  if (!session) return <main className="about-page"><span className="eyebrow">LOADING</span><h1>Checking access…</h1></main>;
  if (session.error || (!isPublic && session.principal.role === 'public') || required.some((capability) => !session.capabilities.includes(capability))) return <main className="about-page"><span className="eyebrow">ACCESS DENIED</span><h1>You do not have permission to open this page.</h1></main>;
  return children;
}
function Application() { return <BrowserRouter basename={basePath || undefined}><div className="app-frame"><header className="app-nav"><div className="brand"><span className="brand-mark">◉</span><span>{${JSON.stringify(appName)}}</span></div><nav>${navigation}</nav><RuntimeIdentity /></header><Routes>${routeElements}<Route path="*" element={<main className="about-page"><span className="eyebrow">404</span><h1>That page is not in this release.</h1></main>} /></Routes></div></BrowserRouter> }
createRoot(document.getElementById('root')).render(<React.StrictMode><Application /></React.StrictMode>);`;
  }
}
