import type { AppTenancyMode, BootstrapData, BrowserAppDetail, BrowserAppSummary, BrowserGenerationAgentConfiguration, BrowserGenerationOptions, BrowserGenerationProfile, BuilderAgent, ConnectorTemplate, ControlPlaneSession, OrganizationConnectorSummary, OrganizationLoginConfiguration, PlatformOrganization, Project, Release, SpecArtifact, ThemeRevision, ThemeStarter } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const activeOrganizationId = typeof window === 'undefined' ? undefined : window.localStorage.getItem('onering.activePlatformOrganizationId');
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(activeOrganizationId ? { 'x-platform-organization-id': activeOrganizationId } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  session: () => request<ControlPlaneSession>('/session'),
  switchOrganization: (organizationId: string) => request<{ ok: true; organizationId: string }>('/session/organization', { method: 'POST', body: JSON.stringify({ organizationId }) }),
  publicLoginConfiguration: (slug: string) => request<OrganizationLoginConfiguration>(`/auth/organizations/${encodeURIComponent(slug)}`),
  startOrganizationLogin: (slug: string, connectorId: string) => request<{ authUrl: string }>(`/auth/organizations/${encodeURIComponent(slug)}/oauth/start`, { method: 'POST', body: JSON.stringify({ connectorId }) }),
  passwordLogin: (slug: string, email: string, password: string) => request<{ ok: true; organizationId: string }>(`/auth/organizations/${encodeURIComponent(slug)}/password`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  connectorTemplates: (organizationId: string) => request<ConnectorTemplate[]>(`/organizations/${organizationId}/connector-templates`),
  organizationConnectors: (organizationId: string) => request<OrganizationConnectorSummary[]>(`/organizations/${organizationId}/connectors`),
  createOrganizationConnector: (organizationId: string, input: {
    name: string; displayName: string; vendorId: 'microsoft' | 'google-api'; clientId: string; clientSecret?: string;
    tenantId?: string; scope?: string; isLoginProvider: boolean; autoCreateUsers: boolean; allowedDomains: string[];
  }) => request<OrganizationConnectorSummary>(`/organizations/${organizationId}/connectors`, { method: 'POST', body: JSON.stringify(input) }),
  setConnectorLoginProvider: (organizationId: string, connectorId: string, input: { enabled: boolean; autoCreateUsers: boolean; allowedDomains: string[] }) =>
    request<OrganizationConnectorSummary>(`/organizations/${organizationId}/connectors/${connectorId}/login-provider`, { method: 'PATCH', body: JSON.stringify(input) }),
  setLocalPasswordEnabled: (organizationId: string, enabled: boolean) => request<{ localPasswordEnabled: boolean }>(`/organizations/${organizationId}/authentication/local-password`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  createLocalUser: (organizationId: string, input: { email: string; displayName: string; password: string; role: PlatformOrganization['role'] }) =>
    request<{ subject: string; email: string; displayName: string; role: PlatformOrganization['role'] }>(`/organizations/${organizationId}/local-users`, { method: 'POST', body: JSON.stringify(input) }),
  createOrganization: (name: string) => request<PlatformOrganization>('/organizations', { method: 'POST', body: JSON.stringify({ name }) }),
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
  browserGenerationOptions: () => request<BrowserGenerationOptions>('/browser-apps/generation-options'),
  reviseBrowserAppSpecification: (appId: string, expectedRevision: number, sections: BrowserAppDetail['specification']['sections'], structure: BrowserAppDetail['specification']['structure']) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/specification`, {
      method: 'PATCH', body: JSON.stringify({ expectedRevision, sections, structure }),
    }),
  generateBrowserApp: (appId: string, instruction: string, generationProfile: BrowserGenerationProfile) =>
    request<{ plan: { accent: string; headline: string; agent: string; workers: Array<BrowserGenerationAgentConfiguration & { agent: string }> }; attempts: number; failures: string[]; detail: BrowserAppDetail }>(`/browser-apps/${appId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ instruction, generationProfile }),
    }),
  buildBrowserApp: (appId: string) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/build`, { method: 'POST' }),
  promoteBrowserAppRelease: (appId: string, releaseId: string) =>
    request<{ detail: BrowserAppDetail }>(`/browser-apps/${appId}/releases/${releaseId}/promote`, { method: 'POST' }),
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
