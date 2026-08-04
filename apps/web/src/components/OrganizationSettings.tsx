import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, KeyRound, Link2, Plus, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { ConnectorTemplate, OrganizationConnectorSummary, PlatformOrganization } from '../types';

export function OrganizationSettings({ organization, canManageMembers }: { organization: PlatformOrganization; canManageMembers: boolean }) {
  const [connectors, setConnectors] = useState<OrganizationConnectorSummary[]>([]);
  const [templates, setTemplates] = useState<ConnectorTemplate[]>([]);
  const [localEnabled, setLocalEnabled] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [vendorId, setVendorId] = useState<'microsoft' | 'google-api'>('microsoft');
  const [name, setName] = useState('microsoft-login');
  const [displayName, setDisplayName] = useState('Microsoft');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [scope, setScope] = useState('');
  const [domains, setDomains] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selectedTemplate = useMemo(() => templates.find((template) => template.vendorId === vendorId), [templates, vendorId]);

  const refresh = useCallback(async () => {
    const [nextConnectors, nextTemplates, login] = await Promise.all([
      api.organizationConnectors(organization.id),
      api.connectorTemplates(organization.id),
      api.publicLoginConfiguration(organization.slug),
    ]);
    setConnectors(nextConnectors);
    setTemplates(nextTemplates);
    setLocalEnabled(login.localPasswordEnabled);
  }, [organization.id, organization.slug]);

  useEffect(() => { void refresh().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Unable to load settings')); }, [refresh]);

  const domainList = () => domains.split(',').map((domain) => domain.trim()).filter(Boolean);
  const createConnector = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api.createOrganizationConnector(organization.id, {
        name, displayName, vendorId, clientId, clientSecret: clientSecret || undefined,
        tenantId: vendorId === 'microsoft' ? tenantId : undefined,
        scope: scope || undefined,
        isLoginProvider: true, autoCreateUsers: true, allowedDomains: domainList(),
      });
      setShowCreate(false); setClientId(''); setClientSecret(''); setTenantId(''); setScope('');
      setMessage('Connector saved and enabled as a login provider.'); await refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to save connector'); }
    finally { setBusy(false); }
  };

  const toggleProvider = async (connector: OrganizationConnectorSummary) => {
    setBusy(true); setMessage('');
    try {
      await api.setConnectorLoginProvider(organization.id, connector.id, {
        enabled: !connector.isLoginProvider,
        autoCreateUsers: connector.loginProviderConfig.autoCreateUsers,
        allowedDomains: connector.loginProviderConfig.allowedDomains,
      });
      await refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to update connector'); }
    finally { setBusy(false); }
  };

  const toggleLocal = async () => {
    setBusy(true); setMessage('');
    try { const result = await api.setLocalPasswordEnabled(organization.id, !localEnabled); setLocalEnabled(result.localPasswordEnabled); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to update local login'); }
    finally { setBusy(false); }
  };

  const createTestUser = async () => {
    const email = window.prompt('Test user email'); if (!email) return;
    const displayName = window.prompt('Display name', email.split('@')[0]); if (!displayName) return;
    const password = window.prompt('Temporary password (at least 10 characters)'); if (!password) return;
    setBusy(true);
    try { await api.createLocalUser(organization.id, { email, displayName, password, role: 'builder' }); setMessage(`Local test user ${email} is ready.`); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to create test user'); }
    finally { setBusy(false); }
  };

  return <div className="organization-settings"><section className="settings-hero"><div><span className="eyebrow">IDENTITY & CONNECTORS</span><h2>Organization access</h2><p>OneRingAI connectors remain the single source of truth for OAuth configuration. A connector can also authenticate members of this organization.</p></div><a href={`/login/${organization.slug}`} target="_blank" rel="noreferrer"><Link2 size={15} /> Open login page</a></section>{message && <div className="settings-message">{message}</div>}<section className="settings-panel"><div className="settings-heading"><div><h3>Login providers</h3><p>Google and Microsoft OAuth connectors use authorization code + PKCE and store secrets encrypted in MongoDB.</p></div><button className="primary-button" onClick={() => setShowCreate((value) => !value)}><Plus size={15} /> Add connector</button></div>{showCreate && <form className="connector-form" onSubmit={createConnector}><label>Provider<select value={vendorId} onChange={(event) => { const value = event.target.value as 'microsoft' | 'google-api'; setVendorId(value); setName(value === 'microsoft' ? 'microsoft-login' : 'google-login'); setDisplayName(value === 'microsoft' ? 'Microsoft' : 'Google'); setScope(''); }}><option value="microsoft">Microsoft</option><option value="google-api">Google</option></select></label><label>Connector name<input value={name} onChange={(event) => setName(event.target.value)} pattern="[a-z0-9][a-z0-9-]+" required /></label><label>Button label<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} required /></label><label>Client secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /><small>Encrypted at rest. Leave empty only for public PKCE clients.</small></label>{vendorId === 'microsoft' && <label>Microsoft tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="tenant UUID or organizations" required /></label>}<label className="connector-form--wide">OAuth scopes<input value={scope} onChange={(event) => setScope(event.target.value)} placeholder={vendorId === 'microsoft' ? 'openid profile email User.Read offline_access' : 'openid email profile'} /><small>Leave empty for identity-only defaults, or add the Google/Microsoft scopes this connector needs for tools.</small></label><label className="connector-form--wide">Allowed email domains<input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="acme.com, subsidiary.com" /><small>Optional. New users outside these domains are denied.</small></label><div className="connector-form-note connector-form--wide"><ShieldCheck size={18} /><span>Register this callback URI with {selectedTemplate?.name}: <code>{selectedTemplate?.redirectUri}</code></span></div><div className="connector-form-actions connector-form--wide"><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" disabled={busy}>Save encrypted connector</button></div></form>}<div className="connector-list">{connectors.map((connector) => <article key={connector.id}><span className={`connector-vendor connector-vendor--${connector.vendorId === 'google-api' ? 'google' : connector.vendorId}`}>{connector.vendorId === 'microsoft' ? 'M' : 'G'}</span><div><strong>{connector.displayName}</strong><small>{connector.name} · {connector.vendorId}</small>{connector.loginProviderConfig.allowedDomains.length > 0 && <em>{connector.loginProviderConfig.allowedDomains.join(', ')}</em>}</div><span className={connector.isLoginProvider ? 'auth-status auth-status--active' : 'auth-status'}>{connector.isLoginProvider && <Check size={12} />}{connector.isLoginProvider ? 'Login enabled' : 'Connector only'}</span><button disabled={busy} onClick={() => void toggleProvider(connector)}>{connector.isLoginProvider ? 'Disable login' : 'Use for login'}</button></article>)}{!connectors.length && <div className="settings-empty">No organization connectors configured yet.</div>}</div></section>{canManageMembers && <section className="settings-panel local-auth-panel"><div><span className="settings-icon"><KeyRound size={18} /></span><div><h3>Local password login</h3><p>Optional tenant-scoped credentials for development and testing. OAuth should remain the production default.</p></div></div><div className="local-auth-actions"><button className={localEnabled ? 'toggle toggle--active' : 'toggle'} onClick={() => void toggleLocal()} disabled={busy}><span /></button>{localEnabled && <button onClick={() => void createTestUser()} disabled={busy}>Create test user</button>}</div></section>}</div>;
}
