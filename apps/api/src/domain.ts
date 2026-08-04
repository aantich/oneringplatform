export type ArtifactType =
  | 'story'
  | 'entity'
  | 'screen'
  | 'workflow'
  | 'agent'
  | 'integration'
  | 'test';

export type ArtifactStatus = 'draft' | 'review' | 'approved' | 'implemented';

export interface ArtifactLink {
  targetId: string;
  relation: string;
}

export interface SpecArtifact {
  id: string;
  type: ArtifactType;
  name: string;
  description: string;
  status: ArtifactStatus;
  tags: string[];
  details: Record<string, unknown>;
  links: ArtifactLink[];
  position: { x: number; y: number };
}

export interface PrdSection {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'confirmed';
}

export interface InterviewMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  stage: 'discovery' | 'design' | 'implementation' | 'verification' | 'released';
  readiness: number;
  specVersion: number;
  updatedAt: string;
  prd: PrdSection[];
  interview: InterviewMessage[];
  artifacts: SpecArtifact[];
}

export interface BuilderAgent {
  id: string;
  name: string;
  role: string;
  stage: string;
  connector: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
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

export interface PlatformState {
  projects: Project[];
  agents: BuilderAgent[];
  runs: DevelopmentRun[];
  releases: Release[];
  builderVersion: string;
}
