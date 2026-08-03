import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Database, LoaderCircle, LockKeyhole, Plus, Send, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { api } from '../api';
import type { AppTenancyMode, BrowserAppDetail } from '../types';

const choices: Array<{
  mode: AppTenancyMode;
  name: string;
  eyebrow: string;
  description: string;
  boundary: string;
  icon: typeof UserRound;
}> = [
  { mode: 'personal', name: 'Personal app', eyebrow: 'ONE OWNER', description: 'A private application for one person. No invitations or organization model.', boundary: 'Records belong to the app owner', icon: UserRound },
  { mode: 'team', name: 'Team app', eyebrow: 'ONE WORKSPACE', description: 'Many users with different roles collaborate in one shared data space.', boundary: 'One shared app data boundary', icon: UsersRound },
  { mode: 'multi_organization', name: 'Multi-organization', eyebrow: 'ISOLATED CUSTOMERS', description: 'Many organizations, each with members, roles and fully isolated records.', boundary: 'Server-enforced tenantId boundary', icon: Building2 },
];

type Props = {
  detail: BrowserAppDetail;
  onDetail: (detail: BrowserAppDetail) => void;
  onNotice: (message: string) => void;
  onError: (message: string | undefined) => void;
};

export function TenancyStudio({ detail, onDetail, onNotice, onError }: Props) {
  const [mode, setMode] = useState<AppTenancyMode>(detail.tenancy.mode);
  const [label, setLabel] = useState(detail.tenancy.organizationLabel);
  const [busy, setBusy] = useState<string>();
  const [organizationName, setOrganizationName] = useState('');
  const [invite, setInvite] = useState({ displayName: '', email: '', role: 'viewer' as 'viewer' | 'editor' | 'admin', tenantId: detail.endTenants[0]?.id ?? '' });
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof api.previewTenancy>>>();

  useEffect(() => {
    setMode(detail.tenancy.mode);
    setLabel(detail.tenancy.organizationLabel);
    setInvite((current) => ({ ...current, tenantId: detail.endTenants.some((tenant) => tenant.id === current.tenantId) ? current.tenantId : detail.endTenants[0]?.id ?? '' }));
  }, [detail]);

  const visibleMemberships = useMemo(() => {
    if (mode === 'multi_organization') return detail.memberships;
    const unique = new Map(detail.memberships.map((membership) => [membership.userId, membership]));
    const values = [...unique.values()];
    return mode === 'personal' ? values.filter((membership) => membership.roles.includes('admin')).slice(0, 1) : values;
  }, [detail.memberships, mode]);
  const dirty = mode !== detail.tenancy.mode || label !== detail.tenancy.organizationLabel;

  async function chooseMode(next: AppTenancyMode) {
    setMode(next); setImpact(undefined); onError(undefined);
    if (next !== detail.tenancy.mode) {
      try { setImpact(await api.previewTenancy(detail.app.id, next)); }
      catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to preview tenancy migration'); }
    }
  }

  async function applyMode() {
    if (busy || !dirty) return;
    setBusy('mode'); onError(undefined);
    try {
      const result = await api.configureTenancy(detail.app.id, mode, label, mode === 'multi_organization' ? invite.tenantId : undefined);
      onDetail(result.detail);
      const release = result.detail.releases.find((candidate) => candidate.status === 'active');
      onNotice(`${choices.find((choice) => choice.mode === mode)?.name} is active in release ${release?.version}. Data and session policies were migrated and verified.`);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to change application type'); }
    finally { setBusy(undefined); }
  }

  async function addOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationName.trim() || busy) return;
    setBusy('organization'); onError(undefined);
    try {
      const result = await api.createEndTenant(detail.app.id, organizationName.trim());
      onDetail(result.detail); setOrganizationName('');
      onNotice('Organization created. Its records will be isolated by the server runtime.');
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to create organization'); }
    finally { setBusy(undefined); }
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    if (!invite.email.trim() || !invite.displayName.trim() || busy) return;
    setBusy('invite'); onError(undefined);
    try {
      const result = await api.inviteAppMember(detail.app.id, { ...invite, tenantId: mode === 'multi_organization' ? invite.tenantId : undefined });
      onDetail(result.detail); setInvite((current) => ({ ...current, displayName: '', email: '' }));
      onNotice('Membership invitation created with a versioned role assignment.');
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to invite member'); }
    finally { setBusy(undefined); }
  }

  return <div className="tenancy-studio">
    <section className="tenancy-intro">
      <div className="tenancy-intro-icon"><ShieldCheck /></div>
      <div><small>APPLICATION AUDIENCE & DATA BOUNDARY</small><strong>Who uses this app?</strong><p>This choice becomes part of the living specification and the immutable release contract.</p></div>
      <div className="tenancy-revision"><span>ACTIVE CONTRACT</span><strong>v{detail.tenancy.revision}</strong><em>{detail.tenancy.mode.replace('_', ' ')}</em></div>
    </section>

    <section className="tenancy-choice-grid">
      {choices.map((choice) => <button key={choice.mode} className={mode === choice.mode ? 'active' : ''} onClick={() => void chooseMode(choice.mode)}>
        <span className="tenancy-choice-icon"><choice.icon /></span><small>{choice.eyebrow}</small><strong>{choice.name}</strong><p>{choice.description}</p><em><LockKeyhole /> {choice.boundary}</em>{mode === choice.mode && <i><Check /> Selected</i>}
      </button>)}
    </section>

    <section className="tenancy-contract-panel">
      <div className="tenancy-flow">
        <span><UserRound /> Authenticated user</span><b>→</b>
        <span><ShieldCheck /> Verified membership</span><b>→</b>
        {mode === 'multi_organization' && <><span><Building2 /> Active {label || 'organization'}</span><b>→</b></>}
        <span><Database /> Scoped records</span>
      </div>
      <div className="tenancy-apply">
        {mode === 'multi_organization' && <label><span>Organization terminology</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} placeholder="Organization" /></label>}
        {impact && <p className="tenancy-impact"><strong>Migration preview</strong>{impact.scopedRecords} scoped records preserved · {impact.unscopedPrivateRecords} unscoped private records {mode === 'multi_organization' ? 'assigned to the selected organization' : 'retained for reversible conversion'}.</p>}
        <div><small>{dirty ? 'Changing the contract preserves existing tenant assignments, records a migration, and creates a verified immutable release.' : 'The published release matches this tenancy contract.'}</small><button disabled={!dirty || Boolean(busy) || (impact?.requiresDefaultTenant && !invite.tenantId)} onClick={() => void applyMode()}>{busy === 'mode' ? <LoaderCircle className="spin" /> : <ShieldCheck />} Apply & verify</button></div>
      </div>
    </section>

    {mode === 'multi_organization' && <section className="tenancy-directory">
      <div className="tenancy-directory-heading"><div><small>ISOLATION BOUNDARIES</small><strong>{label || 'Organizations'}</strong></div><span>{detail.endTenants.length} active</span></div>
      <div className="tenant-list">{detail.endTenants.map((tenant) => <article key={tenant.id}><span><Building2 /></span><div><strong>{tenant.name}</strong><small>{tenant.slug}</small></div><em>{detail.memberships.filter((membership) => membership.tenantId === tenant.id).length} members</em><i>{tenant.status}</i></article>)}</div>
      <form className="tenancy-inline-form" onSubmit={addOrganization}><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder={`New ${label.toLowerCase()} name`} /><button disabled={Boolean(busy)}><Plus /> Add organization</button></form>
    </section>}

    {mode !== 'personal' && <section className="tenancy-directory">
      <div className="tenancy-directory-heading"><div><small>ROLE-BEARING MEMBERSHIPS</small><strong>Users and access</strong></div><span>{visibleMemberships.length} memberships</span></div>
      <div className="membership-list">{visibleMemberships.map((membership) => <article key={membership.id}><span>{membership.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</span><div><strong>{membership.displayName}</strong><small>{membership.email}</small></div>{mode === 'multi_organization' && <em>{detail.endTenants.find((tenant) => tenant.id === membership.tenantId)?.name ?? 'Unknown organization'}</em>}<i>{membership.roles.join(', ')}</i><button onClick={async () => { try { onDetail((await api.updateAppMember(detail.app.id, membership.id, { status: membership.status === 'suspended' ? 'active' : 'suspended' })).detail); } catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to update membership'); } }}>{membership.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button></article>)}</div>
      <form className="membership-form" onSubmit={inviteMember}>
        <input value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} placeholder="Full name" />
        <input value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} placeholder="name@company.com" type="email" />
        {mode === 'multi_organization' && <select value={invite.tenantId} onChange={(event) => setInvite({ ...invite, tenantId: event.target.value })}>{detail.endTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}
        <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as typeof invite.role })}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select>
        <button disabled={Boolean(busy)}>{busy === 'invite' ? <LoaderCircle className="spin" /> : <Send />} Invite member</button>
      </form>
    </section>}

    {mode === 'personal' && <section className="personal-boundary"><UserRound /><div><strong>One private owner</strong><p>Authentication remains platform-managed, but membership administration and organization switching are intentionally absent.</p></div><span>Least complexity</span></section>}
    {detail.tenancyMigrations.length > 0 && <section className="tenancy-migration-history"><strong>Migration history</strong>{detail.tenancyMigrations.slice(0, 5).map((migration) => <span key={migration.id}>{migration.fromMode.replaceAll('_', ' ')} → {migration.toMode.replaceAll('_', ' ')} · {migration.preservedScopedRecords} assignments preserved · {migration.status}</span>)}</section>}
  </div>;
}
