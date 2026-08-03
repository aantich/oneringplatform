import type { AppTenancyMode, BootstrapData, BrowserAppDetail, BrowserAppSummary, BuilderAgent, Project, Release, SpecArtifact, ThemeRevision, ThemeStarter } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  bootstrap: () => request<BootstrapData>('/bootstrap'),
  interview: (projectId: string, content: string) =>
    request<{ reply: string; project: Project }>(`/projects/${projectId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  approvePrd: (projectId: string) =>
    request<Project>(`/projects/${projectId}/approve-prd`, { method: 'POST' }),
  updateArtifact: (projectId: string, artifactId: string, patch: Partial<SpecArtifact>) =>
    request<SpecArtifact>(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  updateAgent: (agentId: string, patch: Partial<BuilderAgent>) =>
    request<BuilderAgent>(`/builder-agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  startRun: (projectId: string) =>
    request(`/projects/${projectId}/runs`, { method: 'POST' }),
  promote: (releaseId: string) =>
    request<Release>(`/releases/${releaseId}/promote`, { method: 'POST' }),
  browserApps: () => request<BrowserAppSummary[]>('/browser-apps'),
  createBrowserApp: (input: { name: string; description: string; mode: AppTenancyMode }) =>
    request<{ detail: BrowserAppDetail }>('/browser-apps', { method: 'POST', body: JSON.stringify(input) }),
  browserApp: (appId: string) => request<BrowserAppDetail>(`/browser-apps/${appId}`),
  reviseBrowserAppSpecification: (appId: string, expectedRevision: number, sections: BrowserAppDetail['specification']['sections']) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/specification`, {
      method: 'PATCH', body: JSON.stringify({ expectedRevision, sections }),
    }),
  generateBrowserApp: (appId: string, instruction: string) =>
    request<{ plan: { accent: string; headline: string; agent: string }; detail: BrowserAppDetail }>(`/browser-apps/${appId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),
  buildBrowserApp: (appId: string) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/build`, { method: 'POST' }),
  previewTenancy: (appId: string, mode: AppTenancyMode) =>
    request<{ fromMode: AppTenancyMode; toMode: AppTenancyMode; totalRecords: number; scopedRecords: number; unscopedPrivateRecords: number; preservesExistingTenantAssignments: boolean; requiresDefaultTenant: boolean }>(`/browser-apps/${appId}/tenancy/preview`, { method: 'POST', body: JSON.stringify({ mode }) }),
  configureTenancy: (appId: string, mode: AppTenancyMode, organizationLabel: string, defaultTenantId?: string) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/tenancy`, {
      method: 'POST', body: JSON.stringify({ mode, organizationLabel, defaultTenantId }),
    }),
  createEndTenant: (appId: string, name: string) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/organizations`, {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  inviteAppMember: (appId: string, input: { email: string; displayName: string; role: 'viewer' | 'editor' | 'admin'; tenantId?: string }) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/memberships`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  updateAppMember: (appId: string, membershipId: string, input: { role?: 'viewer' | 'editor' | 'admin'; status?: 'invited' | 'active' | 'suspended' }) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/memberships/${membershipId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  createBrowserAppBinding: (appId: string, hostname: string, type: 'platform_hostname' | 'custom_hostname') =>
    request<BrowserAppDetail['bindings'][number]>(`/browser-apps/${appId}/bindings`, {
      method: 'POST', body: JSON.stringify({ hostname, type }),
    }),
  verifyBrowserAppBinding: (appId: string, bindingId: string, developmentProof: string) =>
    request<BrowserAppDetail['bindings'][number]>(`/browser-apps/${appId}/bindings/${bindingId}/verify`, {
      method: 'POST', body: JSON.stringify({ developmentProof }),
    }),
  themeStarters: () => request<ThemeStarter[]>('/browser-apps/theme-starters'),
  createTheme: (appId: string, theme: Pick<ThemeRevision, 'name' | 'description' | 'starterId' | 'tokens' | 'componentVariants' | 'customCss'>) =>
    request<ThemeRevision>(`/browser-apps/${appId}/themes`, { method: 'POST', body: JSON.stringify(theme) }),
  previewTheme: (appId: string, theme: Pick<ThemeRevision, 'name' | 'description' | 'starterId' | 'tokens' | 'componentVariants' | 'customCss'>) =>
    request<{ scopedCss: string; accessibility: ThemeRevision['accessibility'] }>(`/browser-apps/${appId}/themes/preview`, { method: 'POST', body: JSON.stringify(theme) }),
  generateTheme: (appId: string, direction: string) =>
    request<{ theme: ThemeRevision; agent: 'oneringai' | 'fallback' }>(`/browser-apps/${appId}/themes/generate`, { method: 'POST', body: JSON.stringify({ direction }) }),
  publishTheme: (appId: string, revision: number) =>
    request<{ theme: ThemeRevision; detail: BrowserAppDetail }>(`/browser-apps/${appId}/themes/${revision}/publish`, { method: 'POST' }),
};
