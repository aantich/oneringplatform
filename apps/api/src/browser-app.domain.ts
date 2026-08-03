export type AppRole = 'public' | 'viewer' | 'editor' | 'admin';
export type ModuleKind = 'page' | 'layout' | 'component' | 'provider' | 'hook' | 'utility' | 'test';
export type CrudOperation = 'create' | 'read' | 'update' | 'delete';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type AppTenancyMode = 'personal' | 'team' | 'multi_organization';

export interface TenancyRevision {
  id: string;
  appId: string;
  revision: number;
  mode: AppTenancyMode;
  organizationLabel: string;
  allowMultipleMemberships: boolean;
  status: 'published' | 'superseded';
  createdBy: 'user' | 'system';
  createdAt: string;
}

export interface TenancyMigration {
  id: string;
  appId: string;
  fromRevision: number;
  toRevision: number;
  fromMode: AppTenancyMode;
  toMode: AppTenancyMode;
  defaultTenantId?: string;
  preservedScopedRecords: number;
  assignedUnscopedRecords: number;
  status: 'completed' | 'rolled_back';
  createdAt: string;
}

export interface EndTenant {
  id: string;
  appId: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface AppMembership {
  id: string;
  appId: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId?: string;
  roles: Exclude<AppRole, 'public'>[];
  status: 'invited' | 'active' | 'suspended';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeTokens {
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryContrast: string;
    accent: string;
    success: string;
    danger: string;
    border: string;
  };
  typography: {
    fontFamily: 'inter' | 'manrope' | 'system' | 'serif';
    headingStyle: 'compact' | 'editorial' | 'balanced';
    baseSize: 14 | 15 | 16 | 17 | 18;
  };
  shape: {
    radius: 'sharp' | 'soft' | 'rounded';
    borderWidth: 0 | 1 | 2;
  };
  density: ThemeDensity;
  contentWidth: 'narrow' | 'standard' | 'wide';
}

export interface ThemeRevision {
  id: string;
  appId: string;
  revision: number;
  name: string;
  description: string;
  starterId?: string;
  tokens: ThemeTokens;
  componentVariants: {
    navigation: 'solid' | 'glass' | 'minimal';
    cards: 'outlined' | 'soft' | 'elevated';
    buttons: 'solid' | 'gradient' | 'outline';
  };
  customCss: string;
  status: 'draft' | 'published' | 'superseded';
  createdBy: 'visual-design-agent' | 'user' | 'system';
  accessibility: { contrastScore: number; issues: string[] };
  createdAt: string;
}

export interface ThemeStarter {
  id: string;
  name: string;
  description: string;
  tokens: ThemeTokens;
  componentVariants: ThemeRevision['componentVariants'];
}

export interface BrowserApp {
  id: string;
  publicKey: string;
  ownerOrganizationId: string;
  name: string;
  description: string;
  runtimeProfile: 'browser_data';
  projectId: string;
  specRevision: number;
  sourceRevision: number;
  schemaRevision: number;
  policyRevision: number;
  connectorRevision: number;
  themeRevision: number;
  tenancyRevision: number;
  tenancyMode: AppTenancyMode;
  agentAccent?: string;
  agentHeadline?: string;
  activeReleaseId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserAppSpecification {
  id: string;
  appId: string;
  revision: number;
  projectId: string;
  status: 'approved' | 'superseded';
  sections: Array<{ id: string; title: string; body: string }>;
  createdAt: string;
}

export interface AppModuleRecord {
  id: string;
  appId: string;
  revision: number;
  kind: ModuleKind;
  name: string;
  description: string;
  source: string;
  dependencies: string[];
  packageImports: string[];
  propsSchema?: Record<string, unknown>;
  requiredCapabilities: string[];
  contentHash: string;
  createdAt: string;
}

export interface RouteDefinition {
  id: string;
  appId: string;
  revision: number;
  path: string;
  pageModuleId: string;
  layoutModuleId?: string;
  public: boolean;
  requiredCapabilities: string[];
  navigation?: { label: string; icon?: string; order: number };
}

export interface DataSchemaRecord {
  id: string;
  appId: string;
  revision: number;
  entity: string;
  displayName: string;
  physicalCollection: string;
  deploymentMode: 'shared_namespace' | 'dedicated_database';
  jsonSchema: Record<string, unknown>;
  indexes: Array<{ fields: Record<string, 1 | -1>; unique?: boolean }>;
  publicRecordFilter?: Record<string, unknown>;
}

export interface PolicyGrant {
  operations: CrudOperation[];
  readFilter?: Record<string, unknown>;
  readFields: string[];
  writeFields: string[];
  uiCapabilities: string[];
}

export interface EntityPolicyRecord {
  id: string;
  appId: string;
  revision: number;
  entity: string;
  grants: Record<AppRole, PolicyGrant>;
}

export interface ConnectorActionRecord {
  id: string;
  appId: string;
  revision: number;
  connector: string;
  action: string;
  description: string;
  allowedRoles: AppRole[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  rateLimitPerMinute: number;
}

export interface AppBuild {
  id: string;
  appId: string;
  sourceRevision: number;
  themeRevision: number;
  tenancyRevision: number;
  runtimeVersion: number;
  status: 'building' | 'passed' | 'failed';
  artifactFileId?: string;
  artifactDigest?: string;
  css: string;
  themeName: string;
  themeColor: string;
  moduleCount: number;
  routeCount: number;
  tests: number;
  checks: ReleaseCheck[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface BrowserRelease {
  id: string;
  appId: string;
  version: string;
  buildId: string;
  sourceRevision: number;
  schemaRevision: number;
  policyRevision: number;
  connectorRevision: number;
  themeRevision: number;
  tenancyRevision: number;
  runtimeVersion: number;
  artifactDigest: string;
  releaseKey: string;
  status: 'active' | 'superseded';
  createdAt: string;
}

export interface ReleaseCheck {
  id: string;
  label: string;
  status: 'passed' | 'failed';
  detail: string;
  durationMs: number;
}

export interface RouteBinding {
  id: string;
  appId: string;
  environment: 'production';
  type: 'platform_path' | 'platform_hostname' | 'custom_hostname';
  hostname: string;
  pathPrefix: string;
  canonical: boolean;
  status: 'active' | 'pending_verification';
  verificationToken?: string;
  verifiedAt?: string;
  certificateStatus?: 'pending' | 'active';
}

export interface RuntimePrincipal {
  subject: string;
  role: AppRole;
  appId: string;
  tenantId?: string;
  membershipId?: string;
  membershipVersion?: number;
  csrf: string;
}

export interface BrowserAppDetail {
  app: BrowserApp;
  modules: AppModuleRecord[];
  routes: RouteDefinition[];
  schemas: DataSchemaRecord[];
  policies: EntityPolicyRecord[];
  connectors: ConnectorActionRecord[];
  builds: AppBuild[];
  releases: BrowserRelease[];
  bindings: RouteBinding[];
  themes: ThemeRevision[];
  tenancy: TenancyRevision;
  tenancyRevisions: TenancyRevision[];
  endTenants: EndTenant[];
  memberships: AppMembership[];
  tenancyMigrations: TenancyMigration[];
  specification: BrowserAppSpecification;
}
