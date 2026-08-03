import { useEffect, useMemo, useState } from 'react';
import { Box, Braces, Cable, Check, ClipboardCheck, Code2, Database, ExternalLink, FileText, GitBranch, Globe2, LoaderCircle, Palette, Play, Plus, RefreshCw, Route, Save, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { api } from '../api';
import type { AppTenancyMode, BrowserAppDetail, BrowserAppModule, BrowserAppSummary } from '../types';
import { VisualDesignStudio } from './VisualDesignStudio';
import { TenancyStudio } from './TenancyStudio';

type Panel = 'requirements' | 'tenancy' | 'design' | 'modules' | 'routes' | 'data' | 'security' | 'connectors' | 'evidence';

const panels: Array<{ id: Panel; label: string; icon: typeof Box }> = [
  { id: 'requirements', label: 'Living requirements', icon: FileText },
  { id: 'tenancy', label: 'Users & tenancy', icon: UsersRound },
  { id: 'design', label: 'Visual design', icon: Palette },
  { id: 'modules', label: 'Modules', icon: Code2 },
  { id: 'routes', label: 'Routes', icon: Route },
  { id: 'data', label: 'Data model', icon: Database },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'connectors', label: 'Connectors', icon: Cable },
  { id: 'evidence', label: 'Release evidence', icon: ClipboardCheck },
];

export function BrowserAppsStudio() {
  const [apps, setApps] = useState<BrowserAppSummary[]>([]);
  const [detail, setDetail] = useState<BrowserAppDetail>();
  const [selectedAppId, setSelectedAppId] = useState<string>();
  const [panel, setPanel] = useState<Panel>('tenancy');
  const [selectedModule, setSelectedModule] = useState<BrowserAppModule>();
  const [instruction, setInstruction] = useState('Refine the visual hierarchy while preserving every security contract.');
  const [domain, setDomain] = useState('pulse.customer.localhost');
  const [busy, setBusy] = useState<'generate' | 'build' | 'create'>();
  const [showCreate, setShowCreate] = useState(false);
  const [newApp, setNewApp] = useState<{ name: string; description: string; mode: AppTenancyMode }>({ name: '', description: '', mode: 'team' });
  const [requirements, setRequirements] = useState<BrowserAppDetail['specification']['sections']>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    try {
      const list = await api.browserApps();
      setApps(list);
      const target = list.find((item) => item.id === selectedAppId) ?? list[0];
      if (target) {
        const next = await api.browserApp(target.id);
        setSelectedAppId(target.id);
        setDetail(next);
        setRequirements(structuredClone(next.specification.sections));
        setSelectedModule((current) => next.modules.find((item) => item.id === current?.id) ?? next.modules[0]);
      }
      setError(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load browser apps'); }
  }

  useEffect(() => { void load(); }, []);
  const app = apps.find((item) => item.id === detail?.app.id);
  const activeRelease = detail?.releases.find((release) => release.status === 'active');
  const latestBuild = detail?.builds[0];
  const roles = useMemo(() => detail?.policies[0] ? Object.entries(detail.policies[0].grants) : [], [detail]);

  async function generate() {
    if (!app || busy) return;
    setBusy('generate'); setNotice(undefined);
    try {
      const result = await api.generateBrowserApp(app.id, instruction);
      setDetail(result.detail);
      setApps(await api.browserApps());
      setNotice(`${result.plan.agent === 'oneringai' ? 'oneringai' : 'Safe fallback'} generated and published revision ${result.detail.app.sourceRevision}: ${result.plan.headline}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Generation failed'); }
    finally { setBusy(undefined); }
  }

  async function selectApp(appId: string) {
    setSelectedAppId(appId); setError(undefined); setNotice(undefined);
    try {
      const next = await api.browserApp(appId); setDetail(next); setRequirements(structuredClone(next.specification.sections)); setSelectedModule(next.modules[0]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open application'); }
  }

  async function createApp(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !newApp.name.trim() || !newApp.description.trim()) return;
    setBusy('create'); setError(undefined);
    try {
      const result = await api.createBrowserApp(newApp);
      const list = await api.browserApps(); setApps(list); setDetail(result.detail); setSelectedAppId(result.detail.app.id);
      setSelectedModule(result.detail.modules[0]); setRequirements(structuredClone(result.detail.specification.sections)); setShowCreate(false); setNewApp({ name: '', description: '', mode: 'team' });
      setNotice(`${result.detail.app.name} was created and published with an isolated application graph.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create application'); }
    finally { setBusy(undefined); }
  }

  async function saveRequirements() {
    if (!detail || busy) return;
    setBusy('build'); setError(undefined); setNotice(undefined);
    try {
      const result = await api.reviseBrowserAppSpecification(detail.app.id, detail.specification.revision, requirements);
      setDetail(result.detail); setRequirements(structuredClone(result.detail.specification.sections));
      setNotice(`Living requirements revision ${result.detail.specification.revision} is now the source of truth for the next agent revision.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save requirements'); }
    finally { setBusy(undefined); }
  }

  async function build() {
    if (!app || busy) return;
    setBusy('build'); setNotice(undefined);
    try {
      const result = await api.buildBrowserApp(app.id);
      setDetail(result.detail);
      setNotice(`Release ${result.detail.releases.find((release) => release.status === 'active')?.version} passed and is active.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Build failed'); }
    finally { setBusy(undefined); }
  }

  async function addDomain() {
    if (!app || !domain.trim()) return;
    setBusy('build'); setNotice(undefined);
    try {
      const binding = await api.createBrowserAppBinding(app.id, domain.trim(), 'custom_hostname');
      const verified = binding.verificationToken
        ? await api.verifyBrowserAppBinding(app.id, binding.id, binding.verificationToken)
        : binding;
      await load();
      setNotice(`Verified ${verified.hostname}; the active release now resolves on this hostname.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Domain binding failed'); }
    finally { setBusy(undefined); }
  }

  if (error && !detail) return <div className="browser-empty"><ShieldCheck /><h2>Browser app runtime unavailable</h2><p>{error}</p><button onClick={() => void load()}>Retry connection</button></div>;
  if (!detail || !app) return <div className="browser-empty"><LoaderCircle className="spin" /><h2>Loading Mongo-native application graph</h2></div>;

  return <div className="browser-studio">
    <section className="app-switcher-bar">
      <label><span>Browser application</span><select value={detail.app.id} onChange={(event) => void selectApp(event.target.value)}>{apps.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.tenancyMode.replaceAll('_', ' ')}</option>)}</select></label>
      <button onClick={() => setShowCreate((value) => !value)}><Plus /> New app</button>
      {showCreate && <form onSubmit={createApp}><input aria-label="New app name" placeholder="Application name" value={newApp.name} onChange={(event) => setNewApp({ ...newApp, name: event.target.value })}/><input aria-label="New app description" placeholder="What does it help people do?" value={newApp.description} onChange={(event) => setNewApp({ ...newApp, description: event.target.value })}/><select aria-label="New app audience" value={newApp.mode} onChange={(event) => setNewApp({ ...newApp, mode: event.target.value as AppTenancyMode })}><option value="personal">Personal</option><option value="team">Team</option><option value="multi_organization">Multi-organization</option></select><button disabled={Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" /> : <Plus />} Create & publish</button></form>}
    </section>
    <section className="browser-hero">
      <div className="browser-hero-copy"><div className="mode-kicker"><Sparkles size={13} /> SPECIAL MODE · BROWSER-NATIVE DATA APP</div><h2>{app.name}</h2><p>{app.description}</p><div className="browser-meta"><span><Check size={13} /> MongoDB connected</span><span><Check size={13} /> Release {activeRelease?.version}</span><span><Check size={13} /> {detail.tenancy.mode === 'personal' ? 'Personal' : detail.tenancy.mode === 'team' ? 'Team workspace' : `${detail.endTenants.length} organizations`}</span><span><Check size={13} /> No app server</span></div></div>
      <div className="browser-hero-actions"><a className="launch-app" href={app.url} target="_blank" rel="noreferrer"><Play size={16} fill="currentColor" /> Open working app <ExternalLink size={14} /></a><button onClick={() => void build()} disabled={Boolean(busy)}>{busy === 'build' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Verify & publish</button></div>
    </section>

    <section className="browser-stats">
      <article><Code2 /><div><strong>{detail.modules.length}</strong><span>versioned modules</span></div></article>
      <article><Route /><div><strong>{detail.routes.length}</strong><span>browser routes</span></div></article>
      <article><Database /><div><strong>{detail.schemas.length}</strong><span>secured entities</span></div></article>
      <article><ShieldCheck /><div><strong>{roles.length}</strong><span>standard roles</span></div></article>
      <article><Braces /><div><strong>{latestBuild?.tests ?? 0}</strong><span>release checks</span></div></article>
    </section>

    <section className="agent-generation-card">
      <div className="agent-orb"><Sparkles /></div><div className="agent-generation-copy"><span>ONERINGAI SERVER BUILDER</span><strong>Generate the next component-graph revision</strong><p>No Git checkout or local coding environment. Agents update structured modules in MongoDB, then the isolated builder verifies and publishes an immutable bundle.</p></div><div className="agent-generation-form"><input value={instruction} onChange={(event) => setInstruction(event.target.value)} /><button onClick={() => void generate()} disabled={Boolean(busy)}>{busy === 'generate' ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} Generate revision</button></div>
    </section>
    {notice && <div className="browser-notice"><Check size={16} />{notice}</div>}
    {error && <div className="browser-error">{error}</div>}

    <section className="browser-workbench">
      <aside className="workbench-nav">{panels.map((item) => <button key={item.id} className={panel === item.id ? 'active' : ''} onClick={() => setPanel(item.id)}><item.icon size={16} />{item.label}<span>{item.id === 'requirements' ? detail.specification.revision : item.id === 'tenancy' ? detail.tenancy.revision : item.id === 'design' ? detail.app.themeRevision : item.id === 'modules' ? detail.modules.length : item.id === 'routes' ? detail.routes.length : item.id === 'data' ? detail.schemas.length : item.id === 'security' ? roles.length : item.id === 'evidence' ? latestBuild?.checks.length ?? 0 : detail.connectors.length}</span></button>)}</aside>
      <div className="workbench-content">
        {panel === 'requirements' && <div className="requirements-editor"><div className="workbench-heading"><div><span>Living product requirements</span><small>Every agent change starts from this approved, versioned source of truth.</small></div><button onClick={() => void saveRequirements()} disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" /> : <Save />} Save revision</button></div>{requirements.map((section, index) => <article key={section.id}><label>Stable ID<input value={section.id} disabled /></label><label>Section title<input value={section.title} onChange={(event) => setRequirements(requirements.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))}/></label><label>Requirement<textarea value={section.body} onChange={(event) => setRequirements(requirements.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))}/></label></article>)}</div>}
        {panel === 'tenancy' && <TenancyStudio detail={detail} onDetail={setDetail} onNotice={(message) => { setNotice(message); setError(undefined); }} onError={setError} />}
        {panel === 'design' && <VisualDesignStudio detail={detail} onDetail={setDetail} onNotice={(message) => { setNotice(message); setError(undefined); }} onError={setError} />}
        {panel === 'modules' && <div className="module-browser"><div className="module-list"><div className="workbench-heading"><span>Component graph</span><small>revision {detail.app.sourceRevision}</small></div>{detail.modules.map((item) => <button key={item.id} className={selectedModule?.id === item.id ? 'active' : ''} onClick={() => setSelectedModule(item)}><span className={`module-kind kind-${item.kind}`}>{item.kind}</span><strong>{item.name}</strong><small>{item.description}</small><i>{item.contentHash.slice(0, 8)}</i></button>)}</div><div className="source-view"><div><span><GitBranch size={14} /> app://module/{selectedModule?.id}</span><small>immutable · TSX</small></div><pre>{selectedModule?.source}</pre></div></div>}
        {panel === 'routes' && <div className="definition-grid">{detail.routes.map((route) => <article key={route.id}><span className="definition-icon"><Route /></span><div><small>{route.public ? 'PUBLIC ROUTE' : 'PROTECTED ROUTE'}</small><strong>{route.path}</strong><p>Renders <code>app://module/{route.pageModuleId}</code></p></div><span className="definition-status">BrowserRouter</span></article>)}<article className="route-binding-card"><span className="definition-icon"><Globe2 /></span><div><small>ACTIVE BINDINGS</small><strong>One release, multiple locations</strong>{detail.bindings.map((binding) => <p key={binding.id}>{binding.hostname}{binding.pathPrefix} · {binding.type.replaceAll('_', ' ')} · {binding.status}</p>)}<div className="domain-binding-form"><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="app.customer.com"/><button onClick={() => void addDomain()} disabled={Boolean(busy)}>Add & verify local domain</button></div></div><span className="definition-status">build once</span></article></div>}
        {panel === 'data' && <div className="definition-grid">{detail.schemas.map((schema) => <article key={schema.id}><span className="definition-icon"><Database /></span><div><small>{schema.deploymentMode.replaceAll('_', ' ')}</small><strong>{schema.displayName}</strong><p>Logical entity <code>{schema.entity}</code></p><div className="field-chips">{Object.keys((schema.jsonSchema.properties ?? {}) as object).map((field) => <span key={field}>{field}</span>)}</div></div><span className="definition-status">{schema.indexes.length} indexes</span></article>)}</div>}
        {panel === 'security' && <div className="role-matrix"><div className="workbench-heading"><span>Server-enforced role policy</span><small>UI hints never replace API authorization</small></div>{roles.map(([role, grant]) => <article key={role}><strong>{role}</strong><div>{['create','read','update','delete'].map((operation) => <span key={operation} className={grant.operations.includes(operation) ? 'allowed' : 'denied'}>{grant.operations.includes(operation) ? '✓' : '—'} {operation}</span>)}</div><small>{grant.writeFields.length ? `Writable: ${grant.writeFields.join(', ')}` : 'No writable fields'}</small></article>)}</div>}
        {panel === 'connectors' && <div className="definition-grid">{detail.connectors.map((connector) => <article key={connector.id}><span className="definition-icon"><Cable /></span><div><small>ONERINGAI CONNECTOR GRANT</small><strong>{connector.id} / {connector.action}</strong><p>{connector.description}</p><div className="field-chips">{connector.allowedRoles.map((role) => <span key={role}>{role}</span>)}</div></div><span className="definition-status">{connector.rateLimitPerMinute}/min</span></article>)}</div>}
        {panel === 'evidence' && <div className="release-evidence"><div className="workbench-heading"><div><span>Release admission evidence</span><small>{latestBuild?.artifactDigest ?? 'No immutable artifact digest yet'}</small></div><span className={`evidence-status ${latestBuild?.status}`}>{latestBuild?.status ?? 'unknown'}</span></div>{latestBuild?.checks.map((check) => <article key={check.id}><span className={check.status}><Check /></span><div><strong>{check.label}</strong><p>{check.detail}</p></div><small>{check.durationMs} ms</small></article>)}</div>}
      </div>
    </section>
  </div>;
}
