import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Bot,
  Boxes,
  ChevronDown,
  CircleHelp,
  CloudCog,
  FileText,
  GitPullRequestArrow,
  LayoutGrid,
  PanelsTopLeft,
  Menu,
  Rocket,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { api } from './api';
import { BrandMark } from './components/BrandMark';
import { BuilderStudio } from './components/BuilderStudio';
import { BrowserAppsStudio } from './components/BrowserAppsStudio';
import { DevelopmentCenter } from './components/DevelopmentCenter';
import { InterviewWorkspace } from './components/InterviewWorkspace';
import { ReleasesPage } from './components/ReleasesPage';
import { VisualCanvas } from './components/VisualCanvas';
import type { BootstrapData, BuilderAgent, Project, SpecArtifact } from './types';

type View = 'blueprint' | 'interview' | 'browserApps' | 'studio' | 'development' | 'releases';

const navigation: Array<{ id: View; label: string; icon: typeof LayoutGrid; description: string }> = [
  { id: 'blueprint', label: 'Blueprint', icon: Boxes, description: 'Visual source of truth' },
  { id: 'interview', label: 'Interview & PRD', icon: FileText, description: 'Intent and decisions' },
  { id: 'browserApps', label: 'Browser Apps', icon: PanelsTopLeft, description: 'Mongo-native React apps' },
  { id: 'development', label: 'Development', icon: GitPullRequestArrow, description: 'Hosted builder runs' },
  { id: 'releases', label: 'Releases', icon: Rocket, description: 'Evidence and promotion' },
  { id: 'studio', label: 'Builder Studio', icon: Bot, description: 'Superadmin agents' },
];

export function App() {
  const [data, setData] = useState<BootstrapData>();
  const [view, setView] = useState<View>('blueprint');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const project = data?.projects[0];

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await api.bootstrap());
      setError(undefined);
    } catch (reason) {
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

  const updateProject = (next: Project) => setData((current) => current ? { ...current, projects: current.projects.map((item) => item.id === next.id ? next : item) } : current);
  const activeMeta = useMemo(() => navigation.find((item) => item.id === view)!, [view]);

  if (loading) return <div className="app-loading"><BrandMark /><div><strong>One Ring</strong><span>Preparing your platform workspace…</span></div></div>;
  if (error || !data || !project) return <div className="error-screen"><BrandMark /><h1>We could not open the platform</h1><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></div>;

  const updateArtifact = async (id: string, patch: Partial<SpecArtifact>) => {
    const updated = await api.updateArtifact(project.id, id, patch);
    updateProject({ ...project, specVersion: project.specVersion + 1, artifacts: project.artifacts.map((item) => item.id === id ? updated : item) });
  };
  const updateAgent = async (id: string, patch: Partial<BuilderAgent>) => {
    const updated = await api.updateAgent(id, patch);
    setData({ ...data, agents: data.agents.map((item) => item.id === id ? updated : item) });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand"><BrandMark small /><div><strong>ONE RING</strong><span>PLATFORM</span></div></div>
        <div className="workspace-switcher"><span className="workspace-icon"><CloudCog size={17} /></span><span><small>Workspace</small><strong>Everworker Labs</strong></span><ChevronDown size={15} /></div>
        <nav>
          <span className="nav-label">Build</span>
          {navigation.slice(0, 5).map((item) => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setView(item.id); setSidebarOpen(false); }}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.id === 'interview' && <i className="nav-badge">1</i>}</button>)}
          <span className="nav-label nav-label--later">Operate</span>
          <button className={view === 'studio' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('studio'); setSidebarOpen(false); }}><Bot size={18} /><span><strong>Builder Studio</strong><small>Superadmin control</small></span></button>
          <button className="nav-item"><Settings size={18} /><span><strong>Platform settings</strong><small>Security and policies</small></span></button>
        </nav>
        <div className="sidebar-footer"><div className="usage-ring"><span>34%</span></div><div><strong>Builder allowance</strong><small>12.4k of 36k credits</small></div></div>
        <div className="user-card"><span>AA</span><div><strong>Anton Antich</strong><small>Platform superadmin</small></div><ChevronDown size={14} /></div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((value) => !value)}><Menu /></button>
          <div className="project-crumb"><span className="project-avatar"><Sparkles size={16} /></span><span><small>Managed application</small><strong>{project.name}</strong></span><ChevronDown size={15} /></div>
          <div className="global-search"><Search size={15} /><input placeholder="Search requirements, screens, agents…" /><kbd>⌘ K</kbd></div>
          <div className="top-actions"><button className="icon-button"><CircleHelp size={18} /></button><button className="icon-button notification"><Bell size={18} /><span /></button><button className="preview-button" onClick={() => setView('releases')}><Rocket size={15} /> Preview</button></div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><div className="breadcrumb">{project.name}<span>/</span>{activeMeta.label}</div><h1>{activeMeta.label}</h1><p>{activeMeta.description}. Spec v{project.specVersion} · {project.readiness}% ready.</p></div>
            <div className="heading-status"><span className="pulse-dot" /><span><small>Living spec</small><strong>All changes traceable</strong></span></div>
          </div>

          {view === 'blueprint' && <VisualCanvas artifacts={project.artifacts} onMove={(id, position) => void updateArtifact(id, { position })} onUpdate={(id, patch) => void updateArtifact(id, patch)} />}
          {view === 'interview' && <InterviewWorkspace project={project} aiAvailable={data.aiAvailable} onSend={async (content) => updateProject((await api.interview(project.id, content)).project)} onApprove={async () => updateProject(await api.approvePrd(project.id))} />}
          {view === 'browserApps' && <BrowserAppsStudio />}
          {view === 'studio' && <BuilderStudio agents={data.agents} connectors={data.connectors} version={data.builderVersion} onSave={updateAgent} />}
          {view === 'development' && <DevelopmentCenter project={project} runs={data.runs} onStart={async () => { await api.startRun(project.id); await refresh(true); }} />}
          {view === 'releases' && <ReleasesPage project={project} releases={data.releases} onPromote={async (id) => { await api.promote(id); await refresh(true); }} />}
        </div>
      </main>
    </div>
  );
}
