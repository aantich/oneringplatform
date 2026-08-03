import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { AppModule } from './app.module.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { StoreService } from './store.service.js';

describe('platform API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGO_URI = process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27017/oneringplatform_test';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'apps', method: RequestMethod.ALL },
        { path: 'apps/*path', method: RequestMethod.ALL },
      ],
    });
    module.get(StoreService).reset();
    await app.init();
  });

  afterAll(async () => {
    await app.get(BrowserAppRepository).db().dropDatabase();
    await app.close();
  });

  it('returns a visual, traceable seed project without secret values', async () => {
    const response = await request(app.getHttpServer()).get('/api/bootstrap').expect(200);
    expect(response.body.projects[0].artifacts.length).toBeGreaterThan(10);
    expect(response.body.agents).toHaveLength(10);
    expect(response.body.connectors[0]).not.toHaveProperty('apiKey');
    expect(JSON.stringify(response.body)).not.toContain(process.env.OPENAI_API_KEY || 'impossible-secret');
  });

  it('updates an artifact through the canonical structured spec', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/projects/fieldops-ai/artifacts/story-triage')
      .send({ description: 'Updated traceable behavior' })
      .expect(200);
    expect(response.body.description).toBe('Updated traceable behavior');

    const project = await request(app.getHttpServer()).get('/api/projects/fieldops-ai').expect(200);
    expect(project.body.specVersion).toBe(13);
  });

  it('runs the interview safely without configured LLM credentials', async () => {
    const openai = process.env.OPENAI_API_KEY;
    const anthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const response = await request(app.getHttpServer())
      .post('/api/projects/fieldops-ai/interview')
      .send({ content: 'Escalate to the manager first, then use approved contractors.' })
      .expect(201);
    expect(response.body.reply).toContain('contractor');
    expect(response.body.project.interview.at(-1).role).toBe('assistant');
    if (openai) process.env.OPENAI_API_KEY = openai;
    if (anthropic) process.env.ANTHROPIC_API_KEY = anthropic;
  });

  it('creates an isolated development run with mandatory verification gates', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/projects/fieldops-ai/runs')
      .expect(201);
    expect(response.body.workspace).toMatch(/^workspace-/);
    expect(response.body.steps.map((step: { id: string }) => step.id)).toEqual([
      'checkout', 'generate', 'unit', 'integration', 'review', 'release',
    ]);
  });

  it('promotes an immutable release idempotently', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/releases/rel-preview-11/promote')
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/releases/rel-preview-11/promote')
      .expect(201);
    expect(first.body.environment).toBe('production');
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.artifactDigest).toBe(first.body.artifactDigest);
  });

  it('stores a versioned module graph in MongoDB and publishes a browser release', async () => {
    const list = await request(app.getHttpServer()).get('/api/browser-apps').expect(200);
    expect(list.body[0]).toMatchObject({ id: 'pulse-tasks', runtimeProfile: 'browser_data', moduleCount: 2, routeCount: 2 });

    const detail = await request(app.getHttpServer()).get('/api/browser-apps/pulse-tasks').expect(200);
    expect(detail.body.modules.map((module: { kind: string }) => module.kind)).toEqual(['page', 'page']);
    expect(detail.body.routes[0]).toHaveProperty('pageModuleId');
    expect(detail.body.releases[0].status).toBe('active');

    const shell = await request(app.getHttpServer()).get('/apps/pulse-tasks/about').expect(200);
    expect(shell.headers['content-security-policy']).toContain("script-src 'self'");
    expect(shell.text).toContain('/apps/pulse-tasks/_or/assets/');
  });

  it('enforces public filtering, CSRF, role operations, and field allowlists', async () => {
    const browser = request.agent(app.getHttpServer());
    const initial = await browser.get('/apps/pulse-tasks/_or/bootstrap').expect(200);
    expect(initial.body.principal.role).toBe('public');

    const publicTasks = await browser.get('/apps/pulse-tasks/_or/data/tasks').expect(200);
    expect(publicTasks.body.items).toHaveLength(1);
    expect(publicTasks.body.items[0].visibility).toBe('public');

    await browser
      .post('/apps/pulse-tasks/_or/data/tasks')
      .send({ title: 'Forbidden', status: 'todo', visibility: 'members' })
      .expect(403);

    const editor = await browser
      .post('/apps/pulse-tasks/_or/auth/demo-login')
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ role: 'editor' })
      .expect(201);

    await browser
      .post('/apps/pulse-tasks/_or/data/tasks')
      .set('x-csrf-token', editor.body.csrfToken)
      .send({ title: 'Injected', status: 'todo', visibility: 'members', appId: 'another-app' })
      .expect(403);

    const created = await browser
      .post('/apps/pulse-tasks/_or/data/tasks')
      .set('x-csrf-token', editor.body.csrfToken)
      .set('idempotency-key', 'create-secure-task-once')
      .send({ title: 'Created through secure gateway', status: 'todo', visibility: 'members' })
      .expect(201);
    expect(created.body).not.toHaveProperty('appId');
    expect(created.body.version).toBe(1);
    const retried = await browser.post('/apps/pulse-tasks/_or/data/tasks')
      .set('x-csrf-token', editor.body.csrfToken).set('idempotency-key', 'create-secure-task-once')
      .send({ title: 'Created through secure gateway', status: 'todo', visibility: 'members' }).expect(201);
    expect(retried.body.id).toBe(created.body.id);

    await browser.patch(`/apps/pulse-tasks/_or/data/tasks/${created.body.id}`)
      .set('x-csrf-token', editor.body.csrfToken).set('if-match', '999')
      .send({ status: 'doing' }).expect(400);
    const updated = await browser.patch(`/apps/pulse-tasks/_or/data/tasks/${created.body.id}`)
      .set('x-csrf-token', editor.body.csrfToken).set('if-match', String(created.body.version))
      .send({ status: 'doing' }).expect(200);
    expect(updated.body.version).toBe(2);
    const audit = await app.get(BrowserAppRepository).db().collection('data_audit_events')
      .find({ appId: 'pulse-tasks', recordId: created.body.id }).sort({ createdAt: 1 }).toArray();
    expect(audit.map((event) => event.operation)).toEqual(['create', 'update']);

    await browser
      .delete(`/apps/pulse-tasks/_or/data/tasks/${created.body.id}`)
      .set('x-csrf-token', editor.body.csrfToken)
      .expect(403);
  });

  it('enforces organization membership and tenant isolation independently of browser input', async () => {
    const browser = request.agent(app.getHttpServer());
    const initial = await browser.get('/apps/pulse-tasks/_or/bootstrap').expect(200);
    expect(initial.body.tenancy).toMatchObject({ mode: 'multi_organization', organizationLabel: 'Organization' });

    const admin = await browser
      .post('/apps/pulse-tasks/_or/auth/demo-login')
      .set('x-csrf-token', initial.body.csrfToken)
      .send({ role: 'admin', tenantId: 'northwind' })
      .expect(201);
    expect(admin.body.principal).toMatchObject({ role: 'admin', tenantId: 'northwind' });
    expect(admin.body.tenancy.organizations).toHaveLength(2);

    const firstPage = await browser.get('/apps/pulse-tasks/_or/data/tasks?limit=1').expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toBeTruthy();
    const secondPage = await browser.get(`/apps/pulse-tasks/_or/data/tasks?limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`).expect(200);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    const created = await browser
      .post('/apps/pulse-tasks/_or/data/tasks')
      .set('x-csrf-token', admin.body.csrfToken)
      .send({ title: 'Northwind private record', status: 'todo', visibility: 'members' })
      .expect(201);
    expect(created.body).not.toHaveProperty('tenantId');

    const globex = await browser
      .post('/apps/pulse-tasks/_or/auth/switch-organization')
      .set('x-csrf-token', admin.body.csrfToken)
      .send({ tenantId: 'globex' })
      .expect(201);
    expect(globex.body.principal.tenantId).toBe('globex');

    const globexTasks = await browser.get('/apps/pulse-tasks/_or/data/tasks').expect(200);
    expect(globexTasks.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
    expect(globexTasks.body.items.some((item: { id: string }) => item.id === 'task-globex-private')).toBe(true);
    await browser.get(`/apps/pulse-tasks/_or/data/tasks/${created.body.id}`).expect(404);

    await browser
      .post('/apps/pulse-tasks/_or/auth/switch-organization')
      .set('x-csrf-token', globex.body.csrfToken)
      .send({ tenantId: 'not-a-membership' })
      .expect(403);

    const stored = await app.get(BrowserAppRepository).findEntity('a_pulse_tasks_prod_tasks', { id: created.body.id });
    expect(stored?.tenantId).toBe('northwind');
  });

  it('publishes all three application audience contracts and manages organizations and members', async () => {
    const assignmentsBefore = await app.get(BrowserAppRepository).db().collection('a_pulse_tasks_prod_tasks')
      .find({ appId: 'pulse-tasks', tenantId: { $exists: true } }).project({ _id: 0, id: 1, tenantId: 1 }).sort({ id: 1 }).toArray();
    const organization = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/organizations')
      .send({ name: 'Acme Service Group' })
      .expect(201);
    expect(organization.body.organization.name).toBe('Acme Service Group');

    const invitation = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/memberships')
      .send({ displayName: 'Mia Operator', email: 'mia@acme.example', role: 'editor', tenantId: organization.body.organization.id })
      .expect(201);
    expect(invitation.body.membership).toMatchObject({ status: 'invited', roles: ['editor'] });

    const team = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/tenancy')
      .send({ mode: 'team', organizationLabel: 'Organization' })
      .expect(201);
    expect(team.body.detail).toMatchObject({ app: { tenancyMode: 'team', tenancyRevision: 2 }, tenancy: { mode: 'team', revision: 2 } });
    expect(team.body.detail.releases[0]).toMatchObject({ status: 'active', tenancyRevision: 2 });

    const personal = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/tenancy')
      .send({ mode: 'personal', organizationLabel: 'Organization' })
      .expect(201);
    expect(personal.body.detail.tenancy.mode).toBe('personal');
    await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/memberships')
      .send({ displayName: 'Blocked User', email: 'blocked@example.com', role: 'viewer' })
      .expect(400);

    const multi = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/tenancy')
      .send({ mode: 'multi_organization', organizationLabel: 'Customer organization' })
      .expect(201);
    expect(multi.body.detail).toMatchObject({ app: { tenancyMode: 'multi_organization', tenancyRevision: 4 }, tenancy: { mode: 'multi_organization', organizationLabel: 'Customer organization' } });
    expect(multi.body.detail.builds[0].checks.map((check: { id: string }) => check.id)).toEqual([
      'graph', 'contracts', 'imports', 'source-security', 'tenancy', 'theme', 'compile', 'artifact',
    ]);
    expect(multi.body.detail.builds[0].checks.every((check: { status: string }) => check.status === 'passed')).toBe(true);

    const privateRecords = await app.get(BrowserAppRepository).db().collection('a_pulse_tasks_prod_tasks')
      .find({ appId: 'pulse-tasks', visibility: { $ne: 'public' } }).toArray();
    expect(privateRecords.every((record) => typeof record.tenantId === 'string')).toBe(true);
    const assignmentsAfter = await app.get(BrowserAppRepository).db().collection('a_pulse_tasks_prod_tasks')
      .find({ id: { $in: assignmentsBefore.map((record) => record.id) } }).project({ _id: 0, id: 1, tenantId: 1 }).sort({ id: 1 }).toArray();
    expect(assignmentsAfter).toEqual(assignmentsBefore);
  });

  it('resolves path and hostname bindings independently of the release', async () => {
    const path = await request(app.getHttpServer())
      .get('/api/browser-apps/resolve-route?hostname=localhost&pathname=/apps/pulse-tasks/about')
      .expect(200);
    expect(path.body).toMatchObject({ appId: 'pulse-tasks', binding: { type: 'platform_path' } });

    const host = await request(app.getHttpServer())
      .get('/api/browser-apps/resolve-route?hostname=pulse.apps.localhost&pathname=/about')
      .expect(200);
    expect(host.body).toMatchObject({ appId: 'pulse-tasks', binding: { type: 'platform_hostname' } });
  });

  it('exchanges a one-time broker identity token for an invited app membership', async () => {
    const secret = 'identity-exchange-test-secret-at-least-32-characters';
    process.env.IDENTITY_EXCHANGE_SECRET = secret;
    try {
      const repository = app.get(BrowserAppRepository);
      const invited = await repository.db().collection('app_memberships').findOne({ appId: 'pulse-tasks', email: 'mia@acme.example' });
      expect(invited?.status).toBe('invited');
      const token = await new SignJWT({ email: 'mia@acme.example' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuer('onering-identity').setAudience('pulse-tasks')
        .setSubject('identity-user-mia').setJti('one-time-mia').setIssuedAt().setExpirationTime('5m')
        .sign(new TextEncoder().encode(secret));
      const browser = request.agent(app.getHttpServer());
      const initial = await browser.get('/apps/pulse-tasks/_or/bootstrap').expect(200);
      const exchanged = await browser.post('/apps/pulse-tasks/_or/auth/exchange')
        .set('x-csrf-token', initial.body.csrfToken)
        .send({ token, tenantId: invited?.tenantId }).expect(201);
      expect(exchanged.body.principal).toMatchObject({ subject: 'identity-user-mia', role: 'editor', tenantId: invited?.tenantId });
      await browser.post('/apps/pulse-tasks/_or/auth/exchange')
        .set('x-csrf-token', exchanged.body.csrfToken)
        .send({ token, tenantId: invited?.tenantId }).expect(401);
      const activated = await repository.db().collection('app_memberships').findOne({ id: invited?.id });
      expect(activated).toMatchObject({ userId: 'identity-user-mia', status: 'active' });
    } finally {
      delete process.env.IDENTITY_EXCHANGE_SECRET;
    }
  });

  it('claims, verifies, and activates an exact custom hostname', async () => {
    const claim = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/bindings')
      .send({ hostname: 'pulse.customer.localhost', type: 'custom_hostname' })
      .expect(201);
    expect(claim.body).toMatchObject({ status: 'pending_verification', certificateStatus: 'pending' });
    expect(claim.body.verificationToken).toBeTruthy();

    const verified = await request(app.getHttpServer())
      .post(`/api/browser-apps/pulse-tasks/bindings/${claim.body.id}/verify`)
      .send({ developmentProof: claim.body.verificationToken })
      .expect(201);
    expect(verified.body).toMatchObject({ status: 'active', certificateStatus: 'active' });
    expect(verified.body).not.toHaveProperty('verificationToken');

    const resolved = await request(app.getHttpServer())
      .get('/api/browser-apps/resolve-route?hostname=pulse.customer.localhost&pathname=/about')
      .expect(200);
    expect(resolved.body).toMatchObject({ appId: 'pulse-tasks', binding: { type: 'custom_hostname' } });
  });

  it('creates, validates, publishes, and pins an independent visual theme revision', async () => {
    const starters = await request(app.getHttpServer()).get('/api/browser-apps/theme-starters').expect(200);
    expect(starters.body).toHaveLength(5);
    const paper = starters.body.find((starter: { id: string }) => starter.id === 'paper-studio');

    const preview = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/themes/preview')
      .send({ ...paper, customCss: '.hero-card { outline: 1px solid var(--or-primary); }' })
      .expect(201);
    expect(preview.body.scopedCss).toContain('.app-frame .hero-card');

    const draft = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/themes')
      .send({ ...paper, customCss: '.hero-card { outline: 1px solid var(--or-primary); }' })
      .expect(201);
    expect(draft.body).toMatchObject({ revision: 2, status: 'draft', createdBy: 'user' });
    expect(draft.body.accessibility.issues).toEqual([]);

    const published = await request(app.getHttpServer())
      .post(`/api/browser-apps/pulse-tasks/themes/${draft.body.revision}/publish`)
      .expect(201);
    expect(published.body.theme.status).toBe('published');
    expect(published.body.detail.app.themeRevision).toBe(2);
    expect(published.body.detail.releases[0]).toMatchObject({ status: 'active', themeRevision: 2 });
    const build = published.body.detail.builds.find((candidate: { id: string }) => candidate.id === published.body.detail.releases[0].buildId);
    expect(build).toMatchObject({ themeRevision: 2, themeName: 'Paper Studio', themeColor: '#f5f3ee' });

    const shell = await request(app.getHttpServer()).get('/apps/pulse-tasks/').expect(200);
    expect(shell.text).toContain('content="#f5f3ee"');
  });

  it('blocks publishing a theme that fails contrast and CSS safety gates', async () => {
    const starters = await request(app.getHttpServer()).get('/api/browser-apps/theme-starters').expect(200);
    const unsafe = structuredClone(starters.body[0]);
    unsafe.name = 'Invisible controls';
    unsafe.tokens.colors.primaryContrast = unsafe.tokens.colors.primary;
    const draft = await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/themes')
      .send({ ...unsafe, customCss: '' })
      .expect(201);
    expect(draft.body.accessibility.issues.length).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post(`/api/browser-apps/pulse-tasks/themes/${draft.body.revision}/publish`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/themes')
      .send({ ...starters.body[0], customCss: '@import url(https://evil.example/style.css);' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/browser-apps/pulse-tasks/themes')
      .send({ ...starters.body[0], customCss: '.runtime-identity { display: none; }' })
      .expect(400);
  });

  it('versions the per-app living requirements without letting source generation move the pointer backward', async () => {
    const before = await request(app.getHttpServer()).get('/api/browser-apps/pulse-tasks').expect(200);
    const revised = await request(app.getHttpServer())
      .patch('/api/browser-apps/pulse-tasks/specification')
      .send({
        expectedRevision: before.body.specification.revision,
        sections: before.body.specification.sections.map((section: { id: string; title: string; body: string }) =>
          section.id === 'goal' ? { ...section, body: `${section.body} Preserve offline recovery states.` } : section),
      })
      .expect(200);
    expect(revised.body.specification.revision).toBe(before.body.specification.revision + 1);
    await app.get(BrowserAppRepository).createGeneratedRevision('pulse-tasks', '#806cff', 'Requirements-safe source revision.');
    const after = await request(app.getHttpServer()).get('/api/browser-apps/pulse-tasks').expect(200);
    expect(after.body.app.specRevision).toBe(revised.body.specification.revision);
    expect(after.body.specification.sections.find((section: { id: string }) => section.id === 'goal').body).toContain('offline recovery');
  });

  it('creates independently selectable app graphs instead of reusing the seeded app', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/browser-apps')
      .send({ name: 'Launch Ledger', description: 'Track launch decisions and ownership.', mode: 'team' })
      .expect(201);
    expect(created.body.detail.app).toMatchObject({ id: 'launch-ledger', tenancyMode: 'team', sourceRevision: 1 });
    expect(created.body.detail.specification.appId).toBe('launch-ledger');
    expect(created.body.detail.modules.every((module: { appId: string }) => module.appId === 'launch-ledger')).toBe(true);
    const list = await request(app.getHttpServer()).get('/api/browser-apps').expect(200);
    expect(list.body.map((candidate: { id: string }) => candidate.id)).toContain('launch-ledger');
    await request(app.getHttpServer()).get('/apps/launch-ledger/').expect(200);
  });

  it('enforces record filters for updates and projects only readable fields', async () => {
    const repository = app.get(BrowserAppRepository);
    const collection = repository.db().collection('app_policies');
    const appRecord = await repository.findApp('pulse-tasks');
    expect(appRecord).toBeTruthy();
    await collection.updateOne(
      { appId: 'pulse-tasks', revision: appRecord!.policyRevision, entity: 'tasks' },
      { $set: { 'grants.editor.readFilter': { status: 'todo' }, 'grants.editor.readFields': ['id', 'title', 'status'] } },
    );
    try {
      const browser = request.agent(app.getHttpServer());
      const initial = await browser.get('/apps/pulse-tasks/_or/bootstrap').expect(200);
      const editor = await browser.post('/apps/pulse-tasks/_or/auth/demo-login')
        .set('x-csrf-token', initial.body.csrfToken).send({ role: 'editor' }).expect(201);
      const listed = await browser.get('/apps/pulse-tasks/_or/data/tasks').expect(200);
      expect(listed.body.items.every((item: { status: string }) => item.status === 'todo')).toBe(true);
      expect(listed.body.items.every((item: object) => !Object.hasOwn(item, 'description'))).toBe(true);
      await browser.patch('/apps/pulse-tasks/_or/data/tasks/task-secure-data')
        .set('x-csrf-token', editor.body.csrfToken).send({ status: 'done' }).expect(404);
    } finally {
      await collection.updateOne(
        { appId: 'pulse-tasks', revision: appRecord!.policyRevision, entity: 'tasks' },
        { $unset: { 'grants.editor.readFilter': '' }, $set: { 'grants.editor.readFields': ['id', 'title', 'description', 'status', 'visibility', 'createdAt', 'updatedAt'] } },
      );
    }
  });

  it('derives physical shared storage names on the server', async () => {
    const repository = app.get(BrowserAppRepository);
    const schema = {
      id: 'untrusted-schema', appId: 'pulse-tasks', revision: 999, entity: 'storage-proof', displayName: 'Storage proof',
      physicalCollection: 'browser_apps', deploymentMode: 'shared_namespace' as const,
      jsonSchema: { type: 'object', properties: {} }, indexes: [],
    };
    await repository.insertEntity(schema, { id: 'proof', appId: 'pulse-tasks' });
    expect(await repository.findEntity(schema, { id: 'proof' })).toBeTruthy();
    expect(await repository.db().collection('browser_apps').findOne({ id: 'proof' })).toBeNull();
    await repository.deleteEntity(schema, { id: 'proof' });
  });

  it('rejects authenticated control-plane principals that do not own the app', async () => {
    const secret = 'control-plane-test-secret-at-least-32-characters';
    process.env.CONTROL_PLANE_JWT_SECRET = secret;
    try {
      const token = await new SignJWT({ organizationIds: ['another-owner'], superadmin: false })
        .setProtectedHeader({ alg: 'HS256' }).setIssuer('onering-control-plane').setAudience('onering-platform')
        .setSubject('outsider').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
      await request(app.getHttpServer()).get('/api/browser-apps/pulse-tasks').set('authorization', `Bearer ${token}`).expect(403);
      await request(app.getHttpServer()).get('/api/browser-apps').expect(401);
    } finally {
      delete process.env.CONTROL_PLANE_JWT_SECRET;
    }
  });

  it('creates a new immutable module revision without copying MongoDB storage ids', async () => {
    const repository = app.get(BrowserAppRepository);
    const before = await repository.findApp('pulse-tasks');
    const revision = await repository.createGeneratedRevision('pulse-tasks', '#806cff', 'A safe generated refinement.');
    expect(revision).toBe(before!.sourceRevision + 1);
    const modules = await repository.modules('pulse-tasks', revision);
    expect(modules).toHaveLength(2);
    expect(modules.every((module) => module.revision === revision)).toBe(true);
    expect(modules.find((module) => module.id === 'task-board-page')?.source).toContain('A safe generated refinement.');
  });

  it('preserves the final administrator and serializes concurrent release requests', async () => {
    const detail = await request(app.getHttpServer()).get('/api/browser-apps/pulse-tasks').expect(200);
    const northwindAdmin = detail.body.memberships.find((membership: { tenantId?: string; roles: string[]; status: string }) =>
      membership.tenantId === 'northwind' && membership.roles.includes('admin') && membership.status === 'active');
    await request(app.getHttpServer()).patch(`/api/browser-apps/pulse-tasks/memberships/${northwindAdmin.id}`)
      .send({ status: 'suspended' }).expect(400);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/browser-apps/pulse-tasks/build').expect(201),
      request(app.getHttpServer()).post('/api/browser-apps/pulse-tasks/build').expect(201),
    ]);
    expect(first.body.publication.release.id).toBe(second.body.publication.release.id);
    const releases = await app.get(BrowserAppRepository).db().collection('browser_releases')
      .find({ appId: 'pulse-tasks', status: 'active' }).toArray();
    expect(releases).toHaveLength(1);
  });
});
