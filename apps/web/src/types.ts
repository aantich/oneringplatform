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

export type BrowserModuleKind = 'page' | 'layout' | 'component' | 'provider' | 'hook' | 'utility' | 'test';
export type AppTenancyMode = 'personal' | 'team' | 'multi_organization';

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
  contentHash: string;
}

export interface BrowserRoute {
  id: string;
  path: string;
  pageModuleId: string;
  public: boolean;
  requiredCapabilities: string[];
  navigation?: { label: string; order: number };
}

export interface BrowserAppSummary {
  id: string;
  publicKey: string;
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
  activeReleaseId?: string;
  moduleCount: number;
  routeCount: number;
  entityCount: number;
  url: string;
  release?: { id: string; version: string; status: string; createdAt: string };
}

export interface BrowserAppDetail {
  app: BrowserAppSummary;
  modules: BrowserAppModule[];
  routes: BrowserRoute[];
  schemas: Array<{ id: string; entity: string; displayName: string; deploymentMode: string; physicalCollection: string; jsonSchema: Record<string, unknown>; indexes: unknown[] }>;
  policies: Array<{ id: string; entity: string; grants: Record<string, { operations: string[]; readFields: string[]; writeFields: string[]; uiCapabilities: string[] }> }>;
  connectors: Array<{ id: string; connector: string; action: string; description: string; allowedRoles: string[]; rateLimitPerMinute: number; timeoutMs: number }>;
  builds: Array<{ id: string; sourceRevision: number; themeRevision: number; tenancyRevision: number; runtimeVersion: number; themeName: string; status: string; moduleCount: number; routeCount: number; tests: number; checks: ReleaseCheck[]; artifactDigest?: string; createdAt: string }>;
  releases: Array<{ id: string; version: string; status: string; buildId: string; themeRevision: number; tenancyRevision: number; runtimeVersion: number; artifactDigest: string; releaseKey: string; createdAt: string }>;
  bindings: Array<{ id: string; type: string; hostname: string; pathPrefix: string; canonical: boolean; status: string; verificationToken?: string; certificateStatus?: string }>;
  themes: ThemeRevision[];
  tenancy: TenancyRevision;
  tenancyRevisions: TenancyRevision[];
  endTenants: EndTenant[];
  memberships: AppMembership[];
  tenancyMigrations: TenancyMigration[];
  specification: { id: string; appId: string; revision: number; projectId: string; status: 'approved' | 'superseded'; sections: Array<{ id: string; title: string; body: string }>; createdAt: string };
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
