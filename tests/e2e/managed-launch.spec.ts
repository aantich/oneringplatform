import { expect, test, type APIRequestContext } from '@playwright/test';

type AppDetail = {
  app: { id: string; platformOrganizationId: string; specRevision: number; generatedFromSpecRevision: number; sourceRevision: number; themeRevision: number; activeReleaseId: string; previewReleaseId?: string; generationProfile?: { agents: Array<{ templateId: string; connector: string; model: string; effort: string }> } };
  releases: Array<{ id: string; status: string; environment: 'preview' | 'production'; sourceRevision: number; specRevision: number; themeRevision: number; previewToken?: string; generationProfile?: { agents: Array<{ templateId: string; connector: string; model: string; effort: string }> } }>;
  themes: Array<{ revision: number; name: string; status: string }>;
};

async function appDetail(request: APIRequestContext, appId: string): Promise<AppDetail> {
  const response = await request.get(`/api/browser-apps/${appId}`, {
    headers: { 'x-platform-organization-id': 'e2e-product-studio' },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<AppDetail>;
}

test('manages requirements, generation, preview, tenancy, publication, and rollback', async ({ page, context, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await expect.poll(async () => (await request.get('/api/browser-apps')).status(), { timeout: 15_000 }).toBe(200);
  page.once('dialog', (dialog) => dialog.accept('E2E Product Studio'));
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('combobox', { name: 'Active organization' })).toHaveValue('e2e-product-studio');
  await page.getByRole('button', { name: /Browser Apps/ }).click();
  await expect(page.getByText(/Create the first app in this Mongo-backed workspace/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /New app/ }).click();
  await page.getByLabel('New app name').fill('E2E Launch Workspace');
  await page.getByLabel('New app description').fill('Validates the complete managed browser application launch journey.');
  await page.getByLabel('New app audience').selectOption('multi_organization');
  await page.getByRole('button', { name: /Create & publish/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Launch Workspace' })).toBeVisible();
  await expect(page.getByText(/created and published with an isolated application graph/)).toBeVisible();

  const appId = 'e2e-launch-workspace';
  const initial = await appDetail(request, appId);
  expect(initial.app.themeRevision).toBe(1);
  expect(initial.app.platformOrganizationId).toBe('e2e-product-studio');

  await page.getByRole('button', { name: /Living requirements/ }).click();
  const firstRequirement = page.locator('.requirements-editor textarea').first();
  await firstRequirement.fill('Launch teams coordinate secure work with an explicit, testable release journey.');
  await page.getByRole('button', { name: /Save specification/ }).click();
  await expect(page.getByText(/Living specification revision .* authoritative/)).toBeVisible();

  await expect(page.locator('.generation-worker')).toHaveCount(2);
  await page.getByLabel('Implementation lead reasoning effort').selectOption('high');
  await page.getByRole('button', { name: 'Add specialist' }).click();
  await expect(page.locator('.generation-worker')).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Domain architect' }).click();
  await expect(page.locator('.generation-worker')).toHaveCount(2);
  await page.locator('.agent-generation-form input').fill('Strengthen the launch hierarchy without changing policy or tenancy contracts.');
  await page.getByRole('button', { name: /Generate preview/ }).click();
  await expect(page.getByText(/Safe fallback prepared source revision .* for preview/)).toBeVisible();
  const generated = await appDetail(request, appId);
  expect(generated.app.sourceRevision).toBeGreaterThan(initial.app.sourceRevision);
  expect(generated.app.generatedFromSpecRevision).toBe(generated.app.specRevision);
  expect(generated.app.generationProfile?.agents).toHaveLength(2);
  expect(generated.app.generationProfile?.agents[0]).toMatchObject({ templateId: 'implementer', effort: 'high' });
  expect(generated.app.activeReleaseId).toBe(initial.app.activeReleaseId);
  const candidate = generated.releases.find((release) => release.status === 'preview');
  expect(candidate?.environment).toBe('preview');
  expect(candidate?.generationProfile).toEqual(generated.app.generationProfile);

  const previewPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: /Review preview/ }).click();
  const preview = await previewPromise;
  await expect(preview.locator('.hero-card h1')).toContainText(/progress visible/i);
  await preview.getByRole('link', { name: 'Architecture' }).click();
  await expect(preview).toHaveURL(/\/apps\/e2e-launch-workspace\/about/);
  await expect(preview.getByRole('heading', { name: 'Code is a graph, not a filesystem.' })).toBeVisible();
  await preview.close();

  await page.getByRole('button', { name: /Promote verified preview/ }).click();
  await expect(page.getByText(/exact verified preview artifact was promoted without rebuilding/)).toBeVisible();
  const promoted = await appDetail(request, appId);
  expect(promoted.app.activeReleaseId).toBe(candidate?.id);
  expect(promoted.releases.find((release) => release.status === 'active')?.environment).toBe('production');

  await page.getByRole('button', { name: /Users & tenancy/ }).click();
  await page.getByPlaceholder('New organization name').fill('Launch Customer');
  await page.getByRole('button', { name: /Add organization/ }).click();
  await expect(page.locator('.tenant-list article').filter({ hasText: 'Launch Customer' })).toBeVisible();
  const membershipForm = page.locator('.membership-form');
  await membershipForm.getByPlaceholder('Full name').fill('Launch Reviewer');
  await membershipForm.getByPlaceholder('name@company.com').fill('reviewer@launch.example');
  await membershipForm.locator('select').last().selectOption('editor');
  await membershipForm.getByRole('button', { name: /Invite member/ }).click();
  await expect(page.getByText('reviewer@launch.example')).toBeVisible();

  await page.getByRole('button', { name: /Visual design/ }).click();
  await page.locator('.theme-starters').getByRole('button', { name: /Paper Studio/ }).click();
  await page.getByRole('button', { name: /Validate & publish theme/ }).click();
  await expect(page.getByText(/Theme Paper Studio is published in release/)).toBeVisible();
  const published = await appDetail(request, appId);
  expect(published.app.themeRevision).toBeGreaterThan(initial.app.themeRevision);
  expect(published.app.activeReleaseId).not.toBe(initial.app.activeReleaseId);

  // Selecting the original immutable theme from history and publishing it
  // creates a new release with the prior visual contract: an auditable rollback.
  await page.locator('.theme-history').getByRole('button', { name: /Midnight Violet/ }).click();
  await page.getByRole('button', { name: /Validate & publish theme/ }).click();
  await expect(page.getByText(/Theme Midnight Violet is published in release/)).toBeVisible();
  const rolledBack = await appDetail(request, appId);
  expect(rolledBack.app.activeReleaseId).not.toBe(published.app.activeReleaseId);
  expect(rolledBack.themes.find((theme) => theme.revision === rolledBack.app.themeRevision)?.name).toBe('Midnight Violet');
  expect(rolledBack.releases.find((release) => release.status === 'active')?.themeRevision).toBe(rolledBack.app.themeRevision);
});
