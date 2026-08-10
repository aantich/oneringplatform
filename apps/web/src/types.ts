export type ArtifactType = 'story' | 'entity' | 'screen' | 'workflow' | 'agent' | 'integration' | 'test';
export type ArtifactStatus = 'draft' | 'review' | 'approved' | 'implemented';

export interface SpecArtifact {
  id: string;
  type: ArtifactType;
  name: string;
  description: string;
  status: ArtifactStatus;
  tags: string[];
  details: Record<string, unknown>;
  links: Array<{ targetId: string; relation: string }>;
  position: { x: number; y: number };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  stage: string;
  readiness: number;
  specVersion: number;
  updatedAt: string;
  prd: Array<{ id: string; title: string; body: string; status: 'draft' | 'confirmed' }>;
  interview: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  artifacts: SpecArtifact[];
}

export interface BuilderAgent {
  id: string;
  name: string;
  role: string;
  stage: string;
  connector: string;
  model: string;
  effort: GenerationEffort;
  instructions: string;
  tools: string[];
  plugins: string[];
  enabled: boolean;
  version: number;
  lastEvaluatedScore: number;
}

export interface ConnectorSummary {
  id: string;
  name: string;
  vendor: string;
  kind: 'llm' | 'search' | 'scrape';
  configured: boolean;
  model?: string;
}

export interface RunStep {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  durationMs?: number;
}

export interface DevelopmentRun {
  id: string;
  projectId: string;
  branch: string;
  workspace: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  startedAt: string;
  completedAt?: string;
  steps: RunStep[];
}

export interface Release {
  id: string;
  projectId: string;
  version: string;
  environment: 'preview' | 'production';
  status: 'ready' | 'active' | 'superseded';
  artifactDigest: string;
  sourceCommit: string;
  createdAt: string;
  url: string;
  evidence: { tests: number; coverage: number; policyChecks: number };
}

export interface BootstrapData {
  projects: Project[];
  agents: BuilderAgent[];
  connectors: ConnectorSummary[];
  runs: DevelopmentRun[];
  releases: Release[];
  builderVersion: string;
  aiAvailable: boolean;
}

export type ControlPlanePermission =
  | 'platform.builder_system.manage' | 'organization.create' | 'organization.read' | 'organization.members.manage'
  | 'app.read' | 'app.create' | 'app.write' | 'app.admin' | 'release.create' | 'release.promote'
  | 'secrets.manage' | 'billing.read';

export interface OrganizationConnectorSummary {
  id: string;
  name: string;
  displayName: string;
  vendorId: 'microsoft' | 'google-api' | string;
  authTemplateId: string;
  isLoginProvider: boolean;
  loginProviderConfig: { autoCreateUsers: boolean; allowedDomains: string[] };
  configured: boolean;
  updatedAt: string;
}

export interface ConnectorTemplate {
  vendorId: 'microsoft' | 'google-api';
  name: string;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  scopes: string[];
  scopeDescriptions: Record<string, string>;
  credentialsSetupURL?: string;
  redirectUri: string;
}

export interface OrganizationLoginConfiguration {
  organization: { id: string; slug: string; name: string };
  providers: Array<{ id: string; name: string; vendorId: string }>;
  localPasswordEnabled: boolean;
}

export interface PlatformOrganization {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  role: 'owner' | 'admin' | 'builder' | 'release_manager' | 'secrets_admin' | 'billing' | 'viewer';
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneSession {
  principal: {
    subject: string;
    email?: string;
    displayName: string;
    platformRoles: string[];
    organizationRole?: PlatformOrganization['role'];
    permissions: ControlPlanePermission[];
    localDevelopment: boolean;
  };
  activeOrganization?: PlatformOrganization;
  organizations: PlatformOrganization[];
}

export type BrowserModuleKind = 'page' | 'layout' | 'component' | 'provider' | 'hook' | 'utility' | 'test';
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
  agents: Array<{ id: string; name: string; role: string; stage: string; defaultConfiguration: BrowserGenerationAgentConfiguration }>;
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

export interface BrowserAppModule {
  id: string;
  appId: string;
  revision: number;
  kind: BrowserModuleKind;
  name: string;
  description: string;
  source: string;
  dependencies: string[];
  packageImports: string[];
  requirementIds: string[];
  contentHash: string;
}

export interface BrowserRoute {
  id: string;
  path: string;
  specPageId: string;
  pageModuleId: string;
  public: boolean;
  requiredCapabilities: string[];
  requirementIds: string[];
  navigation?: { label: string; order: number };
}

export type ApplicationType = 'browser_data' | 'full_stack' | 'api_service' | 'mobile' | 'workflow_automation';
export interface ApplicationProfile {
  applicationType: ApplicationType;
  tenancyMode: AppTenancyMode;
  identityMode: 'private' | 'public_and_authenticated' | 'organization_sso';
  agenticLevel: 'none' | 'assistive' | 'tool_using';
  dataSensitivity: 'standard' | 'confidential' | 'regulated';
  execution: { browser: boolean; server: boolean; backgroundJobs: boolean; schedules: boolean; webhooks: boolean };
  deploymentTarget: 'managed_platform';
}

export interface ApplicationGeneratorManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  supportedApplicationTypes: ApplicationType[];
  available: boolean;
  capabilities: string[];
}

export interface ApplicationDiscoverySession {
  id: string;
  appId: string;
  status: 'idle' | 'running' | 'failed';
  progress: number;
  phase: string;
  baseSpecRevision: number;
  currentSpecRevision: number;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  events: Array<{ id: string; sequence: number; type: 'status' | 'thinking' | 'tool' | 'specification' | 'result' | 'warning' | 'error'; actor: string; title: string; detail?: string; durationMs?: number; metadata?: Record<string, string | number | boolean>; createdAt: string }>;
  draft?: {
    baseSpecRevision: number;
    sections: BrowserAppDetail['specification']['sections'];
    structure: AppStructuredSpecification;
    changes: Array<{ tool: string; targetId: string; summary: string }>;
    updatedAt: string;
  };
  coverage: { score: number; covered: string[]; missing: string[]; contradictions: string[] };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserAppSummary {
  id: string;
  publicKey: string;
  platformOrganizationId: string;
  name: string;
  description: string;
  runtimeProfile: 'browser_data' | 'specification_only';
  profile: ApplicationProfile;
  generatorId?: string;
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
  activeReleaseId?: string;
  previewReleaseId?: string;
  generationProfile?: BrowserGenerationProfile;
  lifecycleStatus: 'draft' | 'specifying' | 'generating' | 'preview_ready' | 'generation_failed' | 'production';
  specificationApprovalStatus: 'draft' | 'approved';
  moduleCount: number;
  routeCount: number;
  entityCount: number;
  url: string;
  release?: { id: string; version: string; status: string; createdAt: string };
}

export interface BrowserGenerationEvent {
  id: string;
  sequence: number;
  type: 'status' | 'thinking' | 'tool' | 'model' | 'result' | 'warning' | 'error';
  actor: string;
  title: string;
  detail?: string;
  createdAt: string;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface BrowserGenerationJob {
  id: string;
  appId: string;
  specRevision: number;
  instruction: string;
  generationProfile: BrowserGenerationProfile;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  progress: number;
  workers: Array<{
    templateId: string; name: string; role: string; connector: string; model: string; effort: GenerationEffort;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt?: string; completedAt?: string; durationMs?: number; error?: string;
    metrics?: { inputTokens: number; outputTokens: number; reasoningTokens: number; toolCalls: number };
  }>;
  events: BrowserGenerationEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: { sourceRevision: number; previewReleaseId: string; previewVersion: string; buildId: string };
}

export interface BrowserAppDetail {
  app: BrowserAppSummary;
  modules: BrowserAppModule[];
  routes: BrowserRoute[];
  schemas: Array<{ id: string; entity: string; displayName: string; deploymentMode: string; physicalCollection: string; jsonSchema: Record<string, unknown>; indexes: unknown[]; requirementIds: string[] }>;
  policies: Array<{ id: string; entity: string; grants: Record<string, { operations: string[]; readFields: string[]; writeFields: string[]; uiCapabilities: string[] }>; requirementIds: string[] }>;
  connectors: Array<{ id: string; connector: string; action: string; description: string; allowedRoles: string[]; rateLimitPerMinute: number; timeoutMs: number; requirementIds: string[] }>;
  agents: Array<{ id: string; name: string; description: string; connector: string; model: string; instructions: string; allowedRoles: string[]; toolIds: string[]; maximumIterations: number; humanApprovalRequired: boolean; requirementIds: string[] }>;
  builds: Array<{ id: string; specRevision: number; sourceRevision: number; themeRevision: number; tenancyRevision: number; runtimeVersion: number; generationProfile?: BrowserGenerationProfile; themeName: string; status: string; moduleCount: number; routeCount: number; tests: number; checks: ReleaseCheck[]; acceptance: { total: number; covered: number; requirementIds: string[] }; artifactDigest?: string; createdAt: string }>;
  releases: Array<{ id: string; version: string; environment: 'preview' | 'production'; status: 'preview' | 'active' | 'superseded'; buildId: string; specRevision: number; sourceRevision: number; themeRevision: number; tenancyRevision: number; runtimeVersion: number; generationProfile?: BrowserGenerationProfile; artifactDigest: string; releaseKey: string; previewToken?: string; generatorVersion: string; createdAt: string }>;
  bindings: Array<{ id: string; type: string; hostname: string; pathPrefix: string; canonical: boolean; status: string; verificationToken?: string; certificateStatus?: string }>;
  themes: ThemeRevision[];
  tenancy: TenancyRevision;
  tenancyRevisions: TenancyRevision[];
  endTenants: EndTenant[];
  memberships: AppMembership[];
  tenancyMigrations: TenancyMigration[];
  specification: { id: string; appId: string; revision: number; projectId: string; status: 'approved' | 'superseded'; sections: Array<{ id: string; title: string; body: string }>; structure: AppStructuredSpecification; createdAt: string };
}

export interface AppStructuredSpecification {
  purpose: string;
  audience: AppTenancyMode;
  personas: Array<{ id: string; name: string; description: string; goals: string[]; painPoints: string[]; roleIds: string[] }>;
  userStories: Array<{ id: string; title: string; personaId?: string; statement: string; priority: 'must' | 'should' | 'could'; surfaceIds: string[]; workflowIds: string[]; acceptanceCriterionIds: string[] }>;
  roles: Array<{ id: string; name: string; description: string }>;
  pages: Array<{ id: string; name: string; path: string; purpose: string; public: boolean; roleIds: string[]; states: Array<'loading' | 'empty' | 'error' | 'forbidden' | 'ready'>; entityIds: string[]; workflowIds: string[]; agentIds: string[]; acceptanceCriterionIds: string[] }>;
  entities: Array<{ id: string; name: string; description: string; fields: Array<{ id: string; type: string; required: boolean; description: string }> }>;
  workflows: Array<{ id: string; name: string; description: string; trigger: string; steps: Array<{ id: string; type: string; description: string }> }>;
  agents: Array<{ id: string; name: string; purpose: string; connector: string; model: string; toolIds: string[]; maximumIterations: number; humanApprovalRequired: boolean }>;
  integrations: Array<{ id: string; name: string; purpose: string; connector?: string; operations: string[]; failureBehavior: string; dataClassification: 'standard' | 'confidential' | 'regulated' }>;
  decisions: Array<{ id: string; title: string; decision: string; rationale: string; status: 'proposed' | 'confirmed' | 'rejected'; sourceMessageIds: string[] }>;
  qualityAttributes: Array<{ id: string; category: 'accessibility' | 'performance' | 'reliability' | 'security' | 'privacy' | 'operability'; requirement: string; measure: string }>;
  designBrief: { tone: string; principles: string[]; accessibilityTarget: 'AA' | 'AAA' };
  acceptanceCriteria: Array<{ id: string; requirementId: string; description: string; kind: 'journey' | 'policy' | 'data' | 'agent' | 'accessibility' }>;
}

export interface ReleaseCheck { id: string; label: string; status: 'passed' | 'failed'; detail: string; durationMs: number }
export interface TenancyMigration { id: string; fromMode: AppTenancyMode; toMode: AppTenancyMode; preservedScopedRecords: number; assignedUnscopedRecords: number; status: 'completed' | 'rolled_back'; createdAt: string }

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
  roles: Array<'viewer' | 'editor' | 'admin'>;
  status: 'invited' | 'active' | 'suspended';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeTokens {
  colors: { background: string; surface: string; surfaceElevated: string; text: string; textMuted: string; primary: string; primaryContrast: string; accent: string; success: string; danger: string; border: string };
  typography: { fontFamily: 'inter' | 'manrope' | 'system' | 'serif'; headingStyle: 'compact' | 'editorial' | 'balanced'; baseSize: 14 | 15 | 16 | 17 | 18 };
  shape: { radius: 'sharp' | 'soft' | 'rounded'; borderWidth: 0 | 1 | 2 };
  density: 'compact' | 'comfortable' | 'spacious';
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
  componentVariants: { navigation: 'solid' | 'glass' | 'minimal'; cards: 'outlined' | 'soft' | 'elevated'; buttons: 'solid' | 'gradient' | 'outline' };
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
