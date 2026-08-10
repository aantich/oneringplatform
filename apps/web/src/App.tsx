import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  CloudCog,
  GitPullRequestArrow,
  LayoutGrid,
  LogOut,
  PanelsTopLeft,
  Plus,
  Menu,
  Rocket,
  Settings,
  Sparkles,
} from 'lucide-react';
import { api } from './api';
import { BrandMark } from './components/BrandMark';
import { BuilderStudio } from './components/BuilderStudio';
import { BrowserAppsStudio } from './components/BrowserAppsStudio';
import { DevelopmentCenter } from './components/DevelopmentCenter';
import { LoginPage } from './components/LoginPage';
import { OrganizationSettings } from './components/OrganizationSettings';
import { ReleasesPage } from './components/ReleasesPage';
import type { BootstrapData, BuilderAgent, ControlPlaneSession } from './types';

type View = 'browserApps' | 'studio' | 'development' | 'releases' | 'organizationSettings';

const navigation: Array<{ id: View; label: string; icon: typeof LayoutGrid; description: string }> = [
  { id: 'browserApps', label: 'Applications', icon: PanelsTopLeft, description: 'Discover, specify, and build' },
  { id: 'development', label: 'Development', icon: GitPullRequestArrow, description: 'Hosted builder runs' },
  { id: 'releases', label: 'Releases', icon: Rocket, description: 'Evidence and promotion' },
  { id: 'studio', label: 'Builder Studio', icon: Bot, description: 'Superadmin agents' },
  { id: 'organizationSettings', label: 'Organization settings', icon: Settings, description: 'Identity and connectors' },
];

export function App() {
  if (window.location.pathname === '/login' || window.location.pathname.startsWith('/login/')) return <LoginPage />;
  return <ControlPlaneApp />;
}

function ControlPlaneApp() {
  const [data, setData] = useState<BootstrapData>();
  const [session, setSession] = useState<ControlPlaneSession>();
  const [view, setView] = useState<View>('browserApps');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const project = data?.projects[0];

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextData, nextSession] = await Promise.all([api.bootstrap(), api.session()]);
      setData(nextData);
      setSession(nextSession);
      if (nextSession.activeOrganization && !window.localStorage.getItem('onering.activePlatformOrganizationId')) {
        window.localStorage.setItem('onering.activePlatformOrganizationId', nextSession.activeOrganization.id);
      }
      if (nextSession.activeOrganization) window.localStorage.setItem('onering.lastOrganizationSlug', nextSession.activeOrganization.slug);
      setError(undefined);
    } catch (reason) {
      if (reason instanceof Error && 'status' in reason && reason.status === 401) {
        const slug = window.localStorage.getItem('onering.lastOrganizationSlug');
        window.location.href = slug ? `/login/${slug}` : '/login';
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load platform');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!data?.runs.some((run) => run.status === 'running')) return;
    const timer = window.setInterval(() => void refresh(true), 700);
    return () => window.clearInterval(timer);
  }, [data?.runs, refresh]);

  const activeMeta = useMemo(() => navigation.find((item) => item.id === view)!, [view]);

  if (loading) return <div className="app-loading"><BrandMark /><div><strong>One Ring</strong><span>Preparing your platform workspace…</span></div></div>;
  if (error || !data || !session || !project) return <div className="error-screen"><BrandMark /><h1>We could not open the platform</h1><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></div>;

  const canManageBuilderSystem = session.principal.permissions.includes('platform.builder_system.manage');
  const canManageOrganizationSettings = session.principal.permissions.includes('secrets.manage') || session.principal.permissions.includes('organization.members.manage');
  const displayName = session.principal.displayName;
  const initials = displayName.split(/\s+|[._-]/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'OR';
  const selectOrganization = async (organizationId: string) => {
    await api.switchOrganization(organizationId);
    window.localStorage.setItem('onering.activePlatformOrganizationId', organizationId);
    setView('browserApps');
    await refresh();
  };
  const createOrganization = async () => {
    const name = window.prompt('New organization name');
    if (!name?.trim()) return;
    try {
      const organization = await api.createOrganization(name.trim());
      await selectOrganization(organization.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create organization');
    }
  };

  const updateAgent = async (id: string, patch: Partial<BuilderAgent>) => {
    const updated = await api.updateAgent(id, patch);
    setData({ ...data, agents: data.agents.map((item) => item.id === id ? updated : item) });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand"><BrandMark small /><div><strong>One Ring</strong><span>Product studio</span></div></div>
        <div className="workspace-switcher"><span className="workspace-icon"><CloudCog size={17} /></span><label><small>Organization</small><select aria-label="Active organization" value={session.activeOrganization?.id ?? ''} onChange={(event) => void selectOrganization(event.target.value)}>{session.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><button aria-label="Create organization" onClick={() => void createOrganization()}><Plus size={14} /></button></div>
        <nav>
          <span className="nav-label">Build</span>
          {navigation.slice(0, 3).map((item) => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setView(item.id); setSidebarOpen(false); }}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
          <span className="nav-label nav-label--later">Operate</span>
          {canManageBuilderSystem && <button className={view === 'studio' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('studio'); setSidebarOpen(false); }}><Bot size={18} /><span><strong>Builder Studio</strong><small>Superadmin control</small></span></button>}
          {canManageOrganizationSettings && <button className={view === 'organizationSettings' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('organizationSettings'); setSidebarOpen(false); }}><Settings size={18} /><span><strong>Organization settings</strong><small>Identity and connectors</small></span></button>}
        </nav>
        <div className="user-card"><span>{initials}</span><div><strong>{displayName}</strong><small>{canManageBuilderSystem ? 'Platform superadmin' : session.principal.organizationRole ?? 'No active organization'}</small></div>{!session.principal.localDevelopment && <button title="Sign out" aria-label="Sign out" onClick={() => void api.logout().then(() => { window.location.href = `/login/${session.activeOrganization?.slug ?? ''}`; })}><LogOut size={14} /></button>}</div>
      </aside>

      <main className="main-shell">
        {session.principal.localDevelopment && <div className="dev-auth-banner">Development authentication · loopback-only local superadmin</div>}
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((value) => !value)}><Menu /></button>
          <div className="project-crumb"><span className="project-avatar"><Sparkles size={16} /></span><span><small>{view === 'browserApps' ? 'Application builder' : 'Platform operations'}</small><strong>{view === 'browserApps' ? 'Build from a conversation' : project.name}</strong></span>{view !== 'browserApps' && <ChevronDown size={15} />}</div>
          <div className="top-actions">{view !== 'browserApps' && <button className="preview-button" onClick={() => setView('releases')}><Rocket size={15} /> Preview</button>}</div>
        </header>

        <div className="content">
          {view !== 'browserApps' && <div className="page-heading">
            <div><div className="breadcrumb">{project.name}<span>/</span>{activeMeta.label}</div><h1>{activeMeta.label}</h1><p>{`${activeMeta.description}. Spec v${project.specVersion} · ${project.readiness}% ready.`}</p></div>
            <div className="heading-status"><span className="pulse-dot" /><span><small>Living spec</small><strong>All changes traceable</strong></span></div>
          </div>}

          {view === 'browserApps' && <BrowserAppsStudio />}
          {view === 'studio' && canManageBuilderSystem && <BuilderStudio agents={data.agents} connectors={data.connectors} version={data.builderVersion} onSave={updateAgent} />}
          {view === 'development' && <DevelopmentCenter project={project} runs={data.runs} onStart={async () => { await api.startRun(project.id); await refresh(true); }} />}
          {view === 'releases' && <ReleasesPage project={project} releases={data.releases} onPromote={async (id) => { await api.promote(id); await refresh(true); }} />}
          {view === 'organizationSettings' && canManageOrganizationSettings && session.activeOrganization && <OrganizationSettings organization={session.activeOrganization} canManageMembers={session.principal.permissions.includes('organization.members.manage')} />}
        </div>
      </main>
    </div>
  );
}
