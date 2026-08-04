import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import {
  Connector,
  ConnectorConfigStore,
  getVendorAuthTemplate,
  getVendorInfo,
  type ConnectorConfig,
} from '@everworker/oneringai';
import type { Response } from 'express';
import type { Db } from 'mongodb';
import { BrowserAppRepository, type PlatformMembership, type PlatformOrganization } from './browser-app.repository.js';
import { ControlPlaneIdentityService } from './control-plane-identity.service.js';
import { MongoEncryptedTokenStorage, MongoOrganizationConnectorStorage } from './mongo-connector.storage.js';
import type {
  CreateLocalUserInput,
  CreateOrganizationConnectorInput,
  ExternalIdentityDocument,
  LocalCredentialDocument,
  LoginProviderConfig,
  OAuthLoginStateDocument,
  OrganizationConnectorDocument,
  OrganizationConnectorSummary,
  PlatformPrincipalDocument,
  ProviderProfile,
} from './organization-auth.types.js';

const LOGIN_ACCOUNT_ID = 'login';
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const LOCAL_LOCKOUT_MS = 15 * 60 * 1000;
const LOCAL_MAX_ATTEMPTS = 5;

type OAuthFlowInternals = {
  codeVerifiers: Map<string, { verifier: string; timestamp: number }>;
  states: Map<string, { state: string; timestamp: number }>;
};

@Injectable()
export class OrganizationAuthService {
  private tokenStorage?: MongoEncryptedTokenStorage;

  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(ControlPlaneIdentityService) private readonly identities: ControlPlaneIdentityService,
  ) {}

  async publicConfiguration(organizationSlug: string) {
    const organization = await this.organizationBySlug(organizationSlug);
    const providers = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .find(
        { platformOrganizationId: organization.id, isLoginProvider: true },
        { projection: { id: 1, name: 1, vendorId: 1, 'config.displayName': 1 } },
      )
      .sort({ name: 1 })
      .toArray();
    const storedOrganization = await this.database().collection('platform_organizations').findOne(
      { id: organization.id },
      { projection: { 'authPolicy.localPasswordEnabled': 1 } },
    );
    return {
      organization: { id: organization.id, slug: organization.slug, name: organization.name },
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.config.displayName || provider.name,
        vendorId: provider.vendorId || String(provider.config.serviceType || provider.config.vendor || 'unknown'),
      })),
      localPasswordEnabled: storedOrganization?.authPolicy?.localPasswordEnabled === true,
    };
  }

  async listConnectors(platformOrganizationId: string): Promise<OrganizationConnectorSummary[]> {
    const documents = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .find({ platformOrganizationId }).sort({ name: 1 }).toArray();
    return documents.map((document) => this.summary(document));
  }

  connectorTemplates() {
    return ['microsoft', 'google-api'].map((vendorId) => {
      const vendor = getVendorInfo(vendorId)!;
      const auth = getVendorAuthTemplate(vendorId, 'oauth-user')!;
      return {
        vendorId,
        name: vendor.name,
        description: auth.description,
        requiredFields: auth.requiredFields,
        optionalFields: auth.optionalFields ?? [],
        scopes: auth.scopes ?? [],
        scopeDescriptions: auth.scopeDescriptions ?? {},
        credentialsSetupURL: vendor.credentialsSetupURL,
        redirectUri: this.oauthRedirectUri(),
      };
    });
  }

  async createConnector(
    platformOrganizationId: string,
    input: CreateOrganizationConnectorInput,
  ): Promise<OrganizationConnectorSummary> {
    this.validateConnectorInput(input);
    const storage = new MongoOrganizationConnectorStorage(this.database(), platformOrganizationId);
    if (await storage.has(input.name)) throw new ConflictException('A connector with this name already exists');
    const store = new ConnectorConfigStore(storage, this.connectorEncryptionSecret());
    const scope = input.scope?.trim() || this.defaultLoginScope(input.vendorId);
    const credentials: Record<string, string> = {
      clientId: input.clientId.trim(),
      redirectUri: this.oauthRedirectUri(),
      scope,
      ...(input.clientSecret?.trim() ? { clientSecret: input.clientSecret.trim() } : {}),
      ...(input.vendorId === 'microsoft' ? { tenantId: input.tenantId!.trim() } : {}),
    };
    await store.saveFromTemplate(input.name, input.vendorId, 'oauth-user', credentials, {
      displayName: input.displayName?.trim() || input.name,
    });
    const loginProviderConfig = this.normalizeLoginProviderConfig(input);
    const document = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOneAndUpdate(
        { platformOrganizationId, name: input.name },
        { $set: { isLoginProvider: input.isLoginProvider === true, loginProviderConfig } },
        { returnDocument: 'after' },
      );
    if (!document) throw new Error('Connector persistence failed');
    this.evictRuntimeConnector(document.id);
    return this.summary(document);
  }

  async setLoginProvider(
    platformOrganizationId: string,
    connectorId: string,
    input: { enabled?: unknown; autoCreateUsers?: unknown; allowedDomains?: unknown },
  ): Promise<OrganizationConnectorSummary> {
    if (typeof input.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    if (input.autoCreateUsers !== undefined && typeof input.autoCreateUsers !== 'boolean') {
      throw new BadRequestException('autoCreateUsers must be a boolean');
    }
    if (input.allowedDomains !== undefined && !Array.isArray(input.allowedDomains)) {
      throw new BadRequestException('allowedDomains must be an array');
    }
    const document = await this.connectorById(platformOrganizationId, connectorId);
    const auth = document.config.auth as { type?: string; flow?: string };
    if (auth.type !== 'oauth' || auth.flow !== 'authorization_code') {
      throw new BadRequestException('Only OAuth authorization-code connectors can be login providers');
    }
    const allowedDomains = input.allowedDomains === undefined
      ? document.loginProviderConfig.allowedDomains
      : this.normalizeDomains(input.allowedDomains);
    const loginProviderConfig: LoginProviderConfig = {
      autoCreateUsers: input.autoCreateUsers === undefined
        ? document.loginProviderConfig.autoCreateUsers
        : input.autoCreateUsers,
      allowedDomains,
    };
    const updated = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOneAndUpdate(
        { id: connectorId, platformOrganizationId },
        { $set: { isLoginProvider: input.enabled, loginProviderConfig, updatedAt: Date.now() } },
        { returnDocument: 'after' },
      );
    if (!updated) throw new NotFoundException('Connector not found');
    return this.summary(updated);
  }

  async setLocalPasswordEnabled(platformOrganizationId: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    const result = await this.database().collection('platform_organizations').updateOne(
      { id: platformOrganizationId },
      { $set: { 'authPolicy.localPasswordEnabled': enabled, updatedAt: new Date().toISOString() } },
    );
    if (result.matchedCount !== 1) throw new NotFoundException('Organization not found');
    return { localPasswordEnabled: enabled };
  }

  async createLocalUser(platformOrganizationId: string, input: CreateLocalUserInput) {
    const email = this.normalizeEmail(input.email);
    if (input.displayName?.trim().length < 2 || input.displayName.trim().length > 100) {
      throw new BadRequestException('Display name must contain 2 to 100 characters');
    }
    if (typeof input.password !== 'string' || input.password.length < 10) {
      throw new BadRequestException('Password must contain at least 10 characters');
    }
    const allowedRoles = ['owner', 'admin', 'builder', 'release_manager', 'secrets_admin', 'billing', 'viewer'];
    if (!allowedRoles.includes(input.role)) throw new BadRequestException('Invalid organization role');
    const now = new Date().toISOString();
    let principal: PlatformPrincipalDocument | null = await this.database().collection<PlatformPrincipalDocument>('platform_principals')
      .findOne({ emailNormalized: email });
    if (!principal) {
      principal = {
        subject: `usr_${randomUUID()}`,
        email,
        emailNormalized: email,
        displayName: input.displayName.trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await this.database().collection<PlatformPrincipalDocument>('platform_principals').insertOne(principal);
    }
    const membership: PlatformMembership = {
      id: randomUUID(),
      platformOrganizationId,
      subject: principal.subject,
      email,
      displayName: input.displayName.trim(),
      role: input.role,
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.database().collection<PlatformMembership>('platform_memberships').updateOne(
      { platformOrganizationId, subject: principal.subject },
      {
        $set: { email, displayName: membership.displayName, role: input.role, status: 'active', updatedAt: now },
        $setOnInsert: {
          id: membership.id,
          platformOrganizationId,
          subject: principal.subject,
          version: 1,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    const passwordHash = await this.hashPassword(input.password);
    await this.database().collection<LocalCredentialDocument>('platform_local_credentials').updateOne(
      { platformOrganizationId, emailNormalized: email },
      {
        $set: { subject: principal.subject, passwordHash, failedAttempts: 0, updatedAt: now },
        $setOnInsert: { id: randomUUID(), platformOrganizationId, emailNormalized: email, createdAt: now },
        $unset: { lockedUntil: '' },
      },
      { upsert: true },
    );
    return { subject: principal.subject, email, displayName: membership.displayName, role: input.role };
  }

  async loginWithPassword(organizationSlug: string, emailInput: unknown, password: unknown, response: Response, clientAddress: string) {
    await this.enforcePublicAuthRateLimit(`password:${organizationSlug}:${clientAddress}`, 10);
    if (typeof emailInput !== 'string' || typeof password !== 'string') throw new UnauthorizedException('Invalid credentials');
    const organization = await this.organizationBySlug(organizationSlug);
    const storedOrganization = await this.database().collection('platform_organizations').findOne({ id: organization.id });
    if (storedOrganization?.authPolicy?.localPasswordEnabled !== true) {
      throw new ForbiddenException('Local password login is disabled for this organization');
    }
    const email = this.normalizeEmail(emailInput);
    const credential = await this.database().collection<LocalCredentialDocument>('platform_local_credentials')
      .findOne({ platformOrganizationId: organization.id, emailNormalized: email });
    if (!credential || (credential.lockedUntil && credential.lockedUntil > new Date())) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.verifyPassword(password, credential.passwordHash))) {
      const attempts = credential.failedAttempts + 1;
      await this.database().collection<LocalCredentialDocument>('platform_local_credentials').updateOne(
        { id: credential.id },
        { $set: { failedAttempts: attempts, ...(attempts >= LOCAL_MAX_ATTEMPTS ? { lockedUntil: new Date(Date.now() + LOCAL_LOCKOUT_MS) } : {}) } },
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    const membership = await this.repository.platformMembership(credential.subject, organization.id);
    const principal = await this.database().collection<PlatformPrincipalDocument>('platform_principals')
      .findOne({ subject: credential.subject, status: 'active' });
    if (!membership || membership.status !== 'active' || !principal) throw new UnauthorizedException('Invalid credentials');
    await this.database().collection<LocalCredentialDocument>('platform_local_credentials').updateOne(
      { id: credential.id },
      { $set: { failedAttempts: 0, updatedAt: new Date().toISOString() }, $unset: { lockedUntil: '' } },
    );
    const token = await this.identities.issueSession({
      subject: principal.subject,
      email: principal.email,
      activePlatformOrganizationId: organization.id,
    });
    this.identities.setSessionCookie(response, token);
    return { ok: true, organizationId: organization.id };
  }

  async startOAuthLogin(organizationSlug: string, connectorId: string, clientAddress: string): Promise<{ authUrl: string }> {
    await this.enforcePublicAuthRateLimit(`oauth:${organizationSlug}:${clientAddress}`, 10);
    const organization = await this.organizationBySlug(organizationSlug);
    const document = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOne({ id: connectorId, platformOrganizationId: organization.id, isLoginProvider: true });
    if (!document) throw new NotFoundException('Login provider not found');
    const connector = await this.runtimeConnector(document);
    const attemptSubject = `login_${randomUUID()}`;
    const authUrl = await connector.startAuth(attemptSubject, LOGIN_ACCOUNT_ID);
    const state = new URL(authUrl).searchParams.get('state');
    const flow = this.oauthFlow(connector);
    const key = `${attemptSubject}:${LOGIN_ACCOUNT_ID}`;
    const verifier = flow.codeVerifiers.get(key);
    const expected = flow.states.get(key);
    if (!(state && verifier && expected)) throw new Error('OneRingAI did not expose a complete PKCE login state');
    await this.database().collection<OAuthLoginStateDocument>('platform_oauth_login_states').insertOne({
      state,
      platformOrganizationId: organization.id,
      organizationSlug: organization.slug,
      connectorId: document.id,
      attemptSubject,
      accountId: LOGIN_ACCOUNT_ID,
      codeVerifier: verifier.verifier,
      expectedState: expected.state,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    return { authUrl };
  }

  async completeOAuthLogin(callbackUrl: string, state: string, response: Response): Promise<string> {
    const stateDocument = await this.database().collection<OAuthLoginStateDocument>('platform_oauth_login_states')
      .findOneAndDelete({ state, expiresAt: { $gt: new Date() } });
    if (!stateDocument) throw new UnauthorizedException('Login state is invalid or expired');
    const connectorDocument = await this.connectorById(stateDocument.platformOrganizationId, stateDocument.connectorId);
    if (!connectorDocument.isLoginProvider) throw new UnauthorizedException('Login provider is disabled');
    const connector = await this.runtimeConnector(connectorDocument);
    const flow = this.oauthFlow(connector);
    const key = `${stateDocument.attemptSubject}:${stateDocument.accountId}`;
    flow.codeVerifiers.set(key, { verifier: stateDocument.codeVerifier, timestamp: Date.now() });
    flow.states.set(key, { state: stateDocument.expectedState, timestamp: Date.now() });
    await connector.handleCallback(callbackUrl, stateDocument.attemptSubject, stateDocument.accountId);
    const accessToken = await connector.getToken(stateDocument.attemptSubject, stateDocument.accountId);
    const profile = await this.fetchProviderProfile(connectorDocument.vendorId || '', accessToken);
    const principal = await this.matchIdentity(connectorDocument, profile);
    const clientId = String((connector.config.auth as { clientId?: string }).clientId || '');
    await this.tokens().moveAuthorizationCodeToken(
      clientId,
      stateDocument.attemptSubject,
      stateDocument.accountId,
      principal.subject,
      profile.email,
    );
    const token = await this.identities.issueSession({
      subject: principal.subject,
      email: principal.email,
      activePlatformOrganizationId: stateDocument.platformOrganizationId,
    });
    this.identities.setSessionCookie(response, token);
    return this.webOrigin();
  }

  private async matchIdentity(connector: OrganizationConnectorDocument, profile: ProviderProfile): Promise<PlatformPrincipalDocument> {
    const now = new Date().toISOString();
    const identities = this.database().collection<ExternalIdentityDocument>('platform_external_identities');
    const linkedIdentity = await identities.findOne({ connectorId: connector.id, providerSubject: profile.subject });
    if (linkedIdentity) {
      const membership = await this.repository.platformMembership(linkedIdentity.subject, connector.platformOrganizationId);
      const principal = await this.database().collection<PlatformPrincipalDocument>('platform_principals')
        .findOne({ subject: linkedIdentity.subject, status: 'active' });
      if (!membership || membership.status !== 'active' || !principal) throw new ForbiddenException('Account access is disabled');
      await identities.updateOne({ id: linkedIdentity.id }, { $set: { providerEmail: profile.email, lastLoginAt: now } });
      return principal;
    }
    let principal: PlatformPrincipalDocument | null = await this.database().collection<PlatformPrincipalDocument>('platform_principals')
      .findOne({ emailNormalized: profile.email });
    if (!principal) {
      principal = {
        subject: `usr_${randomUUID()}`,
        email: profile.email,
        emailNormalized: profile.email,
        displayName: profile.displayName || profile.email.split('@')[0]!,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await this.database().collection<PlatformPrincipalDocument>('platform_principals').insertOne(principal);
    }
    const existingMembership = await this.repository.platformMembership(principal.subject, connector.platformOrganizationId);
    if (existingMembership?.status === 'suspended') throw new ForbiddenException('Account access is disabled');
    if (!existingMembership) {
      if (!connector.loginProviderConfig.autoCreateUsers) throw new ForbiddenException('Contact an organization administrator for access');
      this.assertAllowedDomain(profile.email, connector.loginProviderConfig.allowedDomains);
      const membership: PlatformMembership = {
        id: randomUUID(),
        platformOrganizationId: connector.platformOrganizationId,
        subject: principal.subject,
        email: profile.email,
        displayName: principal.displayName,
        role: 'viewer',
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.database().collection<PlatformMembership>('platform_memberships').insertOne(membership);
    } else if (existingMembership.status === 'invited') {
      await this.database().collection<PlatformMembership>('platform_memberships').updateOne(
        { id: existingMembership.id },
        { $set: { status: 'active', email: profile.email, updatedAt: now }, $inc: { version: 1 } },
      );
    }
    await identities.insertOne({
      id: randomUUID(),
      subject: principal.subject,
      connectorId: connector.id,
      platformOrganizationId: connector.platformOrganizationId,
      providerSubject: profile.subject,
      providerEmail: profile.email,
      ...(profile.displayName ? { providerName: profile.displayName } : {}),
      createdAt: now,
      lastLoginAt: now,
    });
    return principal;
  }

  private async fetchProviderProfile(vendorId: string, accessToken: string): Promise<ProviderProfile> {
    const request = vendorId === 'microsoft'
      ? fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName', {
        headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000),
      })
      : fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000),
      });
    const response = await request;
    if (!response.ok) throw new UnauthorizedException('The login provider did not return a profile');
    const raw = await response.json() as Record<string, unknown>;
    const subject = vendorId === 'microsoft' ? raw.id : raw.id ?? raw.sub;
    const email = vendorId === 'microsoft' ? raw.mail ?? raw.userPrincipalName : raw.email;
    const displayName = vendorId === 'microsoft' ? raw.displayName : raw.name;
    if (vendorId === 'google-api' && raw.verified_email !== true) {
      throw new UnauthorizedException('Google did not return a verified email address');
    }
    if (typeof subject !== 'string' || typeof email !== 'string') {
      throw new UnauthorizedException('The login provider did not return a verified identity');
    }
    return {
      subject,
      email: this.normalizeEmail(email),
      ...(typeof displayName === 'string' ? { displayName } : {}),
    };
  }

  private async runtimeConnector(document: OrganizationConnectorDocument): Promise<Connector> {
    const runtimeName = this.runtimeConnectorName(document.id);
    if (Connector.has(runtimeName)) return Connector.get(runtimeName);
    const store = new ConnectorConfigStore(
      new MongoOrganizationConnectorStorage(this.database(), document.platformOrganizationId),
      this.connectorEncryptionSecret(),
    );
    const config = await store.get(document.name);
    if (!config) throw new NotFoundException('Connector configuration not found');
    Connector.setDefaultStorage(this.tokens());
    return Connector.create({ ...config, name: runtimeName });
  }

  private oauthFlow(connector: Connector): OAuthFlowInternals {
    const oauthManager = (connector as unknown as { oauthManager?: { flow?: OAuthFlowInternals } }).oauthManager;
    if (!oauthManager?.flow) throw new Error('Connector is not an OAuth authorization-code connector');
    return oauthManager.flow;
  }

  private tokens(): MongoEncryptedTokenStorage {
    this.tokenStorage ??= new MongoEncryptedTokenStorage(this.database(), this.connectorEncryptionSecret());
    return this.tokenStorage;
  }

  private async connectorById(platformOrganizationId: string, connectorId: string) {
    const document = await this.database().collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOne({ id: connectorId, platformOrganizationId });
    if (!document) throw new NotFoundException('Connector not found');
    return document;
  }

  private async organizationBySlug(slugInput: string): Promise<PlatformOrganization> {
    const slug = slugInput.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new NotFoundException('Organization not found');
    const organization = await this.database().collection<PlatformOrganization>('platform_organizations')
      .findOne({ slug, status: 'active' });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  private summary(document: OrganizationConnectorDocument): OrganizationConnectorSummary {
    return {
      id: document.id,
      name: document.name,
      displayName: document.config.displayName || document.name,
      vendorId: document.vendorId || String(document.config.serviceType || document.config.vendor || 'unknown'),
      authTemplateId: document.authTemplateId || 'oauth-user',
      isLoginProvider: document.isLoginProvider,
      loginProviderConfig: document.loginProviderConfig,
      configured: true,
      updatedAt: new Date(document.updatedAt).toISOString(),
    };
  }

  private validateConnectorInput(input: CreateOrganizationConnectorInput): void {
    if (!input || !['microsoft', 'google-api'].includes(input.vendorId)) throw new BadRequestException('Unsupported connector vendor');
    if (typeof input.name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.name)) {
      throw new BadRequestException('Connector name must be a lowercase slug');
    }
    if (typeof input.clientId !== 'string' || !input.clientId.trim()) throw new BadRequestException('clientId is required');
    if (input.vendorId === 'microsoft' && (typeof input.tenantId !== 'string' || !input.tenantId.trim())) {
      throw new BadRequestException('tenantId is required for Microsoft');
    }
    if (input.allowedDomains !== undefined && !Array.isArray(input.allowedDomains)) {
      throw new BadRequestException('allowedDomains must be an array');
    }
  }

  private normalizeLoginProviderConfig(input: CreateOrganizationConnectorInput): LoginProviderConfig {
    return {
      autoCreateUsers: input.autoCreateUsers !== false,
      allowedDomains: this.normalizeDomains(input.allowedDomains ?? []),
    };
  }

  private normalizeDomains(input: unknown[]): string[] {
    const domains = input.map((value) => {
      if (typeof value !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim())) {
        throw new BadRequestException('allowedDomains contains an invalid domain');
      }
      return value.trim().toLowerCase();
    });
    return [...new Set(domains)];
  }

  private assertAllowedDomain(email: string, domains: string[]): void {
    if (!domains.length) return;
    const domain = email.split('@')[1];
    if (!domain || !domains.includes(domain)) throw new ForbiddenException('Email domain is not allowed for this organization');
  }

  private normalizeEmail(input: string): string {
    const email = input.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid email address is required');
    return email;
  }

  private defaultLoginScope(vendorId: 'microsoft' | 'google-api'): string {
    return vendorId === 'microsoft' ? 'openid profile email User.Read offline_access' : 'openid email profile';
  }

  private connectorEncryptionSecret(): string {
    const secret = process.env.CONNECTOR_ENCRYPTION_KEY ?? process.env.RUNTIME_SESSION_SECRET ?? process.env.CONTROL_PLANE_JWT_SECRET;
    if (secret && secret.length >= 16) return secret;
    if (process.env.NODE_ENV === 'production') throw new Error('CONNECTOR_ENCRYPTION_KEY must contain at least 32 characters');
    return 'onering-local-connector-encryption-key-do-not-use-in-production';
  }

  private oauthRedirectUri(): string {
    const origin = process.env.PUBLIC_API_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '4100'}`;
    return `${origin.replace(/\/$/, '')}/api/auth/oauth/callback`;
  }

  private webOrigin(): string {
    return (process.env.WEB_APP_ORIGIN ?? process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
  }

  private runtimeConnectorName(id: string): string {
    return `platform-login-${id}`;
  }

  private evictRuntimeConnector(id: string): void {
    Connector.remove(this.runtimeConnectorName(id));
  }

  private database(): Db {
    return this.repository.db();
  }

  private async enforcePublicAuthRateLimit(key: string, maximum: number): Promise<void> {
    if (!(await this.repository.consumeConnectorRate(`control-plane-auth:${createHash('sha256').update(key).digest('hex')}`, maximum))) {
      throw new HttpException('Too many authentication attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await this.scrypt(password, salt);
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  private async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [algorithm, saltValue, hashValue] = encoded.split('$');
    if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await this.scrypt(password, Buffer.from(saltValue, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private scrypt(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      nodeScrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  }
}
