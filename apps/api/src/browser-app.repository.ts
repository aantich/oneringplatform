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
  AppMembership,
  AppModuleRecord,
  BrowserApp,
  BrowserAppDetail,
  BrowserAppSpecification,
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

  async createAppGraph(input: {
    app: BrowserApp; specification: BrowserAppSpecification; modules: AppModuleRecord[]; routes: RouteDefinition[]; schemas: DataSchemaRecord[];
    policies: EntityPolicyRecord[]; connectors: ConnectorActionRecord[]; theme: ThemeRevision;
    tenancy: TenancyRevision; tenants: EndTenant[]; memberships: AppMembership[]; bindings: RouteBinding[];
  }): Promise<void> {
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db().collection<BrowserApp>('browser_apps').insertOne(input.app, { session });
        await this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(input.specification, { session });
        if (input.modules.length) await this.db().collection<AppModuleRecord>('app_modules').insertMany(input.modules, { session });
        if (input.routes.length) await this.db().collection<RouteDefinition>('app_routes').insertMany(input.routes, { session });
        if (input.schemas.length) await this.db().collection<DataSchemaRecord>('app_schemas').insertMany(input.schemas, { session });
        if (input.policies.length) await this.db().collection<EntityPolicyRecord>('app_policies').insertMany(input.policies, { session });
        if (input.connectors.length) await this.db().collection<ConnectorActionRecord>('app_connectors').insertMany(input.connectors, { session });
        await this.db().collection<ThemeRevision>('app_themes').insertOne(input.theme, { session });
        await this.db().collection<TenancyRevision>('app_tenancy_revisions').insertOne(input.tenancy, { session });
        if (input.tenants.length) await this.db().collection<EndTenant>('app_end_tenants').insertMany(input.tenants, { session });
        if (input.memberships.length) await this.db().collection<AppMembership>('app_memberships').insertMany(input.memberships, { session });
        if (input.bindings.length) await this.db().collection<RouteBinding>('route_bindings').insertMany(input.bindings, { session });
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
    const [modules, routes, schemas, policies, connectors, builds, releases, bindings, themes, tenancyRevisions, endTenants, memberships, tenancyMigrations, specification] = await Promise.all([
      this.modules(app.id, app.sourceRevision),
      this.routes(app.id, app.sourceRevision),
      this.schemas(app.id, app.schemaRevision),
      this.policies(app.id, app.policyRevision),
      this.connectors(app.id, app.connectorRevision),
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
    return { app, modules, routes, schemas, policies, connectors, builds, releases, bindings, themes, tenancy, tenancyRevisions, endTenants, memberships, tenancyMigrations, specification };
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
    await this.db().collection<TenancyMigration>('app_tenancy_migrations').insertOne(migration);
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
    await this.db().collection<ThemeRevision>('app_themes').insertOne(theme);
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

  private async activateReleaseAttempt(release: BrowserRelease, retryDuplicate: boolean): Promise<BrowserRelease> {
    const session = this.client!.startSession();
    let activated = release;
    try {
      await session.withTransaction(async () => {
        const releases = this.db().collection<BrowserRelease>('browser_releases');
        const existing = await releases.findOne({ appId: release.appId, releaseKey: release.releaseKey }, { session });
        activated = existing ? { ...existing, status: 'active' } : release;
        if (!existing) await releases.insertOne(release, { session });
        await releases.updateMany(
          { appId: release.appId, id: { $ne: activated.id }, status: 'active' },
          { $set: { status: 'superseded' } }, { session },
        );
        await releases.updateOne({ id: activated.id }, { $set: { status: 'active' } }, { session });
        const result = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          {
            id: release.appId, sourceRevision: release.sourceRevision, schemaRevision: release.schemaRevision,
            policyRevision: release.policyRevision, connectorRevision: release.connectorRevision,
            themeRevision: release.themeRevision, tenancyRevision: release.tenancyRevision,
          },
          { $set: { activeReleaseId: activated.id, updatedAt: release.createdAt } }, { session },
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

  async entityConfig(appId: string, entity: string): Promise<{ schema: DataSchemaRecord; policy: EntityPolicyRecord } | null> {
    const app = await this.findApp(appId);
    if (!app) return null;
    const [schema, policy] = await Promise.all([
      this.db().collection<DataSchemaRecord>('app_schemas').findOne({ appId, revision: app.schemaRevision, entity }),
      this.db().collection<EntityPolicyRecord>('app_policies').findOne({ appId, revision: app.policyRevision, entity }),
    ]);
    return schema && policy ? { schema, policy } : null;
  }

  async findConnector(appId: string, id: string, action: string): Promise<ConnectorActionRecord | null> {
    const app = await this.findApp(appId);
    if (!app) return null;
    return this.db().collection<ConnectorActionRecord>('app_connectors').findOne({ appId, revision: app.connectorRevision, id, action });
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
        description: patch?.description ?? (item.id === 'task-board-page' ? `${item.description} Agent revision: ${headline}` : item.description),
        source,
        contentHash: createHash('sha256').update(source).digest('hex'),
        createdAt: new Date().toISOString(),
      };
    });
    const nextRoutes = (await this.routes(app.id, app.sourceRevision)).map((stored) => {
      const { _id, ...route } = stored as RouteDefinition & { _id?: ObjectId };
      void _id;
      return { ...route, revision: nextRevision };
    });
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db().collection<AppModuleRecord>('app_modules').insertMany(next, { session });
        await this.db().collection<RouteDefinition>('app_routes').insertMany(nextRoutes, { session });
        const updated = await this.db().collection<BrowserApp>('browser_apps').updateOne(
          { id: app.id, sourceRevision: app.sourceRevision },
          { $set: { sourceRevision: nextRevision, updatedAt: new Date().toISOString(), agentAccent: accent, agentHeadline: headline } },
          { session },
        );
        if (updated.matchedCount !== 1) throw new Error('Application source changed while the agent revision was being written');
      });
    } finally {
      await session.endSession();
    }
    return nextRevision;
  }

  async publishSpecification(
    appId: string,
    expectedRevision: number,
    sections: BrowserAppSpecification['sections'],
    createdAt: string,
  ): Promise<BrowserAppSpecification> {
    const next: BrowserAppSpecification = {
      id: randomUUID(), appId, revision: expectedRevision + 1,
      projectId: (await this.findApp(appId))?.projectId ?? appId,
      status: 'approved', sections, createdAt,
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
          { id: appId, specRevision: expectedRevision }, { $set: { specRevision: next.revision, updatedAt: createdAt } }, { session },
        );
      });
      return next;
    } finally {
      await session.endSession();
    }
  }

  async restoreSourceRevision(appId: string, sourceRevision: number): Promise<void> {
    await this.db().collection<BrowserApp>('browser_apps').updateOne({ id: appId }, { $set: { sourceRevision, updatedAt: new Date().toISOString() } });
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
      this.db().collection<BrowserAppSpecification>('app_specifications').createIndex({ appId: 1, revision: 1 }, { unique: true }),
      this.db().collection<AppModuleRecord>('app_modules').createIndex({ appId: 1, revision: 1, id: 1 }, { unique: true }),
      this.db().collection<RouteDefinition>('app_routes').createIndex({ appId: 1, revision: 1, path: 1 }, { unique: true }),
      this.db().collection<RouteBinding>('route_bindings').createIndex({ hostname: 1, pathPrefix: 1 }, { unique: true }),
      this.db().collection<AppBuild>('app_builds').createIndex({ appId: 1, createdAt: -1 }),
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
    if (await this.findApp(seedBrowserApp.id)) return;
    if (process.env.NODE_ENV === 'production' && process.env.SEED_BROWSER_DEMO !== 'true') return;
    await Promise.all([
      this.db().collection<BrowserApp>('browser_apps').insertOne(seedBrowserApp),
      this.db().collection<BrowserAppSpecification>('app_specifications').insertOne(seedBrowserAppSpecification),
      this.db().collection<AppModuleRecord>('app_modules').insertMany(seedModules),
      this.db().collection<RouteDefinition>('app_routes').insertMany(seedRoutes),
      this.db().collection<DataSchemaRecord>('app_schemas').insertMany(seedSchemas),
      this.db().collection<EntityPolicyRecord>('app_policies').insertMany(seedPolicies),
      this.db().collection<ConnectorActionRecord>('app_connectors').insertMany(seedConnectors),
      this.db().collection<RouteBinding>('route_bindings').insertMany(seedBindings),
      this.db().collection<ThemeRevision>('app_themes').insertOne(seedTheme),
      this.db().collection<TenancyRevision>('app_tenancy_revisions').insertOne(seedTenancy),
      this.db().collection<EndTenant>('app_end_tenants').insertMany(seedEndTenants),
      this.db().collection<AppMembership>('app_memberships').insertMany(seedMemberships),
      this.db().collection(seedSchemas[0]!.physicalCollection).insertMany(seedTasks),
    ]);
    await this.migrateEntityTenancy(seedBrowserApp.id, seedTenancy.mode, seedEndTenants[0]!.id);
  }

  private async runMigrations(): Promise<void> {
    const migrations = this.db().collection<{ id: string; appliedAt: string }>('platform_migrations');
    if (!(await migrations.findOne({ id: 'browser-specification-v1' }))) {
      const apps = await this.db().collection<BrowserApp>('browser_apps').find().toArray();
      for (const app of apps) {
        const projectId = app.projectId ?? (app.id === seedBrowserApp.id ? seedBrowserAppSpecification.projectId : app.id);
        const specRevision = app.specRevision ?? (app.id === seedBrowserApp.id ? seedBrowserAppSpecification.revision : 1);
        if (!(await this.db().collection<BrowserAppSpecification>('app_specifications').findOne({ appId: app.id, revision: specRevision }))) {
          const specification: BrowserAppSpecification = app.id === seedBrowserApp.id
            ? { ...structuredClone(seedBrowserAppSpecification), appId: app.id, projectId, revision: specRevision }
            : { id: randomUUID(), appId: app.id, projectId, revision: specRevision, status: 'approved', sections: [{ id: 'goal', title: 'Product goal', body: app.description }], createdAt: new Date().toISOString() };
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
  }
}
