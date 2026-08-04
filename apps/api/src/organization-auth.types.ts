import type { ConnectorConfig, StoredConnectorConfig } from '@everworker/oneringai';
import type { OrganizationRole } from './control-plane-auth.guard.js';

export type LoginProviderConfig = {
  autoCreateUsers: boolean;
  allowedDomains: string[];
};

export type OrganizationConnectorDocument = {
  id: string;
  platformOrganizationId: string;
  name: string;
  config: ConnectorConfig;
  version: number;
  createdAt: number;
  updatedAt: number;
  templateCredentials?: Record<string, string>;
  vendorId?: string;
  authTemplateId?: string;
  isLoginProvider: boolean;
  loginProviderConfig: LoginProviderConfig;
};

export type OrganizationConnectorSummary = {
  id: string;
  name: string;
  displayName: string;
  vendorId: string;
  authTemplateId: string;
  isLoginProvider: boolean;
  loginProviderConfig: LoginProviderConfig;
  configured: boolean;
  updatedAt: string;
};

export type PlatformPrincipalDocument = {
  subject: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
};

export type ExternalIdentityDocument = {
  id: string;
  subject: string;
  connectorId: string;
  platformOrganizationId: string;
  providerSubject: string;
  providerEmail: string;
  providerName?: string;
  createdAt: string;
  lastLoginAt: string;
};

export type LocalCredentialDocument = {
  id: string;
  platformOrganizationId: string;
  subject: string;
  emailNormalized: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil?: Date;
  createdAt: string;
  updatedAt: string;
};

export type OAuthLoginStateDocument = {
  state: string;
  platformOrganizationId: string;
  organizationSlug: string;
  connectorId: string;
  attemptSubject: string;
  accountId: string;
  codeVerifier: string;
  expectedState: string;
  createdAt: Date;
  expiresAt: Date;
};

export type ProviderProfile = {
  subject: string;
  email: string;
  displayName?: string;
};

export type CreateOrganizationConnectorInput = {
  name: string;
  displayName?: string;
  vendorId: 'microsoft' | 'google-api';
  clientId: string;
  clientSecret?: string;
  tenantId?: string;
  scope?: string;
  isLoginProvider?: boolean;
  autoCreateUsers?: boolean;
  allowedDomains?: string[];
};

export type CreateLocalUserInput = {
  email: string;
  displayName: string;
  password: string;
  role: OrganizationRole;
};

export function connectorDocumentToStored(document: OrganizationConnectorDocument): StoredConnectorConfig {
  return {
    config: document.config,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...(document.templateCredentials ? { templateCredentials: document.templateCredentials } : {}),
    ...(document.vendorId ? { vendorId: document.vendorId } : {}),
    ...(document.authTemplateId ? { authTemplateId: document.authTemplateId } : {}),
  };
}
