import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, LockKeyhole } from 'lucide-react';
import { api } from '../api';
import { BrandMark } from './BrandMark';
import type { OrganizationLoginConfiguration } from '../types';

export function LoginPage() {
  const pathMatch = window.location.pathname.match(/^\/login\/([a-z0-9-]+)\/?$/i);
  const routedSlug = pathMatch?.[1];
  const [slug, setSlug] = useState(routedSlug ?? window.localStorage.getItem('onering.lastOrganizationSlug') ?? '');
  const [configuration, setConfiguration] = useState<OrganizationLoginConfiguration>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(new URLSearchParams(window.location.search).get('error') ?? '');

  useEffect(() => {
    if (!routedSlug) return;
    setBusy(true);
    api.publicLoginConfiguration(routedSlug)
      .then((value) => {
        setConfiguration(value);
        window.localStorage.setItem('onering.lastOrganizationSlug', value.organization.slug);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load sign-in'))
      .finally(() => setBusy(false));
  }, [routedSlug]);

  if (!routedSlug) {
    return <main className="login-screen"><section className="login-card login-card--compact"><BrandMark /><span className="eyebrow">ONE RING PLATFORM</span><h1>Choose your organization</h1><p>Enter the organization slug supplied by your administrator.</p><form onSubmit={(event) => { event.preventDefault(); if (slug.trim()) window.location.href = `/login/${slug.trim().toLowerCase()}`; }}><label>Organization slug<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="acme" autoFocus /></label><button className="primary-button" disabled={!slug.trim()}>Continue <ArrowRight size={16} /></button></form>{error && <div className="auth-error">{error}</div>}</section></main>;
  }
  const organizationSlug = routedSlug;

  const passwordLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.passwordLogin(organizationSlug, email, password);
      window.location.href = '/';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  const oauthLogin = async (connectorId: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.startOrganizationLogin(organizationSlug, connectorId);
      window.location.href = result.authUrl;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start sign-in');
      setBusy(false);
    }
  };

  return <main className="login-screen"><section className="login-card"><div className="login-brand"><BrandMark /><div><span>ONE RING</span><small>PLATFORM</small></div></div><span className="eyebrow">ORGANIZATION SIGN-IN</span><h1>{configuration?.organization.name ?? 'Loading…'}</h1><p>Use the identity provider configured by your organization.</p>{error && <div className="auth-error">{error}</div>}<div className="provider-stack">{configuration?.providers.map((provider) => <button key={provider.id} className="provider-button" disabled={busy} onClick={() => void oauthLogin(provider.id)}><span className={`provider-logo provider-logo--${provider.vendorId === 'google-api' ? 'google' : provider.vendorId}`}>{provider.vendorId === 'microsoft' ? 'M' : 'G'}</span>Continue with {provider.name}<ArrowRight size={16} /></button>)}</div>{configuration?.localPasswordEnabled && <><div className="login-divider"><span>test login</span></div><form onSubmit={passwordLogin}><label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button" disabled={busy || !email || !password}><KeyRound size={16} /> Sign in with password</button></form></>}{configuration && !configuration.providers.length && !configuration.localPasswordEnabled && <div className="auth-empty"><LockKeyhole size={20} />No login provider has been configured. Contact the organization administrator.</div>}<a className="login-back" href="/login">Use another organization</a></section></main>;
}
