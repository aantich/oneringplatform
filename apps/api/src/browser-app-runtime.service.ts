import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { AppRole, BrowserApp, BrowserRelease, CrudOperation, PolicyGrant, RuntimePrincipal, TenancyRevision } from './browser-app.domain.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { AiService } from './ai.service.js';

const roles: AppRole[] = ['public', 'viewer', 'editor', 'admin'];
type RuntimeContract = { release: BrowserRelease; tenancy: TenancyRevision };

@Injectable()
export class BrowserAppRuntimeService {
  private readonly ajv: { compile: (schema: object) => ValidateFunction };
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly secret = new TextEncoder().encode(
    process.env.RUNTIME_SESSION_SECRET ?? 'local-development-secret-change-before-production',
  );

  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(AiService) private readonly ai: AiService,
  ) {
    if (process.env.NODE_ENV === 'production' && !process.env.RUNTIME_SESSION_SECRET) {
      throw new Error('RUNTIME_SESSION_SECRET is required in production');
    }
    const AjvConstructor = ((AjvModule as unknown as { default?: new (options: object) => { compile: (schema: object) => ValidateFunction } }).default ?? AjvModule) as unknown as new (options: object) => { compile: (schema: object) => ValidateFunction };
    const addFormats = ((addFormatsModule as unknown as { default?: (ajv: object) => void }).default ?? addFormatsModule) as unknown as (ajv: object) => void;
    this.ajv = new AjvConstructor({ allErrors: true, removeAdditional: false });
    addFormats(this.ajv);
  }

  async bootstrap(appKey: string, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const principal = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    return this.session(app, principal, basePath, contract);
  }

  async demoLogin(appKey: string, role: unknown, requestedTenantId: unknown, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const current = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    this.assertCsrf(req, current);
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Demo authentication is disabled');
    }
    if (typeof role !== 'string' || !roles.includes(role as AppRole)) throw new BadRequestException('Unknown role');
    const principal = await this.demoPrincipal(app, role as AppRole, requestedTenantId, contract.tenancy.mode);
    await this.setSession(res, principal, basePath, req);
    return this.session(app, principal, basePath, contract);
  }

  async exchangeIdentity(appKey: string, token: unknown, requestedTenantId: unknown, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const current = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    this.assertCsrf(req, current);
    if (typeof token !== 'string' || token.length > 16_384) throw new BadRequestException('A valid identity exchange token is required');
    const secret = process.env.IDENTITY_EXCHANGE_SECRET;
    if (!secret) throw new UnauthorizedException('Production identity exchange is not configured');
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer: 'onering-identity', audience: app.id,
      }));
    } catch {
      throw new UnauthorizedException('Identity exchange token is invalid');
    }
    if (!payload.sub || !payload.jti || !payload.exp) throw new UnauthorizedException('Identity exchange token is incomplete');
    if (!(await this.repository.consumeIdentityExchange(payload.jti, app.id, new Date(payload.exp * 1000)))) {
      throw new UnauthorizedException('Identity exchange token was already used');
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
    let memberships = await this.repository.membershipsForIdentity(app.id, payload.sub, email);
    const detail = await this.repository.detail(app.id);
    if (!detail) throw new NotFoundException('Browser app not found');
    if (contract.tenancy.mode === 'multi_organization') {
      const tenantId = typeof requestedTenantId === 'string' ? requestedTenantId : undefined;
      memberships = tenantId ? memberships.filter((membership) => membership.tenantId === tenantId) : memberships;
    }
    let membership = memberships[0];
    if (!membership) throw new ForbiddenException('No active or invited membership exists for this application');
    if (membership.status === 'invited' || membership.userId !== payload.sub) {
      membership = await this.repository.activateMembershipIdentity(app.id, membership.id, payload.sub) ?? undefined;
    }
    if (!membership) throw new ForbiddenException('Membership could not be activated');
    if (membership.tenantId && !(await this.repository.endTenant(app.id, membership.tenantId))) {
      throw new ForbiddenException('The selected organization is not active');
    }
    const role = (['admin', 'editor', 'viewer'] as const).find((candidate) => membership!.roles.includes(candidate));
    if (!role) throw new ForbiddenException('Membership has no supported application role');
    const principal: RuntimePrincipal = {
      subject: payload.sub, appId: app.id, role, tenantId: membership.tenantId,
      membershipId: membership.id, membershipVersion: membership.version, csrf: randomUUID(),
    };
    await this.setSession(res, principal, basePath, req);
    return this.session(app, principal, basePath, contract);
  }

  async switchOrganization(appKey: string, requestedTenantId: unknown, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const current = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    this.assertCsrf(req, current);
    const detail = await this.repository.detail(app.id);
    if (!detail || contract.tenancy.mode !== 'multi_organization') throw new BadRequestException('This app has no organization switcher');
    if (current.role === 'public' || typeof requestedTenantId !== 'string') throw new ForbiddenException('An authenticated organization membership is required');
    const membership = await this.repository.membership(app.id, current.subject, requestedTenantId);
    const tenant = await this.repository.endTenant(app.id, requestedTenantId);
    if (!membership || !tenant || !membership.roles.includes(current.role as Exclude<AppRole, 'public'>)) {
      throw new ForbiddenException('You do not belong to this organization');
    }
    const principal: RuntimePrincipal = {
      ...current, tenantId: tenant.id, membershipId: membership.id,
      membershipVersion: membership.version, csrf: randomUUID(),
    };
    await this.setSession(res, principal, basePath, req);
    return this.session(app, principal, basePath, contract);
  }

  async list(appKey: string, entity: string, limitInput: unknown, cursorInput: unknown, req: Request, res: Response, basePath: string) {
    const { app, principal, schema, grant, contract } = await this.context(appKey, entity, 'read', req, res, basePath);
    const limit = limitInput === undefined ? 50 : Number(limitInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Page limit must be between 1 and 100');
    const cursor = this.decodeCursor(cursorInput);
    const page = await this.repository.listEntityPage(schema, this.readScope(app, principal, grant, schema.publicRecordFilter, contract.tenancy.mode), limit, cursor);
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);
    const tail = items.at(-1);
    return {
      items: items.map((item) => this.present(item, grant)), count: items.length,
      nextCursor: hasMore && tail ? Buffer.from(JSON.stringify({ createdAt: tail.createdAt, id: tail.id })).toString('base64url') : undefined,
    };
  }

  async get(appKey: string, entity: string, id: string, req: Request, res: Response, basePath: string) {
    const { app, principal, schema, grant, contract } = await this.context(appKey, entity, 'read', req, res, basePath);
    const item = await this.repository.findEntity(schema, { id, ...this.readScope(app, principal, grant, schema.publicRecordFilter, contract.tenancy.mode) });
    if (!item) throw new NotFoundException('Record not found');
    return this.present(item, grant);
  }

  async create(appKey: string, entity: string, input: unknown, req: Request, res: Response, basePath: string) {
    const { app, principal, schema, grant, contract } = await this.context(appKey, entity, 'create', req, res, basePath);
    this.assertCsrf(req, principal);
    const value = this.validateWrite(input, grant.writeFields, schema.jsonSchema, `${app.id}:${schema.entity}:${schema.revision}`);
    const now = new Date().toISOString();
    const idempotencyKey = req.get('idempotency-key');
    if (process.env.NODE_ENV === 'production' && !idempotencyKey) throw new BadRequestException('Idempotency-Key is required for record creation');
    if (idempotencyKey && idempotencyKey.length > 200) throw new BadRequestException('Idempotency-Key is too long');
    const id = idempotencyKey
      ? `idem_${createHash('sha256').update(`${app.id}:${schema.entity}:${principal.subject}:${idempotencyKey}`).digest('hex').slice(0, 32)}`
      : randomUUID();
    const existing = await this.repository.findEntity(schema, { id, ...this.writeScope(app, principal, contract.tenancy.mode) });
    if (existing) return this.present(existing, grant);
    const document = { ...value, id, appId: app.id, ...this.tenantWriteField(app, principal, contract.tenancy.mode), version: 1, createdAt: now, updatedAt: now, createdBy: principal.subject };
    try {
      await this.repository.insertEntity(schema, document);
    } catch (error) {
      if ((error as { code?: number }).code === 11000 && idempotencyKey) {
        const winner = await this.repository.findEntity(schema, { id, ...this.writeScope(app, principal, contract.tenancy.mode) });
        if (winner) return this.present(winner, grant);
      }
      throw error;
    }
    await this.repository.writeDataAudit(this.auditEvent(app, principal, schema.entity, 'create', id, Object.keys(value), 1, contract.release.policyRevision));
    return this.present(document, grant);
  }

  async update(appKey: string, entity: string, id: string, input: unknown, req: Request, res: Response, basePath: string) {
    const { app, principal, schema, grant, contract } = await this.context(appKey, entity, 'update', req, res, basePath);
    this.assertCsrf(req, principal);
    const scope = this.mutationScope(app, principal, grant, contract.tenancy.mode);
    const current = await this.repository.findEntity(schema, { id, ...scope });
    if (!current) throw new NotFoundException('Record not found');
    const expectedVersion = this.expectedVersion(req, current.version);
    const patch = this.allowedObject(input, grant.writeFields);
    const merged = Object.fromEntries(Object.keys(schema.jsonSchema.properties as object).map((key) => [key, Object.hasOwn(patch, key) ? patch[key] : current[key]]));
    this.validateSchema(merged, schema.jsonSchema, `${app.id}:${schema.entity}:${schema.revision}`);
    const matched = await this.repository.updateEntity(
      schema,
      { id, ...scope, version: expectedVersion },
      { $set: { ...patch, updatedAt: new Date().toISOString(), updatedBy: principal.subject }, $inc: { version: 1 } },
    );
    if (!matched) throw new NotFoundException('Record not found');
    const updated = await this.repository.findEntity(schema, { id, ...scope });
    if (!updated) throw new NotFoundException('Record no longer exists');
    await this.repository.writeDataAudit(this.auditEvent(app, principal, schema.entity, 'update', id, Object.keys(patch), Number(updated.version ?? expectedVersion + 1), contract.release.policyRevision));
    return this.present(updated, grant);
  }

  async delete(appKey: string, entity: string, id: string, req: Request, res: Response, basePath: string) {
    const { app, principal, schema, grant, contract } = await this.context(appKey, entity, 'delete', req, res, basePath);
    this.assertCsrf(req, principal);
    const scope = this.mutationScope(app, principal, grant, contract.tenancy.mode);
    const current = await this.repository.findEntity(schema, { id, ...scope });
    if (!current) throw new NotFoundException('Record not found');
    const deleted = await this.repository.deleteEntity(schema, { id, ...scope, version: this.expectedVersion(req, current.version) });
    if (!deleted) throw new NotFoundException('Record not found');
    await this.repository.writeDataAudit(this.auditEvent(app, principal, schema.entity, 'delete', id, [], Number(current.version ?? 1), contract.release.policyRevision));
    return { deleted: true, id };
  }

  async connector(appKey: string, connectorId: string, action: string, input: unknown, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const principal = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    this.assertCsrf(req, principal);
    const connector = await this.repository.findConnector(app.id, connectorId, action, contract.release.connectorRevision);
    if (!connector) throw new NotFoundException('Connector action not found');
    if (!connector.allowedRoles.includes(principal.role)) throw new ForbiddenException('Role cannot invoke this connector action');
    this.validateSchema(input, connector.inputSchema, `connector:${connector.id}:${connector.revision}`);
    const rateKey = `${app.id}:${principal.tenantId ?? 'app'}:${principal.subject}:${connector.id}`;
    if (!(await this.repository.consumeConnectorRate(rateKey, connector.rateLimitPerMinute))) throw new ForbiddenException('Connector rate limit exceeded');
    const context = (input as { context: string }).context;
    const auditBase = {
      id: randomUUID(), appId: app.id, tenantId: principal.tenantId, subject: principal.subject,
      connectorId: connector.id, action: connector.action,
      inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    };
    try {
      const suggestion = await this.withTimeout(this.ai.suggestTask(context, connector.connector), connector.timeoutMs);
      const output = { suggestion, connector: connector.connector, action: connector.action };
      this.validateSchema(output, connector.outputSchema, `connector-output:${connector.id}:${connector.revision}`);
      await this.repository.writeConnectorAudit({ ...auditBase, status: 'passed' });
      return output;
    } catch (error) {
      await this.repository.writeConnectorAudit({ ...auditBase, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown connector failure' });
      throw error;
    }
  }

  async agentTurn(appKey: string, agentId: string, input: unknown, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const principal = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    this.assertCsrf(req, principal);
    const definition = await this.repository.agent(app.id, agentId, contract.release.sourceRevision);
    if (!definition) throw new NotFoundException('Browser agent not found');
    if (!definition.allowedRoles.includes(principal.role)) throw new ForbiddenException('Role cannot run this browser agent');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Browser agent turn requires an object');
    const value = input as Record<string, unknown>;
    const goal = typeof value.goal === 'string' ? value.goal.trim() : '';
    const iteration = typeof value.iteration === 'number' ? value.iteration : Number.NaN;
    const history = Array.isArray(value.history) ? value.history : [];
    if (goal.length < 3 || goal.length > 4_000) throw new BadRequestException('Browser agent goal must contain 3 to 4000 characters');
    if (!Number.isInteger(iteration) || iteration < 1 || iteration > definition.maximumIterations) throw new BadRequestException('Browser agent iteration is outside its release contract');
    if (history.length > definition.maximumIterations * 2 || JSON.stringify(history).length > 30_000) throw new BadRequestException('Browser agent history is too large');
    const safeHistory = history.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new BadRequestException(`Browser agent history item ${index + 1} is invalid`);
      const item = entry as Record<string, unknown>;
      if ((item.role !== 'assistant' && item.role !== 'tool') || typeof item.content !== 'string' || item.content.length > 8_000) throw new BadRequestException(`Browser agent history item ${index + 1} is invalid`);
      return { role: item.role, content: item.content } as { role: 'assistant' | 'tool'; content: string };
    });
    const rateKey = `${app.id}:${principal.tenantId ?? 'app'}:${principal.subject}:agent:${definition.id}`;
    if (!(await this.repository.consumeConnectorRate(rateKey, 30))) throw new ForbiddenException('Browser agent rate limit exceeded');
    const auditBase = {
      id: randomUUID(), appId: app.id, tenantId: principal.tenantId, subject: principal.subject,
      connectorId: `agent:${definition.id}`, action: 'turn', iteration,
      inputDigest: createHash('sha256').update(JSON.stringify({ goal, safeHistory })).digest('hex'),
    };
    try {
      const turn = await this.withTimeout(this.ai.browserAgentTurn(definition, { goal, iteration, history: safeHistory }), 30_000);
      await this.repository.writeConnectorAudit({ ...auditBase, status: 'passed', outputType: turn.type });
      return { ...turn, maximumIterations: definition.maximumIterations, humanApprovalRequired: definition.humanApprovalRequired };
    } catch (error) {
      await this.repository.writeConnectorAudit({ ...auditBase, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown browser agent failure' });
      throw error;
    }
  }

  private async context(appKey: string, entity: string, operation: CrudOperation, req: Request, res: Response, basePath: string) {
    const app = await this.requireApp(appKey);
    const contract = await this.runtimeContract(app, req);
    const principal = await this.ensurePrincipal(app.id, req, res, basePath, contract.tenancy.mode);
    const config = await this.repository.entityConfig(app.id, entity, {
      schemaRevision: contract.release.schemaRevision,
      policyRevision: contract.release.policyRevision,
    });
    if (!config) throw new NotFoundException('Entity not found');
    const grant = config.policy.grants[principal.role];
    if (!grant?.operations.includes(operation)) throw new ForbiddenException(`Role ${principal.role} cannot ${operation} ${entity}`);
    return { app, principal, schema: config.schema, grant, contract };
  }

  private async requireApp(appKey: string) {
    const app = await this.repository.findApp(appKey);
    if (!app) throw new NotFoundException('Browser app not found');
    return app;
  }

  private async session(app: BrowserApp, principal: RuntimePrincipal, basePath: string, contract: RuntimeContract) {
    const [policies, detail, memberships] = await Promise.all([
      this.repository.policies(app.id, contract.release.policyRevision),
      this.repository.detail(app.id),
      principal.role === 'public' ? Promise.resolve([]) : this.repository.membershipsForSubject(app.id, principal.subject),
    ]);
    if (!detail) throw new NotFoundException('Browser app not found');
    const available = contract.tenancy.mode === 'multi_organization'
      ? memberships.flatMap((membership) => {
          const tenant = detail.endTenants.find((candidate) => candidate.id === membership.tenantId && candidate.status === 'active');
          return tenant ? [{ id: tenant.id, name: tenant.name, role: membership.roles[0] }] : [];
        })
      : [];
    return {
      app: { id: app.id, name: app.name, description: app.description, runtimeProfile: app.runtimeProfile },
      principal: { subject: principal.subject, role: principal.role, tenantId: principal.tenantId },
      capabilities: [...new Set(policies.flatMap((policy) => policy.grants[principal.role].uiCapabilities))],
      tenancy: {
        mode: contract.tenancy.mode,
        organizationLabel: contract.tenancy.organizationLabel,
        activeOrganization: available.find((tenant) => tenant.id === principal.tenantId),
        organizations: available,
      },
      csrfToken: principal.csrf, basePath,
      releaseId: contract.release.id,
      environment: contract.release.environment,
      sourceRevision: contract.release.sourceRevision,
      schemaRevision: contract.release.schemaRevision,
      policyRevision: contract.release.policyRevision,
      connectorRevision: contract.release.connectorRevision,
    };
  }

  private async demoPrincipal(app: BrowserApp, role: AppRole, requestedTenantId: unknown, tenancyMode: TenancyRevision['mode']): Promise<RuntimePrincipal> {
    if (role === 'public') return { subject: 'anonymous', role, appId: app.id, csrf: randomUUID() };
    const subject = `demo-${role}`;
    const detail = await this.repository.detail(app.id);
    if (!detail) throw new NotFoundException('Browser app not found');
    const memberships = await this.repository.membershipsForSubject(app.id, subject);
    if (tenancyMode === 'multi_organization') {
      const requested = typeof requestedTenantId === 'string' ? requestedTenantId : undefined;
      const membership = memberships.find((candidate) => candidate.tenantId === requested && candidate.roles.includes(role as Exclude<AppRole, 'public'>))
        ?? memberships.find((candidate) => candidate.roles.includes(role as Exclude<AppRole, 'public'>));
      if (!membership?.tenantId || !(await this.repository.endTenant(app.id, membership.tenantId))) {
        throw new ForbiddenException('The demo identity has no active organization membership');
      }
      return { subject, role, appId: app.id, tenantId: membership.tenantId, membershipId: membership.id, membershipVersion: membership.version, csrf: randomUUID() };
    }
    const membership = memberships.find((candidate) => candidate.roles.includes(role as Exclude<AppRole, 'public'>));
    return { subject, role, appId: app.id, membershipId: membership?.id ?? 'local-policy-preview', membershipVersion: membership?.version ?? 1, csrf: randomUUID() };
  }

  private readScope(app: BrowserApp, principal: RuntimePrincipal, grant: PolicyGrant, publicRecordFilter: Record<string, unknown> | undefined, tenancy: TenancyRevision['mode']): Record<string, unknown> {
    const base: Record<string, unknown> = { appId: app.id };
    if (tenancy === 'multi_organization') {
      if (principal.role === 'public') Object.assign(base, { tenantId: { $exists: false }, ...(publicRecordFilter ?? {}) });
      else {
        if (!principal.tenantId) throw new ForbiddenException('An active organization is required');
        Object.assign(base, { $or: [{ tenantId: principal.tenantId }, ...(publicRecordFilter ? [{ tenantId: { $exists: false }, ...publicRecordFilter }] : [])] });
      }
    }
    return grant.readFilter ? { $and: [base, grant.readFilter] } : base;
  }

  private writeScope(app: BrowserApp, principal: RuntimePrincipal, tenancy: TenancyRevision['mode']): Record<string, unknown> {
    const scope: Record<string, unknown> = { appId: app.id };
    if (tenancy === 'multi_organization') {
      if (!principal.tenantId) throw new ForbiddenException('An active organization is required');
      scope.tenantId = principal.tenantId;
    }
    return scope;
  }

  private mutationScope(app: BrowserApp, principal: RuntimePrincipal, grant: PolicyGrant, tenancy: TenancyRevision['mode']): Record<string, unknown> {
    const base = this.writeScope(app, principal, tenancy);
    return grant.readFilter ? { $and: [base, grant.readFilter] } : base;
  }

  private tenantWriteField(app: BrowserApp, principal: RuntimePrincipal, tenancy: TenancyRevision['mode']): Record<string, string> {
    return tenancy === 'multi_organization' && principal.tenantId ? { tenantId: principal.tenantId } : {};
  }

  private validateWrite(input: unknown, allowed: string[], schema: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = this.allowedObject(input, allowed);
    this.validateSchema(value, schema, key);
    return value;
  }

  private allowedObject(input: unknown, allowed: string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('JSON object required');
    const value = input as Record<string, unknown>;
    const denied = Object.keys(value).filter((key) => !allowed.includes(key));
    if (denied.length) throw new ForbiddenException(`Fields are not writable: ${denied.join(', ')}`);
    return value;
  }

  private validateSchema(value: unknown, schema: Record<string, unknown>, key: string): void {
    let validate = this.validators.get(key);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.validators.set(key, validate);
    }
    if (!validate(value)) {
      throw new BadRequestException({ message: 'Data validation failed', errors: validate.errors });
    }
  }

  private decodeCursor(input: unknown): { createdAt: string; id: string } | undefined {
    if (input === undefined) return undefined;
    if (typeof input !== 'string' || input.length > 1024) throw new BadRequestException('Invalid page cursor');
    try {
      const value = JSON.parse(Buffer.from(input, 'base64url').toString()) as Record<string, unknown>;
      if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.id !== 'string' || value.id.length > 200) throw new Error();
      return { createdAt: value.createdAt, id: value.id };
    } catch {
      throw new BadRequestException('Invalid page cursor');
    }
  }

  private expectedVersion(req: Request, stored: unknown): number {
    const current = typeof stored === 'number' ? stored : 1;
    const header = req.get('if-match');
    if (!header) {
      if (process.env.NODE_ENV === 'production') throw new BadRequestException('If-Match record version is required');
      return current;
    }
    const expected = Number(header.replace(/^W\//, '').replaceAll('"', ''));
    if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('If-Match must contain a record version');
    if (expected !== current) throw new BadRequestException('Record changed; reload before saving');
    return expected;
  }

  private auditEvent(app: BrowserApp, principal: RuntimePrincipal, entity: string, operation: CrudOperation, recordId: string, changedFields: string[], version: number, policyRevision: number) {
    return {
      id: randomUUID(), appId: app.id, tenantId: principal.tenantId, subject: principal.subject,
      entity, operation, recordId, changedFields, version, policyRevision,
    };
  }

  private async ensurePrincipal(appId: string, req: Request, res: Response, basePath: string, tenancyMode: TenancyRevision['mode']): Promise<RuntimePrincipal> {
    const token = this.readCookie(req, this.cookieName(appId));
    if (token) {
      try {
        const result = await jwtVerify(token, this.secret, { issuer: 'onering-runtime', audience: appId });
        const payload = result.payload as unknown as RuntimePrincipal;
        if (payload.appId === appId && roles.includes(payload.role)) {
          const app = await this.repository.findApp(appId);
          const detail = app ? await this.repository.detail(appId) : null;
          if (!detail) throw new Error('App not found');
          if (payload.role === 'public') return payload;
          if (tenancyMode !== 'multi_organization' && payload.membershipId === 'local-policy-preview') return payload;
          const membership = await this.repository.membership(appId, payload.subject, payload.tenantId);
          if (membership && membership.id === payload.membershipId && membership.version === payload.membershipVersion && membership.roles.includes(payload.role as Exclude<AppRole, 'public'>)) return payload;
        }
      } catch {
        // Invalid or expired cookies are replaced with a least-privilege public session.
      }
    }
    const principal: RuntimePrincipal = { subject: 'anonymous', role: 'public', appId, csrf: randomUUID() };
    await this.setSession(res, principal, basePath, req);
    return principal;
  }

  private async setSession(res: Response, principal: RuntimePrincipal, basePath: string, req: Request): Promise<void> {
    const token = await new SignJWT({ ...principal })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('onering-runtime')
      .setAudience(principal.appId)
      .setSubject(principal.subject)
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(this.secret);
    res.cookie(this.cookieName(principal.appId), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.get('x-forwarded-proto') === 'https',
      path: basePath === '/' ? '/' : `${basePath}/`,
      maxAge: 8 * 60 * 60 * 1000,
    });
  }

  private assertCsrf(req: Request, principal: RuntimePrincipal): void {
    if (req.get('x-csrf-token') !== principal.csrf) throw new UnauthorizedException('CSRF validation failed');
  }

  private readCookie(req: Request, name: string): string | undefined {
    const cookies = req.headers.cookie?.split(';').map((item) => item.trim().split('=')) ?? [];
    const value = cookies.find(([key]) => key === name)?.[1];
    return value ? decodeURIComponent(value) : undefined;
  }

  private cookieName(appId: string): string {
    return `or_session_${appId.replace(/[^a-z0-9]/gi, '_')}`;
  }

  private async runtimeContract(app: BrowserApp, req: Request): Promise<RuntimeContract> {
    const previewId = req.get('x-onering-preview-release');
    const previewToken = req.get('x-onering-preview-token');
    let release: BrowserRelease | undefined;
    if (previewId || previewToken) {
      const preview = previewId && previewToken ? await this.repository.release(app.id, previewId) : null;
      if (!preview || preview.release.status !== 'preview' || preview.release.previewToken !== previewToken) {
        throw new NotFoundException('Application preview contract expired; reopen the preview from the studio');
      }
      release = preview.release;
    } else {
      release = (await this.repository.activeRelease(app.id))?.release;
    }
    if (!release) throw new NotFoundException('Application release not found');
    const tenancy = await this.repository.tenancyRevision(app.id, release.tenancyRevision);
    if (!tenancy) throw new NotFoundException('Application tenancy contract not found');
    return { release, tenancy };
  }

  private present(document: Record<string, unknown>, grant: PolicyGrant) {
    const { _id, appId, tenantId, createdBy, updatedBy, ...safe } = document;
    void _id; void appId; void tenantId; void createdBy; void updatedBy;
    const readable = grant.readFields?.length ? new Set(grant.readFields) : new Set(Object.keys(safe));
    return Object.fromEntries(Object.entries(safe).filter(([key]) => readable.has(key)));
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Connector action timed out')), timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
