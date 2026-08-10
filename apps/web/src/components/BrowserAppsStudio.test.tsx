import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { BrowserAppDetail, BrowserAppSummary, BrowserGenerationAgentConfiguration, BrowserGenerationJob, BrowserGenerationOptions, BrowserGenerationProfile } from '../types';
import { BrowserAppsStudio } from './BrowserAppsStudio';

const configuration: BrowserGenerationAgentConfiguration = {
  templateId: 'implementer', templateVersion: 1, name: 'Implementation lead', role: 'Build the app', connector: 'openai-main', model: 'gpt-test', effort: 'high',
};

const profile: BrowserGenerationProfile = {
  agents: [configuration],
  updatedAt: '2026-08-04T12:00:00.000Z',
};

const summary = {
  id: 'story-studio', publicKey: 'story-studio', platformOrganizationId: 'org', name: 'Story Studio',
  description: 'A thoughtful publication for independent writers.', runtimeProfile: 'browser_data', projectId: 'story-studio',
  profile: { applicationType: 'browser_data', tenancyMode: 'team', identityMode: 'public_and_authenticated', agenticLevel: 'assistive', dataSensitivity: 'standard', deploymentTarget: 'managed_platform', execution: { browser: true, server: false, backgroundJobs: false, schedules: false, webhooks: false } },
  generatorId: 'browser-data', specificationApprovalStatus: 'approved',
  specRevision: 1, generatedFromSpecRevision: 1, sourceRevision: 1, schemaRevision: 1, policyRevision: 1,
  connectorRevision: 1, themeRevision: 1, tenancyRevision: 1, tenancyMode: 'team', lifecycleStatus: 'preview_ready',
  moduleCount: 1, routeCount: 1, entityCount: 1, url: '/apps/story-studio/', generationProfile: profile,
} satisfies BrowserAppSummary;

const detail = {
  app: summary,
  modules: [], routes: [], schemas: [], policies: [], connectors: [], agents: [], builds: [], releases: [], bindings: [], themes: [],
  tenancy: { id: 'tenancy', appId: summary.id, revision: 1, mode: 'team', organizationLabel: 'Organization', allowMultipleMemberships: false, status: 'published', createdBy: 'system', createdAt: profile.updatedAt },
  tenancyRevisions: [], endTenants: [], memberships: [], tenancyMigrations: [],
  specification: {
    id: 'spec', appId: summary.id, revision: 1, projectId: summary.id, status: 'approved', createdAt: profile.updatedAt,
    sections: [{ id: 'purpose', title: 'Purpose', body: summary.description }],
    structure: {
      purpose: summary.description, audience: 'team', roles: [],
      pages: [{ id: 'stories', name: 'Stories', path: '/', purpose: 'Read stories', public: true, roleIds: ['public'], states: ['ready'], entityIds: ['articles'], workflowIds: [], agentIds: [], acceptanceCriterionIds: ['accept-purpose'] }],
      entities: [{ id: 'articles', name: 'Article', description: 'A story', fields: [{ id: 'title', type: 'string', required: true, description: 'Title' }] }],
      workflows: [], agents: [], acceptanceCriteria: [{ id: 'accept-purpose', requirementId: 'purpose', description: 'Readers can read stories.', kind: 'journey' }],
    },
  },
} as unknown as BrowserAppDetail;

const options = {
  agents: [{ id: 'implementer', name: 'Implementation lead', role: 'Build the app', stage: 'implementation', defaultConfiguration: configuration }],
  connectors: [{ id: 'openai-main', name: 'OpenAI', vendor: 'OpenAI', configured: true, models: [{ id: 'gpt-test', name: 'GPT Test', description: 'Test model', preferred: true }] }],
  efforts: [{ id: 'high', name: 'High', description: 'Deep reasoning' }], defaultProfile: profile, maximumAgents: 3,
} satisfies BrowserGenerationOptions;

const completedJob = {
  id: 'job-1', appId: summary.id, specRevision: 1, instruction: 'Build the publication', generationProfile: profile,
  status: 'completed', phase: 'preview_ready', progress: 100,
  workers: [{ ...configuration, status: 'completed', metrics: { inputTokens: 150, outputTokens: 80, reasoningTokens: 80, toolCalls: 1 } }],
  events: [
    { id: 'event-1', sequence: 1, type: 'thinking', actor: 'Implementation lead', title: 'Reasoning over the approved specification', detail: 'Analyzing requirements and page contracts.', createdAt: profile.updatedAt },
    { id: 'event-2', sequence: 2, type: 'tool', actor: 'Implementation lead', title: 'Running schema-inspector', detail: 'The specialist requested an allowlisted tool.', createdAt: profile.updatedAt, durationMs: 420 },
    { id: 'event-3', sequence: 3, type: 'result', actor: 'Release pipeline', title: 'Verified preview is ready', detail: 'Production is unchanged.', createdAt: profile.updatedAt },
  ],
  createdAt: profile.updatedAt, updatedAt: profile.updatedAt, completedAt: profile.updatedAt,
  result: { sourceRevision: 1, previewReleaseId: 'preview-1', previewVersion: '0.1.1.1', buildId: 'build-1' },
} satisfies BrowserGenerationJob;

const runningJob: BrowserGenerationJob = {
  ...completedJob, status: 'running', phase: 'agent:implementer', progress: 42, completedAt: undefined, result: undefined,
  workers: [{ ...configuration, status: 'running' }], events: completedJob.events.slice(0, 2),
};

describe('BrowserAppsStudio generation feedback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the main flow simple while preserving live definition and detailed build feedback', async () => {
    vi.spyOn(api, 'browserApps').mockResolvedValue([summary]);
    vi.spyOn(api, 'browserGenerationOptions').mockResolvedValue(options);
    vi.spyOn(api, 'applicationGenerators').mockResolvedValue([{ id: 'browser-data', name: 'Browser-native Mongo application', version: '1', description: 'Browser generator', supportedApplicationTypes: ['browser_data'], available: true, capabilities: ['browser-ui'] }]);
    vi.spyOn(api, 'applicationDiscovery').mockResolvedValue({ id: 'discovery', appId: summary.id, status: 'idle', progress: 0, phase: 'awaiting-user', baseSpecRevision: 1, currentSpecRevision: 1, messages: [], events: [], coverage: { score: 50, covered: [], missing: [], contradictions: [] }, createdAt: profile.updatedAt, updatedAt: profile.updatedAt });
    const generatingDetail = { ...detail, app: { ...detail.app, lifecycleStatus: 'generating' as const } };
    const browserApp = vi.spyOn(api, 'browserApp').mockResolvedValueOnce(generatingDetail).mockResolvedValue(detail);
    vi.spyOn(api, 'latestBrowserGenerationJob').mockResolvedValue(runningJob);
    vi.spyOn(api, 'browserGenerationJob').mockResolvedValue(completedJob);

    render(<BrowserAppsStudio />);

    expect(await screen.findByRole('heading', { name: 'What are you building?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open application' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Define$/ }));
    expect(await screen.findByText('Tell us what you want to build')).toBeInTheDocument();
    expect(screen.getByText('LIVE APPLICATION DEFINITION')).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Build$/ }));
    expect(await screen.findByText('Detailed agent and tool activity')).toBeInTheDocument();
    expect(screen.getByText('Reasoning over the approved specification')).toBeInTheDocument();
    expect(screen.getByText('Running schema-inspector')).toBeInTheDocument();
    expect(await screen.findByText('Verified preview is ready')).toBeInTheDocument();
    expect(await screen.findByText(/230 tokens · 80 reasoning · 1 tools/)).toBeInTheDocument();
    expect(screen.getByText(/private chain-of-thought and credentials are never exposed/i)).toBeInTheDocument();
    await waitFor(() => expect(browserApp).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /review working app/i })).toBeEnabled();
  });
});
