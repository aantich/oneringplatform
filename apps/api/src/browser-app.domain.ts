export type AppRole = 'public' | 'viewer' | 'editor' | 'admin';
export type ModuleKind = 'page' | 'layout' | 'component' | 'provider' | 'hook' | 'utility' | 'test';
export type CrudOperation = 'create' | 'read' | 'update' | 'delete';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type AppTenancyMode = 'personal' | 'team' | 'multi_organization';
export type GenerationEffort = 'low' | 'medium' | 'high';

export interface BrowserGenerationAgentConfiguration {
  templateId: string;
  templateVersion: number;
  name: string;
  role: string;
  connector: string;
  model: string;
  effort: GenerationEffort;
}

export interface BrowserGenerationProfile {
  agents: BrowserGenerationAgentConfiguration[];
  updatedAt: string;
}

export interface BrowserGenerationOptions {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    stage: string;
    defaultConfiguration: BrowserGenerationAgentConfiguration;
  }>;
  connectors: Array<{
    id: string;
    name: string;
    vendor: string;
    configured: boolean;
    models: Array<{ id: string; name: string; description: string; preferred: boolean }>;
  }>;
  efforts: Array<{ id: GenerationEffort; name: string; description: string }>;
  defaultProfile: BrowserGenerationProfile;
  maximumAgents: number;
}

export interface AppSpecRole {
  id: string;
  name: string;
  description: string;
}

export interface AppSpecPage {
  id: string;
  name: string;
  path: string;
  purpose: string;
  public: boolean;
  roleIds: string[];
  states: Array<'loading' | 'empty' | 'error' | 'forbidden' | 'ready'>;
  entityIds: string[];
  workflowIds: string[];
  agentIds: string[];
  acceptanceCriterionIds: string[];
}

export interface AppSpecEntity {
  id: string;
  name: string;
  description: string;
  fields: Array<{ id: string; type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'object' | 'array'; required: boolean; description: string }>;
}

export interface AppSpecWorkflow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps: Array<{ id: string; type: 'browser_action' | 'data_read' | 'data_write' | 'agent' | 'decision' | 'human_approval'; description: string }>;
}

export interface AppSpecAgent {
  id: string;
  name: string;
  purpose: string;
  connector: string;
  model: string;
  toolIds: string[];
  maximumIterations: number;
  humanApprovalRequired: boolean;
}

export interface AppAcceptanceCriterion {
  id: string;
  requirementId: string;
  description: string;
  kind: 'journey' | 'policy' | 'data' | 'agent' | 'accessibility';
}

export interface AppStructuredSpecification {
  purpose: string;
  audience: AppTenancyMode;
  roles: AppSpecRole[];
  pages: AppSpecPage[];
  entities: AppSpecEntity[];
  workflows: AppSpecWorkflow[];
  agents: AppSpecAgent[];
  acceptanceCriteria: AppAcceptanceCriterion[];
}

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
  platformOrganizationId: string;
  name: string;
  description: string;
  runtimeProfile: 'browser_data';
  projectId: string;
  specRevision: number;
  generatedFromSpecRevision: number;
  sourceRevision: number;
  schemaRevision: number;
  policyRevision: number;
  connectorRevision: number;
  themeRevision: number;
  tenancyRevision: number;
  tenancyMode: AppTenancyMode;
  agentAccent?: string;
  agentHeadline?: string;
  generationProfile?: BrowserGenerationProfile;
  activeReleaseId?: string;
  previewReleaseId?: string;
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
  structure: AppStructuredSpecification;
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
  requirementIds: string[];
  contentHash: string;
  createdAt: string;
}

export interface RouteDefinition {
  id: string;
  appId: string;
  revision: number;
  path: string;
  specPageId: string;
  pageModuleId: string;
  layoutModuleId?: string;
  public: boolean;
  requiredCapabilities: string[];
  requirementIds: string[];
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
  requirementIds: string[];
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
  requirementIds: string[];
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
  requirementIds: string[];
}

export interface BrowserAgentRecord {
  id: string;
  appId: string;
  revision: number;
  name: string;
  description: string;
  connector: string;
  model: string;
  instructions: string;
  allowedRoles: AppRole[];
  toolIds: string[];
  maximumIterations: number;
  humanApprovalRequired: boolean;
  requirementIds: string[];
}

export interface AppGraphChangeSet {
  summary: string;
  moduleUpserts: Array<Pick<AppModuleRecord, 'id' | 'kind' | 'name' | 'description' | 'source' | 'dependencies' | 'packageImports' | 'requiredCapabilities' | 'requirementIds'>>;
  moduleDeletes: string[];
  routeUpserts: Array<Pick<RouteDefinition, 'id' | 'path' | 'specPageId' | 'pageModuleId' | 'layoutModuleId' | 'public' | 'requiredCapabilities' | 'requirementIds' | 'navigation'>>;
  routeDeletes: string[];
  schemaUpserts: Array<Omit<DataSchemaRecord, 'appId' | 'revision' | 'physicalCollection'>>;
  schemaDeletes: string[];
  policyUpserts: Array<Omit<EntityPolicyRecord, 'appId' | 'revision'>>;
  policyDeletes: string[];
  agentUpserts: Array<Pick<BrowserAgentRecord, 'id' | 'name' | 'description' | 'connector' | 'model' | 'instructions' | 'allowedRoles' | 'toolIds' | 'maximumIterations' | 'humanApprovalRequired' | 'requirementIds'>>;
  agentDeletes: string[];
}

export interface AppBuild {
  id: string;
  appId: string;
  specRevision: number;
  sourceRevision: number;
  themeRevision: number;
  tenancyRevision: number;
  runtimeVersion: number;
  generationProfile?: BrowserGenerationProfile;
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
  acceptance: { total: number; covered: number; requirementIds: string[] };
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface BrowserRelease {
  id: string;
  appId: string;
  specRevision: number;
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
  environment: 'preview' | 'production';
  status: 'preview' | 'active' | 'superseded';
  previewToken?: string;
  generatorVersion: string;
  generationProfile?: BrowserGenerationProfile;
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
  agents: BrowserAgentRecord[];
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
