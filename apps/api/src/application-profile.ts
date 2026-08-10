import type { ApplicationProfile, ApplicationType, AppTenancyMode } from './browser-app.domain.js';

export const applicationTypes: ApplicationType[] = ['browser_data', 'full_stack', 'api_service', 'mobile', 'workflow_automation'];

export function defaultApplicationProfile(
  applicationType: ApplicationType = 'browser_data',
  tenancyMode: AppTenancyMode = 'team',
): ApplicationProfile {
  return {
    applicationType,
    tenancyMode,
    identityMode: tenancyMode === 'personal' ? 'private' : 'public_and_authenticated',
    agenticLevel: 'assistive',
    dataSensitivity: 'standard',
    execution: {
      browser: applicationType === 'browser_data' || applicationType === 'full_stack' || applicationType === 'mobile',
      server: applicationType === 'full_stack' || applicationType === 'api_service' || applicationType === 'workflow_automation',
      backgroundJobs: applicationType === 'workflow_automation',
      schedules: applicationType === 'workflow_automation',
      webhooks: applicationType === 'api_service' || applicationType === 'workflow_automation',
    },
    deploymentTarget: 'managed_platform',
  };
}

export function normalizeApplicationProfile(input: unknown, fallbackMode: AppTenancyMode = 'team'): ApplicationProfile {
  const value = input && typeof input === 'object' ? input as Partial<ApplicationProfile> : {};
  const applicationType = applicationTypes.includes(value.applicationType as ApplicationType)
    ? value.applicationType as ApplicationType
    : 'browser_data';
  const tenancyMode = ['personal', 'team', 'multi_organization'].includes(value.tenancyMode as string)
    ? value.tenancyMode as AppTenancyMode
    : fallbackMode;
  const defaults = defaultApplicationProfile(applicationType, tenancyMode);
  const requestedExecution: Partial<ApplicationProfile['execution']> = value.execution && typeof value.execution === 'object' ? value.execution : {};
  const execution = Object.fromEntries(Object.entries(defaults.execution).map(([key, fallback]) => [
    key,
    typeof requestedExecution[key as keyof ApplicationProfile['execution']] === 'boolean'
      ? requestedExecution[key as keyof ApplicationProfile['execution']]
      : fallback,
  ])) as unknown as ApplicationProfile['execution'];
  if (applicationType === 'browser_data') Object.assign(execution, { browser: true, server: false, backgroundJobs: false, schedules: false, webhooks: false });
  if (applicationType === 'api_service') Object.assign(execution, { server: true, browser: false });
  if (applicationType === 'mobile') execution.browser = true;
  if (applicationType === 'workflow_automation') execution.server = true;
  return {
    ...defaults,
    identityMode: ['private', 'public_and_authenticated', 'organization_sso'].includes(value.identityMode as string)
      ? value.identityMode as ApplicationProfile['identityMode'] : defaults.identityMode,
    agenticLevel: ['none', 'assistive', 'tool_using'].includes(value.agenticLevel as string)
      ? value.agenticLevel as ApplicationProfile['agenticLevel'] : defaults.agenticLevel,
    dataSensitivity: ['standard', 'confidential', 'regulated'].includes(value.dataSensitivity as string)
      ? value.dataSensitivity as ApplicationProfile['dataSensitivity'] : defaults.dataSensitivity,
    execution,
  };
}
