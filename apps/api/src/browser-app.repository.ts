import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  Db,
  GridFSBucket,
  MongoClient,
  ObjectId,
  type Document,
  type Filter,
  type IndexSpecification,
  type OptionalUnlessRequiredId,
  type UpdateFilter,
} from 'mongodb';
import type {
  AppBuild,
  AppGraphChangeSet,
  AppMembership,
  AppModuleRecord,
  ApplicationDiscoveryDraft,
  ApplicationDiscoveryEvent,
  ApplicationDiscoverySession,
  AppStructuredSpecification,
  BrowserAgentRecord,
  BrowserApp,
  BrowserAppDetail,
  BrowserAppSpecification,
  BrowserGenerationEvent,
  BrowserGenerationJob,
  BrowserGenerationProfile,
  BrowserRelease,
  ConnectorActionRecord,
  DataSchemaRecord,
  EndTenant,
  EntityPolicyRecord,
  RouteBinding,
  RouteDefinition,
  ThemeRevision,
  TenancyRevision,
  TenancyMigration,
} from './browser-app.domain.js';
import {
  runtimeCss,
  seedBindings,
  seedAgents,
  seedBrowserApp,
  seedBrowserAppSpecification,
  seedConnectors,
  seedEndTenants,
  seedMemberships,
  seedModules,
  seedPolicies,
  seedRoutes,
  seedSchemas,
  seedTheme,
  seedTenancy,
  seedTasks,
} from './browser-app.seed.js';
import type { OrganizationRole, PlatformRole } from './control-plane-auth.guard.js';
import { defaultApplicationProfile } from './application-profile.js';

export type PlatformOrganization = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
};

export type PlatformMembership = {
  id: string;
  platformOrganizationId: string;
  subject: string;
  email?: string;
  displayName: string;
  role: OrganizationRole;
  status: 'active' | 'invited' | 'suspended';
  version: number;
  createdAt: string;
  updatedAt: string;
};

type PlatformRoleAssignment = {
  id: string;
  subject: string;
  role: PlatformRole;
  status: 'active' | 'revoked';
  createdAt: string;
};

@Injectable()
export class BrowserAppRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserAppRepository.name);
  private client?: MongoClient;
  private database?: Db;
  private bucket?: GridFSBucket;

  async onModuleInit(): Promise<void> {
    const uri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/oneringplatform';
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await this.client.connect();
    this.database = this.client.db();
    this.bucket = new GridFSBucket(this.database, { bucketName: 'browser_app_artifacts' });
    await this.ensureIndexes();
    await this.runMigrations();
    await this.ensureSeed();
    this.logger.log(`MongoDB browser-app store connected (${this.database.databaseName})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  db(): Db {
    if (!this.database) throw new Error('MongoDB is not initialized');
    return this.database;
  }

  gridFs(): GridFSBucket {
    if (!this.bucket) throw new Error('GridFS is not initialized');
    return this.bucket;
  }

  async listApps(): Promise<BrowserApp[]> {
    return this.db().collection<BrowserApp>('browser_apps').find().sort({ updatedAt: -1 }).toArray();
  }

  async createGenerationJob(job: BrowserGenerationJob): Promise<void> {
    await this.db().collection<BrowserGenerationJob>('app_generation_jobs').insertOne(job);
  }

  generationJob(appId: string, jobId: string): Promise<BrowserGenerationJob | null> {
    return this.db().collection<BrowserGenerationJob>('app_generation_jobs').findOne({ appId, id: jobId });
  }

  latestGenerationJob(appId: string): Promise<BrowserGenerationJob | null> {
    return this.db().collection<BrowserGenerationJob>('app_generation_jobs').find({ appId }).sort({ createdAt: -1 }).limit(1).next();
  }

  async discoverySession(appId: string): Promise<ApplicationDiscoverySession> {
    const collection = this.db().collection<ApplicationDiscoverySession>('application_discovery_sessions');
    const withoutStorageId = (stored: ApplicationDiscoverySession & { _id?: unknown }): ApplicationDiscoverySession => {
      const { _id: _storageId, ...session } = stored;
      return session;
    };
    const existing = await collection.findOne({ appId });
    if (existing) return withoutStorageId(existing);
    const now = new Date().toISOString();
    const app = await this.findApp(appId);
    if (!app) throw new Error('Application not found');
    const session: ApplicationDiscoverySession = {
      id: randomUUID(), appId, status: 'idle', progress: 0, phase: 'ready', baseSpecRevision: app.specRevision,
      currentSpecRevision: app.specRevision, messages: [], events: [],
      coverage: { score: 0, covered: [], missing: ['Discovery interview'], contradictions: [] }, createdAt: now, updatedAt: now,
    };
    try { await collection.insertOne(session); } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      return withoutStorageId((await collection.findOne({ appId }))!);
    }
    return session;
  }

  async saveDiscoverySession(session: ApplicationDiscoverySession): Promise<void> {
    const { _id: _storedId, ...replacement } = session as ApplicationDiscoverySession & { _id?: unknown };
    await this.db().collection<ApplicationDiscoverySession>('application_discovery_sessions').replaceOne(
      { appId: session.appId }, structuredClone(replacement) as ApplicationDiscoverySession, { upsert: true },
    );
  }

  async appendDiscoveryEvent(appId: string, event: ApplicationDiscoveryEvent, patch: Partial<Pick<ApplicationDiscoverySession, 'status' | 'progress' | 'phase' | 'error' | 'updatedAt'>> = {}): Promise<void> {
    await this.db().collection<ApplicationDiscoverySession>('application_discovery_sessions').updateOne(
      { appId }, { $push: { events: { $each: [structuredClone(event)], $slice: -300 } }, $set: { ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() } },
    );
  }

  async updateDiscoveryDraft(
    appId: string,
    draft: ApplicationDiscoveryDraft,
    coverage: ApplicationDiscoverySession['coverage'],
    patch: Partial<Pick<ApplicationDiscoverySession, 'progress' | 'phase' | 'updatedAt'>> = {},
  ): Promise<void> {
    await this.db().collection<ApplicationDiscoverySession>('application_discovery_sessions').updateOne(
      { appId },
      { $set: { draft: structuredClone(draft), coverage: structuredClone(coverage), ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() } },
    );
  }

  async updateGenerationJob(appId: string, jobId: string, update: Partial<BrowserGenerationJob>): Promise<void> {
    await this.db().collection<BrowserGenerationJob>('app_generation_jobs').updateOne(
      { appId, id: jobId }, { $set: { ...update, updatedAt: new Date().toISOString() } },
    );
  }

  async appendGenerationEvent(appId: string, jobId: string, event: BrowserGenerationEvent): Promise<void> {
    await this.db().collection<BrowserGenerationJob>('app_generation_jobs').updateOne(
      { appId, id: jobId },
      { $push: { events: { $each: [event], $slice: -500 } }, $set: { updatedAt: event.createdAt } },
    );
  }

  async setAppLifecycle(appId: string, lifecycleStatus: BrowserApp['lifecycleStatus']): Promise<void> {
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId }, { $set: { lifecycleStatus, updatedAt: new Date().toISOString() } },
    );
  }

  async platformRoles(subject: string): Promise<PlatformRole[]> {
    const assignments = await this.db().collection<PlatformRoleAssignment>('platform_role_assignments')
      .find({ subject, status: 'active' }).toArray();
    return assignments.map((assignment) => assignment.role);
  }

  platformMembership(subject: string, platformOrganizationId: string): Promise<PlatformMembership | null> {
    return this.db().collection<PlatformMembership>('platform_memberships')
      .findOne({ subject, platformOrganizationId });
  }

  async platformOrganizations(subject: string): Promise<Array<PlatformOrganization & { role: OrganizationRole }>> {
    const memberships = await this.db().collection<PlatformMembership>('platform_memberships')
      .find({ subject, status: 'active' }).toArray();
    if (!memberships.length) return [];
    const organizations = await this.db().collection<PlatformOrganization>('platform_organizations')
      .find({ id: { $in: memberships.map((membership) => membership.platformOrganizationId) }, status: 'active' }).sort({ name: 1 }).toArray();
    return organizations.map((organization) => ({
      ...organization,
      role: memberships.find((membership) => membership.platformOrganizationId === organization.id)!.role,
    }));
  }

  async createPlatformOrganization(input: { name: string; subject: string; email?: string }): Promise<PlatformOrganization & { role: OrganizationRole }> {
    const base = input.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'organization';
    let id = base;
    for (let suffix = 1; await this.db().collection<PlatformOrganization>('platform_organizations').findOne({ id }); suffix += 1) id = `${base}-${suffix}`;
    const now = new Date().toISOString();
    const organization: PlatformOrganization = { id, slug: id, name: input.name, status: 'active', createdAt: now, updatedAt: now };
    const membership: PlatformMembership = {
      id: randomUUID(), platformOrganizationId: id, subject: input.subject,
      ...(input.email ? { email: input.email } : {}),
      displayName: input.email?.split('@')[0] ?? input.subject,
      role: 'owner', status: 'active', version: 1, createdAt: now, updatedAt: now,
    };
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db().collection<PlatformOrganization>('platform_organizations').insertOne(organization, { session });
        await this.db().collection<PlatformMembership>('platform_memberships').insertOne(membership, { session });
      });
    } finally {
      await session.endSession();
    }
    return { ...organization, role: 'owner' };
  }

  async createAppGraph(input: {
    app: BrowserApp; specification: BrowserAppSpecification; modules: AppModuleRecord[]; routes: RouteDefinition[]; schemas: DataSchemaRecord[];
    policies: EntityPolicyRecord[]; connectors: ConnectorActionRecord[]; agents: BrowserAgentRecord[]; theme: ThemeRevision;
    tenancy: TenancyRevision; tenants: EndTenant[]; memberships: AppMembership[]; bindings: RouteBinding[];
  }): Promise<void> {
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        // The MongoDB driver assigns `_id` directly onto inserted objects. Clone every
        // caller-owned domain record so retries and template reuse cannot inherit a
        // storage identity from a previous insert.
        await this.db().collection<BrowserApp>('browser_apps').insertOne(structuredClone(input.app), { session });
        await this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(structuredClone(input.specification), { session });
        if (input.modules.length) await this.db().collection<AppModuleRecord>('app_modules').insertMany(structuredClone(input.modules), { session });
        if (input.routes.length) await this.db().collection<RouteDefinition>('app_routes').insertMany(structuredClone(input.routes), { session });
        if (input.schemas.length) await this.db().collection<DataSchemaRecord>('app_schemas').insertMany(structuredClone(input.schemas), { session });
        if (input.policies.length) await this.db().collection<EntityPolicyRecord>('app_policies').insertMany(structuredClone(input.policies), { session });
        if (input.connectors.length) await this.db().collection<ConnectorActionRecord>('app_connectors').insertMany(structuredClone(input.connectors), { session });
        if (input.agents.length) await this.db().collection<BrowserAgentRecord>('app_agents').insertMany(structuredClone(input.agents), { session });
        await this.db().collection<ThemeRevision>('app_themes').insertOne(structuredClone(input.theme), { session });
        await this.db().collection<TenancyRevision>('app_tenancy_revisions').insertOne(structuredClone(input.tenancy), { session });
        if (input.tenants.length) await this.db().collection<EndTenant>('app_end_tenants').insertMany(structuredClone(input.tenants), { session });
        if (input.memberships.length) await this.db().collection<AppMembership>('app_memberships').insertMany(structuredClone(input.memberships), { session });
        if (input.bindings.length) await this.db().collection<RouteBinding>('route_bindings').insertMany(structuredClone(input.bindings), { session });
      });
    } finally {
      await session.endSession();
    }
    await this.migrateEntityTenancy(input.app.id, input.tenancy.mode, input.tenants[0]?.id);
  }

  async findApp(idOrKey: string): Promise<BrowserApp | null> {
    return this.db().collection<BrowserApp>('browser_apps').findOne({ $or: [{ id: idOrKey }, { publicKey: idOrKey }] });
  }

  async detail(appId: string): Promise<BrowserAppDetail | null> {
    const app = await this.findApp(appId);
    if (!app) return null;
    const [modules, routes, schemas, policies, connectors, agents, builds, releases, bindings, themes, tenancyRevisions, endTenants, memberships, tenancyMigrations, specification] = await Promise.all([
      this.modules(app.id, app.sourceRevision),
      this.routes(app.id, app.sourceRevision),
      this.schemas(app.id, app.schemaRevision),
      this.policies(app.id, app.policyRevision),
      this.connectors(app.id, app.connectorRevision),
      this.agents(app.id, app.sourceRevision),
      this.db().collection<AppBuild>('app_builds').find({ appId: app.id }).sort({ createdAt: -1 }).limit(10).toArray(),
      this.db().collection<BrowserRelease>('browser_releases').find({ appId: app.id }).sort({ createdAt: -1 }).toArray(),
      this.db().collection<RouteBinding>('route_bindings').find({ appId: app.id }).sort({ canonical: -1 }).toArray(),
      this.themes(app.id),
      this.tenancyRevisions(app.id),
      this.endTenants(app.id),
      this.memberships(app.id),
      this.db().collection<TenancyMigration>('app_tenancy_migrations').find({ appId: app.id }).sort({ createdAt: -1 }).limit(20).toArray(),
      this.db().collection<BrowserAppSpecification>('app_specifications').findOne({ appId: app.id, revision: app.specRevision }),
    ]);
    const tenancy = tenancyRevisions.find((candidate) => candidate.revision === app.tenancyRevision);
    if (!tenancy) throw new Error(`Tenancy revision ${app.tenancyRevision} not found`);
    if (!specification) throw new Error(`Specification revision ${app.specRevision} not found`);
    return { app, modules, routes, schemas, policies, connectors, agents, builds, releases, bindings, themes, tenancy, tenancyRevisions, endTenants, memberships, tenancyMigrations, specification };
  }

  modules(appId: string, revision: number): Promise<AppModuleRecord[]> {
    return this.db().collection<AppModuleRecord>('app_modules').find({ appId, revision }).sort({ kind: 1, name: 1 }).toArray();
  }

  routes(appId: string, revision: number): Promise<RouteDefinition[]> {
    return this.db().collection<RouteDefinition>('app_routes').find({ appId, revision }).sort({ 'navigation.order': 1 }).toArray();
  }

  schemas(appId: string, revision: number): Promise<DataSchemaRecord[]> {
    return this.db().collection<DataSchemaRecord>('app_schemas').find({ appId, revision }).toArray();
  }

  policies(appId: string, revision: number): Promise<EntityPolicyRecord[]> {
    return this.db().collection<EntityPolicyRecord>('app_policies').find({ appId, revision }).toArray();
  }

  connectors(appId: string, revision: number): Promise<ConnectorActionRecord[]> {
    return this.db().collection<ConnectorActionRecord>('app_connectors').find({ appId, revision }).toArray();
  }

  agents(appId: string, revision: number): Promise<BrowserAgentRecord[]> {
    return this.db().collection<BrowserAgentRecord>('app_agents').find({ appId, revision }).sort({ name: 1 }).toArray();
  }

  async agent(appId: string, id: string, revision?: number): Promise<BrowserAgentRecord | null> {
    const sourceRevision = revision ?? (await this.findApp(appId))?.sourceRevision;
    if (sourceRevision === undefined) return null;
    return this.db().collection<BrowserAgentRecord>('app_agents').findOne({ appId, revision: sourceRevision, id });
  }

  themes(appId: string): Promise<ThemeRevision[]> {
    return this.db().collection<ThemeRevision>('app_themes').find({ appId }).sort({ revision: -1 }).limit(20).toArray();
  }

  tenancyRevisions(appId: string): Promise<TenancyRevision[]> {
    return this.db().collection<TenancyRevision>('app_tenancy_revisions').find({ appId }).sort({ revision: -1 }).toArray();
  }

  endTenants(appId: string): Promise<EndTenant[]> {
    return this.db().collection<EndTenant>('app_end_tenants').find({ appId }).sort({ name: 1 }).toArray();
  }

  memberships(appId: string): Promise<AppMembership[]> {
    return this.db().collection<AppMembership>('app_memberships').find({ appId }).sort({ displayName: 1, tenantId: 1 }).toArray();
  }

  membershipsForSubject(appId: string, userId: string): Promise<AppMembership[]> {
    return this.db().collection<AppMembership>('app_memberships').find({ appId, userId, status: 'active' }).sort({ tenantId: 1 }).toArray();
  }

  membershipsForIdentity(appId: string, userId: string, email?: string): Promise<AppMembership[]> {
    return this.db().collection<AppMembership>('app_memberships').find({
      appId,
      $or: [{ userId }, ...(email ? [{ email: email.toLowerCase() }] : [])],
      status: { $in: ['active', 'invited'] },
    }).sort({ tenantId: 1 }).toArray();
  }

  async activateMembershipIdentity(appId: string, membershipId: string, userId: string): Promise<AppMembership | null> {
    return this.db().collection<AppMembership>('app_memberships').findOneAndUpdate(
      { appId, id: membershipId, status: { $in: ['active', 'invited'] } },
      { $set: { userId, status: 'active', updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
  }

  async consumeIdentityExchange(jti: string, appId: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.db().collection('identity_exchange_nonces').insertOne({ jti, appId, expiresAt, consumedAt: new Date() });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async membership(appId: string, userId: string, tenantId?: string): Promise<AppMembership | null> {
    return this.db().collection<AppMembership>('app_memberships').findOne({
      appId, userId, status: 'active', ...(tenantId ? { tenantId } : {}),
    });
  }

  async endTenant(appId: string, tenantId: string): Promise<EndTenant | null> {
    return this.db().collection<EndTenant>('app_end_tenants').findOne({ appId, id: tenantId, status: 'active' });
  }

  async publishTenancy(revision: TenancyRevision): Promise<void> {
    await this.db().collection<TenancyRevision>('app_tenancy_revisions').updateMany(
      { appId: revision.appId, status: 'published' }, { $set: { status: 'superseded' } },
    );
    await this.db().collection<TenancyRevision>('app_tenancy_revisions').insertOne(revision);
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: revision.appId }, { $set: { tenancyRevision: revision.revision, tenancyMode: revision.mode, updatedAt: revision.createdAt } },
    );
  }

  async restoreTenancy(appId: string, revision: number): Promise<void> {
    await this.db().collection<TenancyRevision>('app_tenancy_revisions').updateMany(
      { appId }, { $set: { status: 'superseded' } },
    );
    await this.db().collection<TenancyRevision>('app_tenancy_revisions').updateOne(
      { appId, revision }, { $set: { status: 'published' } },
    );
    const tenancy = await this.db().collection<TenancyRevision>('app_tenancy_revisions').findOne({ appId, revision });
    if (!tenancy) throw new Error('Tenancy revision not found');
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId }, { $set: { tenancyRevision: revision, tenancyMode: tenancy.mode, updatedAt: new Date().toISOString() } },
    );
  }

  async insertEndTenant(tenant: EndTenant): Promise<void> {
    await this.db().collection<EndTenant>('app_end_tenants').insertOne(tenant);
  }

  async insertMembership(membership: AppMembership): Promise<void> {
    await this.db().collection<AppMembership>('app_memberships').insertOne(membership);
  }

  async updateMembership(appId: string, membershipId: string, update: Partial<AppMembership>): Promise<AppMembership | null> {
    const result = await this.db().collection<AppMembership>('app_memberships').findOneAndUpdate(
      { appId, id: membershipId }, { $set: update, $inc: { version: 1 } }, { returnDocument: 'after' },
    );
    return result;
  }

  async updateEndTenant(appId: string, tenantId: string, status: EndTenant['status']): Promise<EndTenant | null> {
    return this.db().collection<EndTenant>('app_end_tenants').findOneAndUpdate(
      { appId, id: tenantId }, { $set: { status } }, { returnDocument: 'after' },
    );
  }

  async migrateEntityTenancy(appId: string, mode: TenancyRevision['mode'], defaultTenantId?: string): Promise<{ preservedScopedRecords: number; assignedUnscopedRecords: number }> {
    const app = await this.findApp(appId);
    if (!app) throw new Error('App not found');
    const schemas = await this.schemas(appId, app.schemaRevision);
    let preservedScopedRecords = 0;
    let assignedUnscopedRecords = 0;
    for (const schema of schemas) {
      const collection = this.entityCollection(schema);
      preservedScopedRecords += await collection.countDocuments({ appId, tenantId: { $exists: true } });
      if (mode === 'multi_organization') {
        if (!defaultTenantId) throw new Error('A default organization is required for multi-organization migration');
        const result = await collection.updateMany(
          { appId, tenantId: { $exists: false }, ...(schema.publicRecordFilter ? { $nor: [schema.publicRecordFilter] } : {}) },
          { $set: { tenantId: defaultTenantId } },
        );
        assignedUnscopedRecords += result.modifiedCount;
      }
      for (const index of schema.indexes) {
        const fields = {
          appId: 1,
          ...(mode === 'multi_organization' ? { tenantId: 1 } : {}),
          ...index.fields,
        } as IndexSpecification;
        await collection.createIndex(fields, { unique: index.unique ?? false });
      }
      await collection.createIndex({ appId: 1, id: 1 }, { unique: true });
    }
    return { preservedScopedRecords, assignedUnscopedRecords };
  }

  async writeTenancyMigration(migration: TenancyMigration): Promise<void> {
    await this.db().collection<TenancyMigration>('app_tenancy_migrations').insertOne(structuredClone(migration));
  }

  async tenancyImpact(appId: string): Promise<{ totalRecords: number; scopedRecords: number; unscopedPrivateRecords: number }> {
    const app = await this.findApp(appId);
    if (!app) throw new Error('App not found');
    const schemas = await this.schemas(appId, app.schemaRevision);
    let totalRecords = 0; let scopedRecords = 0; let unscopedPrivateRecords = 0;
    for (const schema of schemas) {
      const collection = this.entityCollection(schema);
      totalRecords += await collection.countDocuments({ appId });
      scopedRecords += await collection.countDocuments({ appId, tenantId: { $exists: true } });
      unscopedPrivateRecords += await collection.countDocuments({
        appId, tenantId: { $exists: false }, ...(schema.publicRecordFilter ? { $nor: [schema.publicRecordFilter] } : {}),
      });
    }
    return { totalRecords, scopedRecords, unscopedPrivateRecords };
  }

  async theme(appId: string, revision: number): Promise<ThemeRevision | null> {
    return this.db().collection<ThemeRevision>('app_themes').findOne({ appId, revision });
  }

  async insertTheme(theme: ThemeRevision): Promise<void> {
    await this.db().collection<ThemeRevision>('app_themes').insertOne(structuredClone(theme));
  }

  async nextThemeRevision(appId: string): Promise<number> {
    const latest = await this.db().collection<ThemeRevision>('app_themes').find({ appId }).sort({ revision: -1 }).limit(1).next();
    return (latest?.revision ?? 0) + 1;
  }

  async setPublishedTheme(appId: string, revision: number): Promise<void> {
    await this.db().collection<ThemeRevision>('app_themes').updateMany(
      { appId, status: 'published', revision: { $ne: revision } },
      { $set: { status: 'superseded' } },
    );
    await this.db().collection<ThemeRevision>('app_themes').updateOne({ appId, revision }, { $set: { status: 'published' } });
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId },
      { $set: { themeRevision: revision, updatedAt: new Date().toISOString() } },
    );
  }

  async writeBuild(build: AppBuild): Promise<void> {
    await this.db().collection<AppBuild>('app_builds').insertOne(build);
  }

  async updateBuild(id: string, update: Partial<AppBuild>): Promise<void> {
    await this.db().collection<AppBuild>('app_builds').updateOne({ id }, { $set: update });
  }

  async findBuild(id: string): Promise<AppBuild | null> {
    return this.db().collection<AppBuild>('app_builds').findOne({ id });
  }

  async writeArtifact(buildId: string, contents: Buffer): Promise<string> {
    const upload = this.gridFs().openUploadStream(`${buildId}.js`, {
      metadata: { buildId, contentType: 'text/javascript; charset=utf-8' },
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from([contents]).pipe(upload).on('error', reject).on('finish', resolve);
    });
    return upload.id.toHexString();
  }

  async readArtifact(fileId: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = this.gridFs().openDownloadStream(new ObjectId(fileId));
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async activateRelease(release: BrowserRelease): Promise<BrowserRelease> {
    return this.activateReleaseAttempt(release, true);
  }

  async publishPreview(release: BrowserRelease): Promise<BrowserRelease> {
    const session = this.client!.startSession();
    let published = release;
    try {
      await session.withTransaction(async () => {
        const releases = this.db().collection<BrowserRelease>('browser_releases');
        const existing = await releases.findOne({ appId: release.appId, releaseKey: release.releaseKey }, { session });
        if (existing?.status === 'active') {
          published = existing;
          return;
        }
        published = existing ? { ...existing, ...release, id: existing.id } : release;
        if (existing) await releases.replaceOne({ id: existing.id }, published, { session });
        else await releases.insertOne(published, { session });
        await releases.updateMany(
          { appId: release.appId, id: { $ne: published.id }, status: 'preview' },
          { $set: { status: 'superseded' }, $unset: { previewToken: '' } }, { session },
        );
        const result = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          {
            id: release.appId, specRevision: release.specRevision, sourceRevision: release.sourceRevision,
            schemaRevision: release.schemaRevision, policyRevision: release.policyRevision,
            connectorRevision: release.connectorRevision, themeRevision: release.themeRevision,
            tenancyRevision: release.tenancyRevision,
          },
          { $set: { previewReleaseId: published.id, updatedAt: release.createdAt } }, { session },
        );
        if (result.matchedCount !== 1) throw new Error('Application changed while the preview was building');
      });
      return published;
    } finally {
      await session.endSession();
    }
  }

  async promotePreview(appId: string, releaseId: string): Promise<BrowserRelease> {
    const release = await this.db().collection<BrowserRelease>('browser_releases').findOne({ appId, id: releaseId });
    if (!release || release.status !== 'preview') throw new Error('Preview release not found');
    const promoted: BrowserRelease = {
      ...release, environment: 'production', status: 'active', createdAt: new Date().toISOString(),
    };
    delete promoted.previewToken;
    return this.activateRelease(promoted);
  }

  private async activateReleaseAttempt(release: BrowserRelease, retryDuplicate: boolean): Promise<BrowserRelease> {
    const session = this.client!.startSession();
    let activated = release;
    try {
      await session.withTransaction(async () => {
        const releases = this.db().collection<BrowserRelease>('browser_releases');
        const existing = await releases.findOne({ appId: release.appId, releaseKey: release.releaseKey }, { session });
        // The immutable release-key winner owns the release ID and artifact.
        // A later activation of the same tuple (rollback or concurrent build)
        // must point at that stored winner, never at an uninserted candidate ID.
        activated = existing
          ? { ...release, ...existing, environment: 'production', status: 'active', createdAt: release.createdAt }
          : release;
        delete activated.previewToken;
        if (!existing) await releases.insertOne(release, { session });
        await releases.updateMany(
          { appId: release.appId, id: { $ne: activated.id }, status: 'active' },
          { $set: { status: 'superseded' } }, { session },
        );
        await releases.updateOne(
          { id: activated.id },
          {
            $set: { environment: 'production', status: 'active', createdAt: activated.createdAt },
            $unset: { previewToken: '' },
          },
          { session },
        );
        const result = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          {
            id: release.appId, sourceRevision: release.sourceRevision, schemaRevision: release.schemaRevision,
            policyRevision: release.policyRevision, connectorRevision: release.connectorRevision,
            themeRevision: release.themeRevision, tenancyRevision: release.tenancyRevision,
          },
          { $set: { activeReleaseId: activated.id, updatedAt: release.createdAt }, $unset: { previewReleaseId: '' } }, { session },
        );
        if (result.matchedCount !== 1) throw new Error('Application changed while the release was building');
      });
      return activated;
    } catch (error) {
      // Two builders can finish the same immutable revision tuple at once. The
      // unique release key elects one winner; the loser re-reads and activates
      // that same release instead of surfacing a false deployment failure.
      if (retryDuplicate && (error as { code?: number }).code === 11000) {
        return this.activateReleaseAttempt(release, false);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async activeRelease(appId: string): Promise<{ release: BrowserRelease; build: AppBuild } | null> {
    const app = await this.findApp(appId);
    if (!app?.activeReleaseId) return null;
    const release = await this.db().collection<BrowserRelease>('browser_releases').findOne({ appId, id: app.activeReleaseId });
    if (!release) return null;
    const build = await this.findBuild(release.buildId);
    return build ? { release, build } : null;
  }

  async release(appId: string, releaseId: string): Promise<{ release: BrowserRelease; build: AppBuild } | null> {
    const release = await this.db().collection<BrowserRelease>('browser_releases').findOne({ appId, id: releaseId });
    if (!release) return null;
    const build = await this.findBuild(release.buildId);
    return build ? { release, build } : null;
  }

  async expireIncompatiblePreviews(appId: string, runtimeVersion: number, generatorVersion: string): Promise<void> {
    const incompatible = await this.db().collection<BrowserRelease>('browser_releases').find({
      appId, status: 'preview', $or: [{ runtimeVersion: { $ne: runtimeVersion } }, { generatorVersion: { $ne: generatorVersion } }],
    }).project<{ id: string }>({ id: 1 }).toArray();
    if (!incompatible.length) return;
    const ids = incompatible.map((release) => release.id);
    await this.db().collection<BrowserRelease>('browser_releases').updateMany(
      { appId, id: { $in: ids } }, { $set: { status: 'superseded' }, $unset: { previewToken: '' } },
    );
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId, previewReleaseId: { $in: ids } }, { $unset: { previewReleaseId: '' } },
    );
  }

  async resolveBinding(hostname: string, pathname: string): Promise<{ app: BrowserApp; binding: RouteBinding } | null> {
    const normalizedHost = hostname.split(':')[0]!.toLowerCase();
    const bindings = await this.db().collection<RouteBinding>('route_bindings').find({ hostname: normalizedHost, status: 'active' }).toArray();
    const binding = bindings
      .filter((candidate) => candidate.pathPrefix === '/' || pathname === candidate.pathPrefix || pathname.startsWith(`${candidate.pathPrefix}/`))
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
    if (!binding) return null;
    const app = await this.findApp(binding.appId);
    return app ? { app, binding } : null;
  }

  async findBinding(id: string): Promise<RouteBinding | null> {
    return this.db().collection<RouteBinding>('route_bindings').findOne({ id });
  }

  async insertBinding(binding: RouteBinding): Promise<void> {
    await this.db().collection<RouteBinding>('route_bindings').insertOne(binding);
  }

  async activateBinding(id: string): Promise<RouteBinding | null> {
    await this.db().collection<RouteBinding>('route_bindings').updateOne(
      { id },
      { $set: { status: 'active', certificateStatus: 'active', verifiedAt: new Date().toISOString() }, $unset: { verificationToken: '' } },
    );
    return this.findBinding(id);
  }

  async entityConfig(
    appId: string,
    entity: string,
    revisions?: { schemaRevision: number; policyRevision: number },
  ): Promise<{ schema: DataSchemaRecord; policy: EntityPolicyRecord } | null> {
    const app = revisions ? null : await this.findApp(appId);
    const selected = revisions ?? (app ? { schemaRevision: app.schemaRevision, policyRevision: app.policyRevision } : null);
    if (!selected) return null;
    const [schema, policy] = await Promise.all([
      this.db().collection<DataSchemaRecord>('app_schemas').findOne({ appId, revision: selected.schemaRevision, entity }),
      this.db().collection<EntityPolicyRecord>('app_policies').findOne({ appId, revision: selected.policyRevision, entity }),
    ]);
    return schema && policy ? { schema, policy } : null;
  }

  async findConnector(appId: string, id: string, action: string, revision?: number): Promise<ConnectorActionRecord | null> {
    const connectorRevision = revision ?? (await this.findApp(appId))?.connectorRevision;
    if (connectorRevision === undefined) return null;
    return this.db().collection<ConnectorActionRecord>('app_connectors').findOne({ appId, revision: connectorRevision, id, action });
  }

  tenancyRevision(appId: string, revision: number): Promise<TenancyRevision | null> {
    return this.db().collection<TenancyRevision>('app_tenancy_revisions').findOne({ appId, revision });
  }

  async consumeConnectorRate(key: string, maximum: number): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    const result = await this.db().collection('connector_rate_limits').findOneAndUpdate(
      { key, bucket },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 180_000) } },
      { upsert: true, returnDocument: 'after' },
    );
    return Number(result?.count ?? maximum + 1) <= maximum;
  }

  async writeConnectorAudit(event: Record<string, unknown>): Promise<void> {
    await this.db().collection('connector_audit_events').insertOne({ ...event, createdAt: new Date().toISOString() });
  }

  async writeDataAudit(event: Record<string, unknown>): Promise<void> {
    await this.db().collection('data_audit_events').insertOne({ ...event, createdAt: new Date().toISOString() });
  }

  async listEntity(schemaOrCollection: DataSchemaRecord | string, filter: Filter<Document>): Promise<Document[]> {
    return this.entityCollection(schemaOrCollection).find(filter).sort({ createdAt: -1 }).limit(100).toArray();
  }

  async listEntityPage(
    schemaOrCollection: DataSchemaRecord | string,
    filter: Filter<Document>,
    limit: number,
    cursor?: { createdAt: string; id: string },
  ): Promise<Document[]> {
    const scoped = cursor ? {
      $and: [filter, { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { $lt: cursor.id } }] }],
    } as Filter<Document> : filter;
    return this.entityCollection(schemaOrCollection).find(scoped).sort({ createdAt: -1, id: -1 }).limit(limit + 1).toArray();
  }

  async findEntity(schemaOrCollection: DataSchemaRecord | string, filter: Filter<Document>): Promise<Document | null> {
    return this.entityCollection(schemaOrCollection).findOne(filter);
  }

  async insertEntity(schemaOrCollection: DataSchemaRecord | string, document: OptionalUnlessRequiredId<Document>): Promise<void> {
    await this.entityCollection(schemaOrCollection).insertOne(document);
  }

  async updateEntity(schemaOrCollection: DataSchemaRecord | string, filter: Filter<Document>, update: UpdateFilter<Document>): Promise<number> {
    const result = await this.entityCollection(schemaOrCollection).updateOne(filter, update);
    return result.matchedCount;
  }

  async deleteEntity(schemaOrCollection: DataSchemaRecord | string, filter: Filter<Document>): Promise<number> {
    const result = await this.entityCollection(schemaOrCollection).deleteOne(filter);
    return result.deletedCount;
  }

  async createGeneratedRevision(appId: string, accent: string, headline: string, modulePatches: Array<{ moduleId: string; description: string; source: string }> = []): Promise<number> {
    const app = await this.findApp(appId);
    if (!app) throw new Error('App not found');
    const nextRevision = app.sourceRevision + 1;
    const current = await this.modules(app.id, app.sourceRevision);
    const patchById = new Map(modulePatches.map((patch) => [patch.moduleId, patch]));
    if (modulePatches.some((patch) => !current.some((module) => module.id === patch.moduleId))) throw new Error('Agent attempted to patch an unknown module');
    const next = current.map((stored) => {
      const { _id, ...item } = stored as AppModuleRecord & { _id?: ObjectId };
      void _id;
      const patch = patchById.get(item.id);
      const source = patch?.source ?? (item.id === 'task-board-page'
        ? item.source.replace(/<h1>.*?<\/h1>/, `<h1>{${JSON.stringify(headline)}}</h1>`)
        : item.source);
      return {
        ...item,
        revision: nextRevision,
        requirementIds: item.requirementIds ?? [],
        // Module metadata is a contract copied from the specification. Agent
        // revisions may change implementation source, but not silently rewrite
        // page purpose outside the PRD.
        description: patch?.description ?? item.description,
        source,
        contentHash: createHash('sha256').update(source).digest('hex'),
        createdAt: new Date().toISOString(),
      };
    });
    const nextRoutes = (await this.routes(app.id, app.sourceRevision)).map((stored) => {
      const { _id, ...route } = stored as RouteDefinition & { _id?: ObjectId };
      void _id;
      return { ...route, revision: nextRevision, requirementIds: route.requirementIds ?? [] };
    });
    const nextAgents = (await this.agents(app.id, app.sourceRevision)).map((stored) => {
      const { _id, ...agent } = stored as BrowserAgentRecord & { _id?: ObjectId };
      void _id;
      return { ...agent, revision: nextRevision, requirementIds: agent.requirementIds ?? [] };
    });
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db().collection<AppModuleRecord>('app_modules').insertMany(next, { session });
        await this.db().collection<RouteDefinition>('app_routes').insertMany(nextRoutes, { session });
        if (nextAgents.length) await this.db().collection<BrowserAgentRecord>('app_agents').insertMany(nextAgents, { session });
        const updated = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          { id: app.id, sourceRevision: app.sourceRevision },
          { $set: { sourceRevision: nextRevision, generatedFromSpecRevision: app.specRevision, updatedAt: new Date().toISOString(), agentAccent: accent, agentHeadline: headline } },
          { session },
        );
        if (updated.matchedCount !== 1) throw new Error('Application source changed while the agent revision was being written');
      });
    } finally {
      await session.endSession();
    }
    return nextRevision;
  }

  async applyGraphChangeSet(
    appId: string,
    changeSet: AppGraphChangeSet,
    accent: string,
    headline: string,
    generationProfile?: BrowserGenerationProfile,
  ): Promise<number> {
    const app = await this.findApp(appId);
    if (!app) throw new Error('App not found');
    const nextRevision = app.sourceRevision + 1;
    const [storedModules, storedRoutes, storedAgents, storedSchemas, storedPolicies, storedConnectors] = await Promise.all([
      this.modules(app.id, app.sourceRevision), this.routes(app.id, app.sourceRevision), this.agents(app.id, app.sourceRevision),
      this.schemas(app.id, app.schemaRevision), this.policies(app.id, app.policyRevision), this.connectors(app.id, app.connectorRevision),
    ]);
    const strip = <T>(stored: T): T => {
      const value = { ...stored } as T & { _id?: ObjectId };
      delete value._id;
      return value;
    };
    const moduleDeletes = new Set(changeSet.moduleDeletes);
    const moduleUpserts = new Map(changeSet.moduleUpserts.map((item) => [item.id, item]));
    const modules = storedModules.filter((item) => !moduleDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = moduleUpserts.get(current.id);
      if (patch) moduleUpserts.delete(current.id);
      const source = patch?.source ?? current.source;
      return {
        ...current, ...patch, appId: app.id, revision: nextRevision,
        requirementIds: patch?.requirementIds ?? current.requirementIds ?? [],
        contentHash: createHash('sha256').update(source).digest('hex'), createdAt: new Date().toISOString(),
      } as AppModuleRecord;
    });
    for (const patch of moduleUpserts.values()) {
      modules.push({
        ...patch, appId: app.id, revision: nextRevision, propsSchema: undefined,
        contentHash: createHash('sha256').update(patch.source).digest('hex'), createdAt: new Date().toISOString(),
      });
    }

    const routeDeletes = new Set(changeSet.routeDeletes);
    const routeUpserts = new Map(changeSet.routeUpserts.map((item) => [item.id, item]));
    const routes = storedRoutes.filter((item) => !routeDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = routeUpserts.get(current.id);
      if (patch) routeUpserts.delete(current.id);
      return { ...current, ...patch, appId: app.id, revision: nextRevision, requirementIds: patch?.requirementIds ?? current.requirementIds ?? [] } as RouteDefinition;
    });
    for (const patch of routeUpserts.values()) routes.push({ ...patch, appId: app.id, revision: nextRevision });

    const agentDeletes = new Set(changeSet.agentDeletes);
    const agentUpserts = new Map(changeSet.agentUpserts.map((item) => [item.id, item]));
    const agents = storedAgents.filter((item) => !agentDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = agentUpserts.get(current.id);
      if (patch) agentUpserts.delete(current.id);
      return { ...current, ...patch, appId: app.id, revision: nextRevision, requirementIds: patch?.requirementIds ?? current.requirementIds ?? [] } as BrowserAgentRecord;
    });
    for (const patch of agentUpserts.values()) agents.push({ ...patch, appId: app.id, revision: nextRevision });

    const schemasChanged = changeSet.schemaUpserts.length > 0 || changeSet.schemaDeletes.length > 0;
    const nextSchemaRevision = schemasChanged ? app.schemaRevision + 1 : app.schemaRevision;
    const schemaDeletes = new Set(changeSet.schemaDeletes);
    const schemaUpserts = new Map(changeSet.schemaUpserts.map((item) => [item.id, item]));
    const schemas = schemasChanged ? storedSchemas.filter((item) => !schemaDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = schemaUpserts.get(current.id);
      if (patch) schemaUpserts.delete(current.id);
      const merged = { ...current, ...patch };
      return {
        ...merged, appId: app.id, revision: nextSchemaRevision,
        physicalCollection: this.expectedPhysicalCollection(app.id, merged.entity),
        requirementIds: patch?.requirementIds ?? current.requirementIds ?? [],
      } as DataSchemaRecord;
    }) : storedSchemas;
    for (const patch of schemaUpserts.values()) schemas.push({
      ...patch, appId: app.id, revision: nextSchemaRevision,
      physicalCollection: this.expectedPhysicalCollection(app.id, patch.entity),
    });

    const policiesChanged = changeSet.policyUpserts.length > 0 || changeSet.policyDeletes.length > 0;
    const nextPolicyRevision = policiesChanged ? app.policyRevision + 1 : app.policyRevision;
    const policyDeletes = new Set(changeSet.policyDeletes);
    const policyUpserts = new Map(changeSet.policyUpserts.map((item) => [item.id, item]));
    const policies = policiesChanged ? storedPolicies.filter((item) => !policyDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = policyUpserts.get(current.id);
      if (patch) policyUpserts.delete(current.id);
      return {
        ...current, ...patch, appId: app.id, revision: nextPolicyRevision,
        requirementIds: patch?.requirementIds ?? current.requirementIds ?? [],
      } as EntityPolicyRecord;
    }) : storedPolicies;
    for (const patch of policyUpserts.values()) policies.push({ ...patch, appId: app.id, revision: nextPolicyRevision });

    const connectorsChanged = changeSet.connectorUpserts.length > 0 || changeSet.connectorDeletes.length > 0;
    const nextConnectorRevision = connectorsChanged ? app.connectorRevision + 1 : app.connectorRevision;
    const connectorDeletes = new Set(changeSet.connectorDeletes);
    const connectorUpserts = new Map(changeSet.connectorUpserts.map((item) => [item.id, item]));
    const connectors = connectorsChanged ? storedConnectors.filter((item) => !connectorDeletes.has(item.id)).map((stored) => {
      const current = strip(stored);
      const patch = connectorUpserts.get(current.id);
      if (patch) connectorUpserts.delete(current.id);
      return { ...current, ...patch, appId: app.id, revision: nextConnectorRevision, requirementIds: patch?.requirementIds ?? current.requirementIds ?? [] } as ConnectorActionRecord;
    }) : storedConnectors;
    for (const patch of connectorUpserts.values()) connectors.push({ ...patch, appId: app.id, revision: nextConnectorRevision });

    if (!modules.length || !routes.length) throw new Error('A generated graph must retain at least one module and route');
    const moduleIds = new Set(modules.map((item) => item.id));
    if (routes.some((route) => !moduleIds.has(route.pageModuleId))) throw new Error('A generated route references a missing page module');
    if (new Set(routes.map((route) => route.path)).size !== routes.length) throw new Error('Generated routes must have unique paths');
    if (new Set(schemas.map((schema) => schema.entity)).size !== schemas.length) throw new Error('Generated entities must have unique data schemas');
    if (new Set(policies.map((policy) => policy.entity)).size !== policies.length) throw new Error('Generated entities must have unique policies');
    for (const schema of schemas) if (!policies.some((policy) => policy.entity === schema.entity)) throw new Error(`Generated entity ${schema.entity} has no policy`);
    for (const policy of policies) if (!schemas.some((schema) => schema.entity === policy.entity)) throw new Error(`Generated policy ${policy.id} has no schema`);
    const connectorTools = new Set(connectors.map((connector) => `${connector.id}:${connector.action}`));
    for (const agent of agents) for (const toolId of agent.toolIds) if (!connectorTools.has(toolId)) throw new Error(`Generated agent ${agent.id} references missing connector tool ${toolId}`);

    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db().collection<AppModuleRecord>('app_modules').insertMany(modules, { session });
        await this.db().collection<RouteDefinition>('app_routes').insertMany(routes, { session });
        if (agents.length) await this.db().collection<BrowserAgentRecord>('app_agents').insertMany(agents, { session });
        if (schemasChanged && schemas.length) await this.db().collection<DataSchemaRecord>('app_schemas').insertMany(schemas, { session });
        if (policiesChanged && policies.length) await this.db().collection<EntityPolicyRecord>('app_policies').insertMany(policies, { session });
        if (connectorsChanged && connectors.length) await this.db().collection<ConnectorActionRecord>('app_connectors').insertMany(connectors, { session });
        const updated = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          { id: app.id, sourceRevision: app.sourceRevision, schemaRevision: app.schemaRevision, policyRevision: app.policyRevision, connectorRevision: app.connectorRevision },
          { $set: {
            sourceRevision: nextRevision, schemaRevision: nextSchemaRevision, policyRevision: nextPolicyRevision, connectorRevision: nextConnectorRevision,
            generatedFromSpecRevision: app.specRevision,
            updatedAt: new Date().toISOString(), agentAccent: accent, agentHeadline: headline,
            ...(generationProfile ? { generationProfile } : {}),
          } },
          { session },
        );
        if (updated.matchedCount !== 1) throw new Error('Application source changed while the graph revision was being written');
      });
    } finally {
      await session.endSession();
    }
    if (schemasChanged) {
      const defaultTenant = app.tenancyMode === 'multi_organization' ? (await this.endTenants(app.id))[0]?.id : undefined;
      await this.migrateEntityTenancy(app.id, app.tenancyMode, defaultTenant);
    }
    return nextRevision;
  }

  async publishSpecification(
    appId: string,
    expectedRevision: number,
    sections: BrowserAppSpecification['sections'],
    structure: BrowserAppSpecification['structure'],
    createdAt: string,
  ): Promise<BrowserAppSpecification> {
    const next: BrowserAppSpecification = {
      id: randomUUID(), appId, revision: expectedRevision + 1,
      projectId: (await this.findApp(appId))?.projectId ?? appId,
      status: 'approved', sections, structure, createdAt,
    };
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        const app = await this.db().collection<BrowserApp>('browser_apps').findOne({ id: appId, specRevision: expectedRevision }, { session });
        if (!app) throw new Error('Application requirements changed; reload before saving');
        next.projectId = app.projectId;
        await this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(next, { session });
        await this.db().collection<BrowserAppSpecification>('app_specifications').updateMany(
          { appId, revision: { $ne: next.revision }, status: 'approved' }, { $set: { status: 'superseded' } }, { session },
        );
        await this.db().collection<BrowserApp>('browser_apps').updateOne(
          { id: appId, specRevision: expectedRevision }, { $set: { specRevision: next.revision, specificationApprovalStatus: 'draft', updatedAt: createdAt } }, { session },
        );
      });
      return next;
    } finally {
      await session.endSession();
    }
  }

  async setSpecificationApproval(appId: string, expectedRevision: number, status: BrowserApp['specificationApprovalStatus']): Promise<void> {
    const result = await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId, specRevision: expectedRevision },
      { $set: { specificationApprovalStatus: status, updatedAt: new Date().toISOString() } },
    );
    if (!result.matchedCount) throw new Error('Application specification changed; reload before approving');
  }

  async restoreSourceRevision(appId: string, sourceRevision: number, generatedFromSpecRevision?: number): Promise<void> {
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId },
      { $set: {
        sourceRevision,
        ...(generatedFromSpecRevision === undefined ? {} : { generatedFromSpecRevision }),
        updatedAt: new Date().toISOString(),
      } },
    );
  }

  async restoreGraphRevisions(
    appId: string,
    revisions: Pick<BrowserApp, 'sourceRevision' | 'schemaRevision' | 'policyRevision' | 'connectorRevision' | 'generatedFromSpecRevision'> & {
      generationProfile?: BrowserGenerationProfile;
    },
  ): Promise<void> {
    const { generationProfile, ...pointers } = revisions;
    await this.db().collection<BrowserApp>('browser_apps').updateOne(
      { id: appId },
      {
        $set: { ...pointers, ...(generationProfile ? { generationProfile } : {}), updatedAt: new Date().toISOString() },
        ...(generationProfile ? {} : { $unset: { generationProfile: '' } }),
      },
    );
  }

  runtimeStyles(): string {
    return runtimeCss;
  }

  expectedPhysicalCollection(appId: string, entity: string): string {
    return `a_${this.compact(appId)}_prod_${this.compact(entity)}`;
  }

  private entityCollection(schemaOrCollection: DataSchemaRecord | string) {
    if (typeof schemaOrCollection === 'string') return this.db().collection(schemaOrCollection);
    const schema = schemaOrCollection;
    if (schema.deploymentMode === 'dedicated_database') {
      return this.client!.db(`app_${this.compact(schema.appId)}_prod`).collection(this.compact(schema.entity));
    }
    return this.db().collection(this.expectedPhysicalCollection(schema.appId, schema.entity));
  }

  private compact(value: string): string {
    const compact = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
    if (!compact) throw new Error('Invalid storage identifier');
    return compact;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.db().collection<BrowserApp>('browser_apps').createIndex({ publicKey: 1 }, { unique: true }),
      this.db().collection<BrowserApp>('browser_apps').createIndex({ id: 1 }, { unique: true }),
      this.db().collection<PlatformOrganization>('platform_organizations').createIndex({ id: 1 }, { unique: true }),
      this.db().collection<PlatformOrganization>('platform_organizations').createIndex({ slug: 1 }, { unique: true }),
      this.db().collection<PlatformMembership>('platform_memberships').createIndex({ platformOrganizationId: 1, subject: 1 }, { unique: true }),
      this.db().collection<PlatformMembership>('platform_memberships').createIndex({ subject: 1, status: 1 }),
      this.db().collection<PlatformRoleAssignment>('platform_role_assignments').createIndex({ subject: 1, role: 1 }, { unique: true }),
      this.db().collection('platform_principals').createIndex({ subject: 1 }, { unique: true }),
      this.db().collection('platform_principals').createIndex({ emailNormalized: 1 }, { unique: true }),
      this.db().collection('platform_external_identities').createIndex({ connectorId: 1, providerSubject: 1 }, { unique: true }),
      this.db().collection('platform_connector_configs').createIndex({ id: 1 }, { unique: true }),
      this.db().collection('platform_connector_configs').createIndex({ platformOrganizationId: 1, name: 1 }, { unique: true }),
      this.db().collection('platform_connector_configs').createIndex({ platformOrganizationId: 1, isLoginProvider: 1 }),
      this.db().collection('platform_local_credentials').createIndex({ platformOrganizationId: 1, emailNormalized: 1 }, { unique: true }),
      this.db().collection('platform_oauth_tokens').createIndex({ keyHash: 1 }, { unique: true }),
      this.db().collection('platform_oauth_login_states').createIndex({ state: 1 }, { unique: true }),
      this.db().collection('platform_oauth_login_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.db().collection<BrowserAppSpecification>('app_specifications').createIndex({ appId: 1, revision: 1 }, { unique: true }),
      this.db().collection<AppModuleRecord>('app_modules').createIndex({ appId: 1, revision: 1, id: 1 }, { unique: true }),
      this.db().collection<BrowserAgentRecord>('app_agents').createIndex({ appId: 1, revision: 1, id: 1 }, { unique: true }),
      this.db().collection<RouteDefinition>('app_routes').createIndex({ appId: 1, revision: 1, path: 1 }, { unique: true }),
      this.db().collection<RouteBinding>('route_bindings').createIndex({ hostname: 1, pathPrefix: 1 }, { unique: true }),
      this.db().collection<AppBuild>('app_builds').createIndex({ appId: 1, createdAt: -1 }),
      this.db().collection<BrowserGenerationJob>('app_generation_jobs').createIndex({ appId: 1, createdAt: -1 }),
      this.db().collection<BrowserGenerationJob>('app_generation_jobs').createIndex({ id: 1 }, { unique: true }),
      this.db().collection<ApplicationDiscoverySession>('application_discovery_sessions').createIndex({ appId: 1 }, { unique: true }),
      this.db().collection<BrowserRelease>('browser_releases').createIndex(
        { appId: 1, releaseKey: 1 }, { unique: true, partialFilterExpression: { releaseKey: { $type: 'string' } } },
      ),
      this.db().collection<ThemeRevision>('app_themes').createIndex({ appId: 1, revision: 1 }, { unique: true }),
      this.db().collection<TenancyRevision>('app_tenancy_revisions').createIndex({ appId: 1, revision: 1 }, { unique: true }),
      this.db().collection<EndTenant>('app_end_tenants').createIndex({ appId: 1, id: 1 }, { unique: true }),
      this.db().collection<EndTenant>('app_end_tenants').createIndex({ appId: 1, slug: 1 }, { unique: true }),
      this.db().collection<AppMembership>('app_memberships').createIndex({ appId: 1, userId: 1, tenantId: 1 }, { unique: true }),
      this.db().collection<AppMembership>('app_memberships').createIndex({ appId: 1, email: 1, tenantId: 1 }, { unique: true }),
      this.db().collection<TenancyMigration>('app_tenancy_migrations').createIndex({ appId: 1, createdAt: -1 }),
      this.db().collection('connector_rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.db().collection('connector_audit_events').createIndex({ appId: 1, createdAt: -1 }),
      this.db().collection('data_audit_events').createIndex({ appId: 1, tenantId: 1, createdAt: -1 }),
      this.db().collection('identity_exchange_nonces').createIndex({ jti: 1 }, { unique: true }),
      this.db().collection('identity_exchange_nonces').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }

  private async ensureSeed(): Promise<void> {
    await this.ensureControlPlaneSeed();
    if (await this.findApp(seedBrowserApp.id)) return;
    if (process.env.NODE_ENV === 'production' && process.env.SEED_BROWSER_DEMO !== 'true') return;
    await Promise.all([
      this.db().collection<BrowserApp>('browser_apps').insertOne(structuredClone(seedBrowserApp)),
      this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(structuredClone(seedBrowserAppSpecification)),
      this.db().collection<AppModuleRecord>('app_modules').insertMany(structuredClone(seedModules)),
      this.db().collection<RouteDefinition>('app_routes').insertMany(structuredClone(seedRoutes)),
      this.db().collection<DataSchemaRecord>('app_schemas').insertMany(structuredClone(seedSchemas)),
      this.db().collection<EntityPolicyRecord>('app_policies').insertMany(structuredClone(seedPolicies)),
      this.db().collection<ConnectorActionRecord>('app_connectors').insertMany(structuredClone(seedConnectors)),
      this.db().collection<BrowserAgentRecord>('app_agents').insertMany(structuredClone(seedAgents)),
      this.db().collection<RouteBinding>('route_bindings').insertMany(structuredClone(seedBindings)),
      this.db().collection<ThemeRevision>('app_themes').insertOne(structuredClone(seedTheme)),
      this.db().collection<TenancyRevision>('app_tenancy_revisions').insertOne(structuredClone(seedTenancy)),
      this.db().collection<EndTenant>('app_end_tenants').insertMany(structuredClone(seedEndTenants)),
      this.db().collection<AppMembership>('app_memberships').insertMany(structuredClone(seedMemberships)),
      this.db().collection(seedSchemas[0]!.physicalCollection).insertMany(structuredClone(seedTasks)),
    ]);
    await this.migrateEntityTenancy(seedBrowserApp.id, seedTenancy.mode, seedEndTenants[0]!.id);
  }

  private async ensureControlPlaneSeed(): Promise<void> {
    const now = new Date().toISOString();
    await this.db().collection<PlatformOrganization>('platform_organizations').updateOne(
      { id: 'everworker-labs' },
      { $setOnInsert: { id: 'everworker-labs', slug: 'everworker-labs', name: 'Everworker Labs', status: 'active', createdAt: now, updatedAt: now } },
      { upsert: true },
    );
    await this.db().collection<PlatformMembership>('platform_memberships').updateOne(
      { platformOrganizationId: 'everworker-labs', subject: 'local-superadmin' },
      { $setOnInsert: {
        id: randomUUID(), platformOrganizationId: 'everworker-labs', subject: 'local-superadmin', email: 'local-superadmin@local.onering.dev',
        displayName: 'Local superadmin', role: 'owner', status: 'active', version: 1, createdAt: now, updatedAt: now,
      } },
      { upsert: true },
    );
    await this.db().collection<PlatformRoleAssignment>('platform_role_assignments').updateOne(
      { subject: 'local-superadmin', role: 'platform_root' },
      { $setOnInsert: { id: randomUUID(), subject: 'local-superadmin', role: 'platform_root', status: 'active', createdAt: now } },
      { upsert: true },
    );
  }

  private async runMigrations(): Promise<void> {
    const migrations = this.db().collection<{ id: string; appliedAt: string }>('platform_migrations');
    if (!(await migrations.findOne({ id: 'platform-organization-ownership-v1' }))) {
      const apps = await this.db().collection('browser_apps').find({ platformOrganizationId: { $exists: false } }).toArray();
      for (const app of apps) {
        const legacyOwner = typeof app.ownerOrganizationId === 'string' ? app.ownerOrganizationId : 'everworker-labs';
        await this.db().collection('browser_apps').updateOne({ _id: app._id }, { $set: { platformOrganizationId: legacyOwner }, $unset: { ownerOrganizationId: '' } });
      }
      await migrations.insertOne({ id: 'platform-organization-ownership-v1', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'browser-specification-v1' }))) {
      const apps = await this.db().collection<BrowserApp>('browser_apps').find().toArray();
      for (const app of apps) {
        const projectId = app.projectId ?? (app.id === seedBrowserApp.id ? seedBrowserAppSpecification.projectId : app.id);
        const specRevision = app.specRevision ?? (app.id === seedBrowserApp.id ? seedBrowserAppSpecification.revision : 1);
        if (!(await this.db().collection<BrowserAppSpecification>('app_specifications').findOne({ appId: app.id, revision: specRevision }))) {
          const specification: BrowserAppSpecification = app.id === seedBrowserApp.id
            ? { ...structuredClone(seedBrowserAppSpecification), appId: app.id, projectId, revision: specRevision }
            : {
                id: randomUUID(), appId: app.id, projectId, revision: specRevision, status: 'approved',
                sections: [{ id: 'goal', title: 'Product goal', body: app.description }],
                structure: {
                  ...structuredClone(seedBrowserAppSpecification.structure), purpose: app.description, audience: app.tenancyMode,
                  acceptanceCriteria: [{ id: 'accept-goal', requirementId: 'goal', description: app.description, kind: 'journey' }],
                  pages: seedBrowserAppSpecification.structure.pages.map((page) => ({ ...page, acceptanceCriterionIds: ['accept-goal'] })),
                },
                createdAt: new Date().toISOString(),
              };
          await this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(specification);
        }
        await this.db().collection<BrowserApp>('browser_apps').updateOne({ id: app.id }, { $set: { projectId, specRevision } });
      }
      await migrations.insertOne({ id: 'browser-specification-v1', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'browser-contract-v2' }))) {
      const schemas = await this.db().collection<DataSchemaRecord>('app_schemas').find().toArray();
      for (const schema of schemas) {
        const readableFields = ['id', ...Object.keys((schema.jsonSchema.properties ?? {}) as object), 'createdAt', 'updatedAt', 'version'];
        const policies = await this.db().collection<EntityPolicyRecord>('app_policies').find({ appId: schema.appId, entity: schema.entity }).toArray();
        for (const policy of policies) {
          const grants = Object.fromEntries(Object.entries(policy.grants).map(([role, grant]) => [role, {
            ...grant,
            readFields: Array.isArray(grant.readFields) && grant.readFields.length ? grant.readFields : readableFields,
          }])) as EntityPolicyRecord['grants'];
          await this.db().collection<EntityPolicyRecord>('app_policies').updateOne({ _id: (policy as EntityPolicyRecord & { _id: ObjectId })._id }, { $set: { grants } });
        }
      }
      await this.db().collection<ConnectorActionRecord>('app_connectors').updateMany(
        { outputSchema: { $exists: false } },
        { $set: { outputSchema: { type: 'object', additionalProperties: true }, timeoutMs: 20_000 } },
      );
      await migrations.insertOne({ id: 'browser-contract-v2', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'browser-record-version-v3' }))) {
      const schemas = await this.db().collection<DataSchemaRecord>('app_schemas').find().toArray();
      for (const schema of schemas) {
        const collection = this.entityCollection(schema);
        await collection.updateMany({ appId: schema.appId, version: { $exists: false } }, { $set: { version: 1 } });
        await collection.createIndex({ appId: 1, id: 1 }, { unique: true });
        const policies = await this.db().collection<EntityPolicyRecord>('app_policies').find({ appId: schema.appId, entity: schema.entity }).toArray();
        for (const policy of policies) {
          const grants = Object.fromEntries(Object.entries(policy.grants).map(([role, grant]) => [role, {
            ...grant, readFields: [...new Set([...(grant.readFields ?? []), 'version'])],
          }])) as EntityPolicyRecord['grants'];
          await this.db().collection<EntityPolicyRecord>('app_policies').updateOne({ _id: (policy as EntityPolicyRecord & { _id: ObjectId })._id }, { $set: { grants } });
        }
      }
      await migrations.insertOne({ id: 'browser-record-version-v3', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'browser-authoritative-spec-v4' }))) {
      const apps = await this.db().collection<BrowserApp>('browser_apps').find().toArray();
      for (const app of apps) {
        const specification = await this.db().collection<BrowserAppSpecification>('app_specifications').findOne({ appId: app.id, revision: app.specRevision });
        const [modules, routes, schemas, policies, connectors] = await Promise.all([
          this.modules(app.id, app.sourceRevision), this.routes(app.id, app.sourceRevision), this.schemas(app.id, app.schemaRevision),
          this.policies(app.id, app.policyRevision), this.connectors(app.id, app.connectorRevision),
        ]);
        const requirementIds = specification?.sections.map((section) => section.id) ?? ['goal'];
        await Promise.all([
          this.db().collection<BrowserApp>('browser_apps').updateOne({ id: app.id }, { $set: { generatedFromSpecRevision: app.generatedFromSpecRevision ?? app.specRevision } }),
          this.db().collection<AppModuleRecord>('app_modules').updateMany({ appId: app.id, requirementIds: { $exists: false } }, { $set: { requirementIds } }),
          this.db().collection<RouteDefinition>('app_routes').updateMany({ appId: app.id, requirementIds: { $exists: false } }, { $set: { requirementIds } }),
          this.db().collection<DataSchemaRecord>('app_schemas').updateMany({ appId: app.id, requirementIds: { $exists: false } }, { $set: { requirementIds } }),
          this.db().collection<EntityPolicyRecord>('app_policies').updateMany({ appId: app.id, requirementIds: { $exists: false } }, { $set: { requirementIds } }),
          this.db().collection<ConnectorActionRecord>('app_connectors').updateMany({ appId: app.id, requirementIds: { $exists: false } }, { $set: { requirementIds } }),
        ]);
        for (const route of routes) if (!route.specPageId) {
          const specPageId = app.id === seedBrowserApp.id
            ? seedRoutes.find((candidate) => candidate.path === route.path)?.specPageId ?? `page-${route.id}`
            : `page-${route.id}`;
          await this.db().collection<RouteDefinition>('app_routes').updateOne({ appId: app.id, revision: route.revision, id: route.id }, { $set: { specPageId } });
          route.specPageId = specPageId;
        }
        if (specification && !specification.structure) {
          const structure: AppStructuredSpecification = app.id === seedBrowserApp.id ? structuredClone(seedBrowserAppSpecification.structure) : {
            purpose: specification.sections[0]?.body ?? app.description,
            audience: app.tenancyMode,
            personas: [], userStories: [],
            roles: ['public', 'viewer', 'editor', 'admin'].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), description: `${id} application role.` })),
            pages: routes.map((route) => ({ id: `page-${route.id}`, name: modules.find((module) => module.id === route.pageModuleId)?.name ?? route.id, path: route.path, purpose: modules.find((module) => module.id === route.pageModuleId)?.description ?? 'Application page.', public: route.public, roleIds: ['public', 'viewer', 'editor', 'admin'], states: ['loading', 'empty', 'error', 'forbidden', 'ready'] as AppStructuredSpecification['pages'][number]['states'], entityIds: schemas.map((schema) => schema.entity), workflowIds: [], agentIds: [], acceptanceCriterionIds: [] })),
            entities: schemas.map((schema) => ({ id: schema.entity, name: schema.displayName, description: `${schema.displayName} application data.`, fields: Object.entries((schema.jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([id, value]) => ({ id, type: (typeof value.type === 'string' && ['string', 'number', 'boolean', 'object', 'array'].includes(value.type) ? value.type : value.enum ? 'enum' : 'string') as AppStructuredSpecification['entities'][number]['fields'][number]['type'], required: Array.isArray(schema.jsonSchema.required) && schema.jsonSchema.required.includes(id), description: `${schema.displayName} ${id}.` })) })),
            workflows: [], agents: [], integrations: [], decisions: [], qualityAttributes: [],
            designBrief: { tone: 'Clear and trustworthy.', principles: ['Accessible interaction'], accessibilityTarget: 'AA' },
            acceptanceCriteria: specification.sections.map((section) => ({ id: `accept-${section.id}`, requirementId: section.id, description: section.body, kind: 'journey' as const })),
          };
          await this.db().collection<BrowserAppSpecification>('app_specifications').updateOne({ _id: specification._id }, { $set: { structure } });
        }
        if (!(await this.db().collection<BrowserAgentRecord>('app_agents').findOne({ appId: app.id, revision: app.sourceRevision }))) {
          const agents = seedAgents.map((agent) => ({ ...structuredClone(agent), appId: app.id, revision: app.sourceRevision }));
          if (agents.length) await this.db().collection<BrowserAgentRecord>('app_agents').insertMany(agents);
        }
        await this.db().collection<AppBuild>('app_builds').updateMany(
          { appId: app.id, specRevision: { $exists: false } },
          { $set: { specRevision: app.specRevision, acceptance: { total: requirementIds.length, covered: 0, requirementIds: [] } } },
        );
        await this.db().collection<BrowserRelease>('browser_releases').updateMany(
          { appId: app.id, environment: { $exists: false } },
          { $set: { specRevision: app.specRevision, environment: 'production', generatorVersion: 'legacy-v1' } },
        );
      }
      await migrations.insertOne({ id: 'browser-authoritative-spec-v4', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'browser-app-lifecycle-v5' }))) {
      const apps = await this.db().collection<BrowserApp>('browser_apps').find().toArray();
      for (const app of apps) {
        const lifecycleStatus: BrowserApp['lifecycleStatus'] = app.activeReleaseId ? 'production'
          : app.previewReleaseId ? 'preview_ready'
            : app.generatedFromSpecRevision === app.specRevision && app.sourceRevision > 0 ? 'specifying' : 'draft';
        await this.db().collection<BrowserApp>('browser_apps').updateOne({ id: app.id }, { $set: { lifecycleStatus } });
      }
      await migrations.insertOne({ id: 'browser-app-lifecycle-v5', appliedAt: new Date().toISOString() });
    }
    if (!(await migrations.findOne({ id: 'generic-application-definition-v6' }))) {
      const apps = await this.db().collection<BrowserApp>('browser_apps').find().toArray();
      for (const app of apps) {
        const profile = app.profile ?? defaultApplicationProfile('browser_data', app.tenancyMode);
        await this.db().collection<BrowserApp>('browser_apps').updateOne({ id: app.id }, { $set: {
          profile,
          runtimeProfile: app.runtimeProfile ?? 'browser_data',
          generatorId: app.generatorId ?? 'browser-data',
          specificationApprovalStatus: app.specificationApprovalStatus ?? 'approved',
        } });
        const specifications = await this.db().collection<BrowserAppSpecification>('app_specifications').find({ appId: app.id }).toArray();
        for (const specification of specifications) {
          const structure = specification.structure;
          if (!structure) continue;
          const roles = structure.roles ?? [];
          const pages = structure.pages ?? [];
          const connectors = await this.db().collection<ConnectorActionRecord>('app_connectors').find({ appId: app.id }).toArray();
          await this.db().collection<BrowserAppSpecification>('app_specifications').updateOne({ _id: specification._id }, { $set: {
            'structure.personas': structure.personas ?? [{ id: 'primary-user', name: 'Primary user', description: 'Uses the application to achieve its principal outcome.', goals: [structure.purpose], painPoints: [], roleIds: roles.filter((role) => role.id !== 'public').map((role) => role.id) }],
            'structure.userStories': structure.userStories ?? pages.map((page) => ({ id: `story-${page.id}`, title: page.name, personaId: 'primary-user', statement: `As a primary user, I want to ${page.purpose.toLowerCase()}`, priority: 'must', surfaceIds: [page.id], workflowIds: page.workflowIds, acceptanceCriterionIds: page.acceptanceCriterionIds })),
            'structure.integrations': structure.integrations ?? connectors.map((connector) => ({ id: connector.id, name: connector.id, purpose: connector.description, connector: connector.connector, operations: [connector.action], failureBehavior: 'Expose a recoverable error and preserve manual work.', dataClassification: 'standard' })),
            'structure.decisions': structure.decisions ?? [],
            'structure.qualityAttributes': structure.qualityAttributes ?? [{ id: 'accessible-ui', category: 'accessibility', requirement: 'Core application journeys are accessible.', measure: 'WCAG 2.2 AA checks pass.' }],
            'structure.designBrief': structure.designBrief ?? { tone: 'Clear, trustworthy and appropriate for the work.', principles: ['Clear hierarchy', 'Visible system state', 'Accessible interaction'], accessibilityTarget: 'AA' },
          } });
        }
      }
      await migrations.insertOne({ id: 'generic-application-definition-v6', appliedAt: new Date().toISOString() });
    }
  }
}
