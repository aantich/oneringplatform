import { expect, test, type APIRequestContext } from '@playwright/test';

type AppDetail = {
  app: {
    id: string; platformOrganizationId: string; specRevision: number; generatedFromSpecRevision: number;
    sourceRevision: number; themeRevision: number; lifecycleStatus: string; activeReleaseId?: string; previewReleaseId?: string;
    generationProfile?: { agents: Array<{ templateId: string; connector: string; model: string; effort: string }> };
  };
  releases: Array<{ id: string; version: string; buildId: string; status: string; environment: 'preview' | 'production'; sourceRevision: number; specRevision: number; themeRevision: number; previewToken?: string }>;
  themes: Array<{ revision: number; name: string; status: string }>;
  specification: { revision: number; sections: Array<{ id: string; title: string; body: string }>; structure: Record<string, any> & { pages: Array<{ name: string; path: string; public: boolean }>; entities: Array<{ id: string }>; agents: Array<{ id: string }> } };
};

const organizationHeader = { 'x-platform-organization-id': 'e2e-product-studio' };

async function appDetail(request: APIRequestContext, appId: string): Promise<AppDetail> {
  const response = await request.get(`/api/browser-apps/${appId}`, { headers: organizationHeader });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<AppDetail>;
}

test('creates a blog from its PRD, exposes generation activity, edits Mongo data, and promotes exact previews', async ({ page, context, request }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What are you building?' })).toBeVisible();
  await expect.poll(async () => (await request.get('/api/browser-apps')).status(), { timeout: 15_000 }).toBe(200);
  page.once('dialog', (dialog) => dialog.accept('E2E Product Studio'));
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('combobox', { name: 'Active organization' })).toHaveValue('e2e-product-studio');
  await expect(page.getByText('What would you like to build?')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Application name').fill('E2E Story Garden');
  await page.getByLabel('Desired outcome').fill('A beautifully designed blog where writers draft, publish, and share thoughtful stories.');
  await expect(page.getByRole('button', { name: /My team/ })).toHaveClass(/selected/);
  await page.getByRole('button', { name: /Start interview/ }).click();
  await expect(page.getByText('Tell us what you want to build')).toBeVisible();
  await expect(page.getByText('LIVE APPLICATION DEFINITION')).toBeVisible();
  await expect(page.getByText(/One useful question at a time/)).toBeVisible();

  const appId = 'e2e-story-garden';
  const draft = await appDetail(request, appId);
  expect(draft.app).toMatchObject({ sourceRevision: 0, lifecycleStatus: 'draft', platformOrganizationId: 'e2e-product-studio' });
  expect(draft.app.activeReleaseId).toBeUndefined();
  expect(draft.releases).toEqual([]);
  expect(draft.themes.find((theme) => theme.revision === 1)?.name).toBe('Midnight Violet');
  expect(draft.specification.structure.pages).toContainEqual(expect.objectContaining({ name: 'Overview', path: '/' }));

  const criterionIds = draft.specification.structure.acceptanceCriteria.map((criterion: { id: string }) => criterion.id);
  const blogStructure = {
    ...draft.specification.structure,
    purpose: 'A beautifully designed blog where writers draft, publish, and share thoughtful stories.',
    personas: [
      { id: 'reader', name: 'Reader', description: 'Discovers and reads thoughtful public stories.', goals: ['Find compelling stories', 'Read without signing in'], painPoints: ['Cluttered reading experiences'], roleIds: ['public'] },
      { id: 'writer', name: 'Writer', description: 'Drafts and publishes stories.', goals: ['Create polished stories', 'Control publication'], painPoints: ['Cumbersome editorial tools'], roleIds: ['editor'] },
    ],
    userStories: [
      { id: 'read-stories', title: 'Read published stories', personaId: 'reader', statement: 'As a reader, I want to discover and read published stories.', priority: 'must', surfaceIds: ['stories', 'story-detail'], workflowIds: [], acceptanceCriterionIds: criterionIds },
      { id: 'publish-story', title: 'Publish a story', personaId: 'writer', statement: 'As a writer, I want to draft and publish a story.', priority: 'must', surfaceIds: ['editorial'], workflowIds: ['editorial-flow'], acceptanceCriterionIds: criterionIds },
    ],
    pages: [
      { id: 'stories', name: 'Stories', path: '/', purpose: 'Discover featured and recently published stories.', public: true, roleIds: ['public', 'viewer', 'editor', 'admin'], states: ['loading', 'empty', 'error', 'ready'], entityIds: ['articles'], workflowIds: [], agentIds: [], acceptanceCriterionIds: criterionIds },
      { id: 'story-detail', name: 'Read story', path: '/stories/:slug', purpose: 'Read one published story in a focused editorial layout.', public: true, roleIds: ['public', 'viewer', 'editor', 'admin'], states: ['loading', 'empty', 'error', 'ready'], entityIds: ['articles'], workflowIds: [], agentIds: [], acceptanceCriterionIds: criterionIds },
      { id: 'editorial', name: 'Editorial workspace', path: '/editorial', purpose: 'Draft, review, publish, and archive stories.', public: false, roleIds: ['editor', 'admin'], states: ['loading', 'empty', 'error', 'forbidden', 'ready'], entityIds: ['articles'], workflowIds: ['editorial-flow'], agentIds: ['writing-assistant'], acceptanceCriterionIds: criterionIds },
    ],
    entities: [{ id: 'articles', name: 'Article', description: 'A draft or published editorial story.', fields: [
      { id: 'title', type: 'string', required: true, description: 'Article title' },
      { id: 'slug', type: 'string', required: true, description: 'Unique URL slug' },
      { id: 'summary', type: 'string', required: true, description: 'Short story summary' },
      { id: 'body', type: 'string', required: true, description: 'Article body' },
      { id: 'category', type: 'string', required: true, description: 'Editorial category' },
      { id: 'status', type: 'enum', required: true, description: 'draft, review, published, or archived' },
      { id: 'featured', type: 'boolean', required: false, description: 'Feature on the home page' },
    ] }],
    workflows: [{ id: 'editorial-flow', name: 'Editorial publishing', description: 'Draft, improve, and publish a story.', trigger: 'A writer starts a new story.', steps: [
      { id: 'draft', type: 'data_write', description: 'Save a private draft.' },
      { id: 'assist', type: 'agent', description: 'Offer bounded writing assistance.' },
      { id: 'publish', type: 'data_write', description: 'Publish after the writer explicitly chooses published status.' },
    ] }],
    agents: [{ id: 'writing-assistant', name: 'Writing assistant', purpose: 'Suggest improvements without publishing or changing data automatically.', connector: 'openai-main', model: 'gpt-5.4-mini', toolIds: [], maximumIterations: 4, humanApprovalRequired: true }],
    designBrief: { tone: 'Editorial, warm, spacious, and typographically expressive.', principles: ['Prioritize reading', 'Make editorial status obvious', 'Keep writing tools calm'], accessibilityTarget: 'AA' },
  };
  const revised = await request.patch(`/api/browser-apps/${appId}/specification`, { headers: organizationHeader, data: { expectedRevision: draft.specification.revision, sections: draft.specification.sections, structure: blogStructure } });
  expect(revised.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: /Continue interview/ }).click();
  await expect(page.getByText('Stories')).toBeVisible();
  await expect(page.getByText('Editorial workspace')).toBeVisible();
  await page.getByRole('button', { name: /Looks good — build my app/ }).click();
  await expect(page.getByText(/Specification v\d+ is confirmed/)).toBeVisible();

  await page.getByText('Advanced build settings').click();
  await expect(page.getByLabel('Implementation lead reasoning effort')).toBeVisible();
  await page.getByLabel('Implementation lead reasoning effort').selectOption('high');
  await page.getByLabel('Build instruction').fill('Build a polished editorial blog from every approved page, workflow, data, policy, and browser-agent contract.');
  await page.getByRole('button', { name: /Build my app/ }).click();

  await expect(page.locator('.build-progress-card')).toBeVisible();
  await expect(page.getByText('Detailed agent and tool activity')).toBeVisible();
  await expect(page.getByText('Model generation is disabled')).toBeVisible();
  await expect(page.getByText('Running preview admission')).toBeVisible();
  await expect(page.getByText('Verified preview is ready')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.build-progress-card.completed')).toBeVisible();
  await expect(page.getByText(/private chain-of-thought and credentials are never exposed/i)).toBeVisible();

  const generated = await appDetail(request, appId);
  expect(generated.app.sourceRevision).toBeGreaterThan(0);
  expect(generated.app.generatedFromSpecRevision).toBe(generated.app.specRevision);
  expect(generated.app.lifecycleStatus).toBe('preview_ready');
  expect(generated.app.activeReleaseId).toBeUndefined();
  expect(generated.app.generationProfile?.agents[0]).toMatchObject({ templateId: 'implementer', effort: 'high' });
  const candidate = generated.releases.find((release) => release.status === 'preview');
  expect(candidate).toBeTruthy();

  await page.getByRole('button', { name: /Review working app/ }).click();
  const embeddedPreview = page.frameLocator(`iframe[title="E2E Story Garden application preview"]`);
  await expect(embeddedPreview.getByRole('heading', { name: /Discover featured and recently published stories/i })).toBeVisible();
  await expect(embeddedPreview.getByRole('combobox', { name: 'Test application role' })).toHaveValue('public');
  const previewPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: /Open preview/ }).click();
  const preview = await previewPromise;
  await expect(preview.getByRole('heading', { name: /Discover featured and recently published stories/i })).toBeVisible();
  await expect(preview.getByRole('combobox', { name: 'Test application role' })).toHaveValue('public');
  await expect(preview.getByRole('link', { name: 'Read story' })).toHaveCount(0);

  await preview.getByRole('combobox', { name: 'Test application role' }).selectOption('editor');
  await preview.getByRole('link', { name: 'Editorial workspace' }).click();
  await expect(preview).toHaveURL(/\/apps\/e2e-story-garden\/editorial/);
  await preview.getByLabel('Article title').fill('The Quiet Architecture of Good Tools');
  await preview.getByLabel('Unique URL slug').fill('quiet-architecture');
  await preview.getByLabel('Short story summary').fill('Why useful software makes complex boundaries feel calm.');
  await preview.getByLabel('Article body').fill('Good tools reveal what matters, protect what must remain private, and give people confidence about what happens next.');
  await preview.getByLabel('Editorial category').fill('Design');
  await preview.getByLabel('draft, review, published, or archived').fill('published');
  await preview.getByLabel('Feature on the home page').check();
  await preview.getByRole('button', { name: 'Save draft' }).click();
  await expect(preview.getByText('The Quiet Architecture of Good Tools')).toBeVisible();

  await preview.getByRole('link', { name: 'Stories' }).click();
  const storyLink = preview.getByRole('link', { name: 'The Quiet Architecture of Good Tools' });
  await expect(storyLink).toBeVisible();
  await storyLink.click();
  await expect(preview).toHaveURL(/\/stories\/quiet-architecture/);
  await expect(preview.getByText(/Good tools reveal what matters/)).toBeVisible();
  await preview.close();

  await page.getByRole('button', { name: /Publish this preview/ }).click();
  await expect(page.getByText(/exact reviewed preview is now the production application/i)).toBeVisible();
  const promoted = await appDetail(request, appId);
  expect(promoted.app).toMatchObject({ activeReleaseId: candidate?.id, lifecycleStatus: 'production' });
  expect(promoted.releases.find((release) => release.status === 'active')?.environment).toBe('production');

  await page.getByRole('button', { name: /^Settings$/ }).click();
  await page.getByText('Visual design system').click();
  await page.locator('.theme-starters').getByRole('button', { name: /Sage Workspace/ }).click();
  await page.getByRole('button', { name: /Validate & add to preview/ }).click();
  await expect(page.getByText(/Production is unchanged until you promote that preview/i)).toBeVisible();
  const themed = await appDetail(request, appId);
  expect(themed.app.activeReleaseId).toBe(candidate?.id);
  const themePreview = themed.releases.find((release) => release.status === 'preview');
  expect(themePreview?.themeRevision).toBeGreaterThan(candidate!.themeRevision);

  await page.locator('.simple-workspace-header').getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /Publish this preview/ }).click();
  const themedProduction = await appDetail(request, appId);
  expect(themedProduction.app.activeReleaseId).toBe(themePreview?.id);
});
