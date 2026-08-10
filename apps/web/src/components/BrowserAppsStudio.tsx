import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, Check, CircleAlert, Clock3, Code2, Database, ExternalLink, FileText, GitBranch, Globe2, LoaderCircle, Palette, Play, Plus, Rocket, Settings, ShieldCheck, Sparkles, Wrench, X } from 'lucide-react';
import { api } from '../api';
import type { ApplicationGeneratorManifest, ApplicationProfile, ApplicationType, AppTenancyMode, BrowserAppDetail, BrowserAppSummary, BrowserGenerationAgentConfiguration, BrowserGenerationJob, BrowserGenerationOptions, BrowserGenerationProfile, GenerationEffort } from '../types';
import { ApplicationDiscovery } from './ApplicationDiscovery';
import { TenancyStudio } from './TenancyStudio';
import { VisualDesignStudio } from './VisualDesignStudio';

type WorkspaceArea = 'define' | 'build' | 'review' | 'settings';

const applicationTypes: Array<[ApplicationType, string, string]> = [
  ['browser_data', 'Browser app', 'Interactive UI, MongoDB data, workflows, and optional agents.'],
  ['full_stack', 'Full application', 'Browser and server application code.'],
  ['api_service', 'API or service', 'A managed server API and integration surface.'],
  ['workflow_automation', 'Automation', 'Scheduled, event-driven, and durable workflows.'],
  ['mobile', 'Mobile app', 'A native mobile product definition.'],
];

const tenancyChoices: Array<[AppTenancyMode, string, string]> = [
  ['personal', 'Just me', 'One private workspace'],
  ['team', 'My team', 'One shared workspace'],
  ['multi_organization', 'Customer organizations', 'Many isolated tenants'],
];

function defaultApplicationProfile(applicationType: ApplicationType = 'browser_data', tenancyMode: AppTenancyMode = 'team'): ApplicationProfile {
  return {
    applicationType,
    tenancyMode,
    identityMode: tenancyMode === 'personal' ? 'private' : 'public_and_authenticated',
    agenticLevel: 'assistive',
    dataSensitivity: 'standard',
    deploymentTarget: 'managed_platform',
    execution: {
      browser: ['browser_data', 'full_stack', 'mobile'].includes(applicationType),
      server: ['full_stack', 'api_service', 'workflow_automation'].includes(applicationType),
      backgroundJobs: applicationType === 'workflow_automation',
      schedules: applicationType === 'workflow_automation',
      webhooks: ['api_service', 'workflow_automation'].includes(applicationType),
    },
  };
}

function profileForApp(detail: BrowserAppDetail, options: BrowserGenerationOptions): BrowserGenerationProfile {
  const stored = detail.app.generationProfile;
  if (!stored?.agents.length) return structuredClone(options.defaultProfile);
  const configuredConnectorExists = options.connectors.some((connector) => connector.configured);
  const agents = stored.agents.slice(0, options.maximumAgents).flatMap((configuration) => {
    const template = options.agents.find((candidate) => candidate.id === configuration.templateId);
    if (!template) return [];
    const connector = options.connectors.find((candidate) => candidate.id === configuration.connector);
    const valid = connector && (!configuredConnectorExists || connector.configured) && connector.models.some((model) => model.id === configuration.model);
    return [{ ...(valid ? configuration : template.defaultConfiguration), templateVersion: template.defaultConfiguration.templateVersion, name: template.name, role: template.role }];
  });
  return agents.length ? { agents, updatedAt: stored.updatedAt } : structuredClone(options.defaultProfile);
}

function friendlyPhase(job: BrowserGenerationJob) {
  if (job.status === 'completed') return 'Your preview is ready';
  if (job.status === 'failed') return 'Build stopped safely';
  if (job.status === 'cancelled') return 'Build cancelled';
  if (job.phase === 'preparing' || job.phase === 'queued') return 'Understanding the approved application';
  if (job.phase.startsWith('agent:')) return 'Designing and implementing the experience';
  if (job.phase === 'compiling') return 'Assembling pages, data, workflows, and agents';
  if (job.phase === 'validating') return 'Testing security and product behavior';
  return job.phase.replaceAll('_', ' ');
}

export function BrowserAppsStudio() {
  const [apps, setApps] = useState<BrowserAppSummary[]>([]);
  const [detail, setDetail] = useState<BrowserAppDetail>();
  const [generationOptions, setGenerationOptions] = useState<BrowserGenerationOptions>();
  const [generators, setGenerators] = useState<ApplicationGeneratorManifest[]>([]);
  const [generationProfile, setGenerationProfile] = useState<BrowserGenerationProfile>();
  const [generationJob, setGenerationJob] = useState<BrowserGenerationJob | null>();
  const [area, setArea] = useState<WorkspaceArea>('define');
  const [showLibrary, setShowLibrary] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'create' | 'confirm' | 'generate' | 'promote' | 'domain'>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [instruction, setInstruction] = useState('Build the complete application described by the approved definition. Preserve security, tenancy, accessibility, visual direction, and release contracts.');
  const [domain, setDomain] = useState('');
  const [newApp, setNewApp] = useState({ name: '', description: '', profile: defaultApplicationProfile() });

  async function loadLibrary() {
    try {
      const [list, options, manifests] = await Promise.all([api.browserApps(), api.browserGenerationOptions(), api.applicationGenerators()]);
      setApps(list);
      setGenerationOptions(options);
      setGenerators(manifests);
      if (!list.length) setShowCreate(true);
      setError(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load applications'); }
    finally { setLoaded(true); }
  }

  useEffect(() => { void loadLibrary(); }, []);
  useEffect(() => {
    if (!detail || !generationJob || !['queued', 'running'].includes(generationJob.status)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await api.browserGenerationJob(detail.app.id, generationJob.id);
        if (stopped) return;
        setGenerationJob(next);
        if (!['queued', 'running'].includes(next.status)) await refreshApplication();
      } catch (reason) { if (!stopped) setError(reason instanceof Error ? reason.message : 'Unable to read build progress'); }
    };
    const timer = window.setInterval(() => void poll(), 800);
    void poll();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [detail?.app.id, generationJob?.id, generationJob?.status]);

  async function openApplication(appId: string, nextArea: WorkspaceArea = 'define') {
    setError(undefined); setNotice(undefined);
    try {
      const [next, latest] = await Promise.all([api.browserApp(appId), api.latestBrowserGenerationJob(appId)]);
      setDetail(next);
      setGenerationJob(latest);
      if (generationOptions) setGenerationProfile(profileForApp(next, generationOptions));
      setArea(nextArea);
      setShowLibrary(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open application'); }
  }

  async function refreshApplication() {
    if (!detail) return;
    const [next, list] = await Promise.all([api.browserApp(detail.app.id), api.browserApps()]);
    setDetail(next);
    setApps(list);
    if (generationOptions) setGenerationProfile(profileForApp(next, generationOptions));
  }

  async function createApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!newApp.name.trim() || !newApp.description.trim() || busy) return;
    setBusy('create'); setError(undefined);
    try {
      const result = await api.createBrowserApp({ name: newApp.name, description: newApp.description, mode: newApp.profile.tenancyMode, profile: newApp.profile });
      setDetail(result.detail);
      if (generationOptions) setGenerationProfile(profileForApp(result.detail, generationOptions));
      setApps(await api.browserApps());
      setGenerationJob(undefined);
      setShowCreate(false);
      setShowLibrary(false);
      setArea('define');
      setNewApp({ name: '', description: '', profile: defaultApplicationProfile() });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create application'); }
    finally { setBusy(undefined); }
  }

  async function confirmDefinition() {
    if (!detail || busy) return;
    if (detail.app.specificationApprovalStatus === 'approved') { setArea('build'); return; }
    setBusy('confirm'); setError(undefined);
    try {
      const result = await api.approveBrowserAppSpecification(detail.app.id);
      setDetail(result.detail);
      setApps(await api.browserApps());
      setArea('build');
      setNotice(`Specification v${result.detail.app.specRevision} is confirmed. The build team will use exactly this definition.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to confirm the application definition'); }
    finally { setBusy(undefined); }
  }

  async function generate() {
    if (!detail || !generationProfile || busy) return;
    setBusy('generate'); setError(undefined); setNotice(undefined);
    try { setGenerationJob(await api.generateBrowserApp(detail.app.id, instruction, generationProfile)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start the build'); }
    finally { setBusy(undefined); }
  }

  async function cancelGeneration() {
    if (!detail || !generationJob || !['queued', 'running'].includes(generationJob.status)) return;
    try { setGenerationJob(await api.cancelBrowserGenerationJob(detail.app.id, generationJob.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to cancel the build'); }
  }

  async function promotePreview() {
    const preview = detail?.releases.find((release) => release.status === 'preview');
    if (!detail || !preview || busy) return;
    setBusy('promote'); setError(undefined);
    try {
      const result = await api.promoteBrowserAppRelease(detail.app.id, preview.id);
      setDetail(result.detail);
      setApps(await api.browserApps());
      setNotice('The exact reviewed preview is now the production application.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish the preview'); }
    finally { setBusy(undefined); }
  }

  async function addDomain(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !domain.trim() || busy) return;
    setBusy('domain'); setError(undefined);
    try {
      const binding = await api.createBrowserAppBinding(detail.app.id, domain.trim(), 'custom_hostname');
      if (binding.verificationToken) await api.verifyBrowserAppBinding(detail.app.id, binding.id, binding.verificationToken);
      await refreshApplication();
      setDomain('');
      setNotice('Custom hostname added and verified for local development.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to add hostname'); }
    finally { setBusy(undefined); }
  }

  function updateGenerationAgent(index: number, patch: Partial<BrowserGenerationAgentConfiguration>) {
    if (!generationProfile) return;
    setGenerationProfile({ ...generationProfile, agents: generationProfile.agents.map((agent, candidate) => candidate === index ? { ...agent, ...patch } : agent) });
  }

  function chooseApplicationType(type: ApplicationType) {
    setNewApp((current) => ({ ...current, profile: defaultApplicationProfile(type, current.profile.tenancyMode) }));
  }

  function chooseTenancy(mode: AppTenancyMode) {
    setNewApp((current) => ({ ...current, profile: { ...current.profile, tenancyMode: mode, identityMode: mode === 'personal' ? 'private' : 'public_and_authenticated' } }));
  }

  const activeRelease = detail?.releases.find((release) => release.status === 'active');
  const previewRelease = detail?.releases.find((release) => release.status === 'preview');
  const previewUrl = detail && previewRelease?.previewToken ? `${detail.app.url}?preview=${encodeURIComponent(previewRelease.id)}&token=${encodeURIComponent(previewRelease.previewToken)}` : undefined;
  const generator = detail && generators.find((candidate) => candidate.id === detail.app.generatorId);
  const generationActive = Boolean(generationJob && ['queued', 'running'].includes(generationJob.status));
  const latestBuild = detail?.builds[0];
  const connectorById = useMemo(() => new Map(generationOptions?.connectors.map((item) => [item.id, item]) ?? []), [generationOptions]);

  const createDialog = showCreate && <div className="simple-creator-backdrop"><form className="simple-creator" onSubmit={createApplication}>
    <header><div><span>NEW APPLICATION</span><strong>What would you like to build?</strong><p>Start with the shape and outcome. The interview will work out everything else with you.</p></div>{apps.length > 0 && <button type="button" aria-label="Close application creator" onClick={() => setShowCreate(false)}><X/></button>}</header>
    <div className="simple-creator-fields"><label><span>Name</span><input aria-label="Application name" autoFocus placeholder="Customer research hub" value={newApp.name} onChange={(event) => setNewApp({ ...newApp, name: event.target.value })}/></label><label><span>What should people accomplish?</span><textarea aria-label="Desired outcome" placeholder="Describe the outcome in plain language…" value={newApp.description} onChange={(event) => setNewApp({ ...newApp, description: event.target.value })}/></label></div>
    <fieldset><legend>Application type</legend><div className="simple-choice-grid">{applicationTypes.map(([id, name, description]) => <button type="button" key={id} className={newApp.profile.applicationType === id ? 'selected' : ''} onClick={() => chooseApplicationType(id)}><strong>{name}</strong><small>{description}</small></button>)}</div></fieldset>
    <fieldset><legend>Who will use it?</legend><div className="tenancy-choice-row">{tenancyChoices.map(([id, name, description]) => <button type="button" key={id} className={newApp.profile.tenancyMode === id ? 'selected' : ''} onClick={() => chooseTenancy(id)}><strong>{name}</strong><small>{description}</small></button>)}</div></fieldset>
    <footer><span><Sparkles/> Identity, data sensitivity, workflows, and agent needs will be discovered with you.</span><button disabled={!newApp.name.trim() || !newApp.description.trim() || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin"/> : <Plus/>} Start interview</button></footer>
  </form></div>;

  if (!loaded) return <div className="browser-empty"><LoaderCircle className="spin"/><h2>Loading applications…</h2></div>;

  if (showLibrary || !detail) return <div className="application-library">
    <header className="application-library-heading"><div><span>APPLICATIONS</span><h2>What are you building?</h2><p>Start something new or continue an existing application.</p></div><button onClick={() => setShowCreate(true)}><Plus/> New application</button></header>
    {error && <div className="browser-error"><CircleAlert/>{error}</div>}
    {apps.length ? <div className="application-card-grid">{apps.map((app) => <article key={app.id}>
      <div className="application-card-icon"><Sparkles/></div><div className="application-card-status"><i className={app.lifecycleStatus}/>{app.lifecycleStatus.replaceAll('_', ' ')}</div>
      <h3>{app.name}</h3><p>{app.description}</p>
      <div className="application-card-meta"><span>{app.profile.applicationType.replaceAll('_', ' ')}</span><span>{tenancyChoices.find(([id]) => id === app.profile.tenancyMode)?.[1]}</span><span>spec v{app.specRevision}</span></div>
      <footer><button onClick={() => void openApplication(app.id, app.lifecycleStatus === 'draft' || app.lifecycleStatus === 'specifying' ? 'define' : 'review')}>{app.lifecycleStatus === 'draft' || app.lifecycleStatus === 'specifying' ? <FileText/> : <Play/>}{app.lifecycleStatus === 'draft' || app.lifecycleStatus === 'specifying' ? 'Continue interview' : 'Open application'}</button>{app.release && <a href={app.url} target="_blank" rel="noreferrer" aria-label={`Open ${app.name} production`}><ExternalLink/></a>}</footer>
    </article>)}</div> : <div className="application-library-empty"><Sparkles/><h3>Your first application starts with a conversation</h3><p>No schemas or technical forms required.</p><button onClick={() => setShowCreate(true)}><Plus/> Start an application</button></div>}
    {createDialog}
  </div>;

  return <div className="simple-application-workspace">
    <header className="simple-workspace-header"><button className="back-to-apps" onClick={() => setShowLibrary(true)}><ArrowLeft/> Applications</button><div><span>{detail.app.profile.applicationType.replaceAll('_', ' ')}</span><strong>{detail.app.name}</strong></div><nav>{([
      ['define', 'Define', FileText], ['build', 'Build', Rocket], ['review', 'Preview', Play], ['settings', 'Settings', Settings],
    ] as Array<[WorkspaceArea, string, typeof FileText]>).map(([id, label, Icon]) => <button key={id} className={area === id ? 'active' : ''} onClick={() => setArea(id)}><Icon/>{label}{id === 'build' && generationActive && <i/>}</button>)}</nav>{activeRelease && <a href={detail.app.url} target="_blank" rel="noreferrer">Open production <ExternalLink/></a>}</header>

    {notice && <div className="simple-notice"><Check/>{notice}</div>}
    {error && <div className="browser-error"><CircleAlert/>{error}<button aria-label="Dismiss error" onClick={() => setError(undefined)}><X/></button></div>}

    {area === 'define' && <ApplicationDiscovery appId={detail.app.id} appName={detail.app.name} specification={detail.specification} options={generationOptions} approved={detail.app.specificationApprovalStatus === 'approved'} confirming={busy === 'confirm'} onSpecificationUpdated={refreshApplication} onConfirm={confirmDefinition} onError={setError}/>}

    {area === 'build' && <section className="build-experience">
      <header><div><span>BUILD APPLICATION</span><h2>Turn the confirmed definition into a working app</h2><p>The platform chooses a balanced specialist team by default. You can watch every meaningful stage and review the result before publishing.</p></div><div className={detail.app.specificationApprovalStatus === 'approved' ? 'build-ready' : 'build-not-ready'}>{detail.app.specificationApprovalStatus === 'approved' ? <Check/> : <CircleAlert/>}<span><strong>{detail.app.specificationApprovalStatus === 'approved' ? `Specification v${detail.app.specRevision} confirmed` : 'Definition not confirmed'}</strong><small>{generator?.name ?? 'No compatible generator'}</small></span></div></header>
      {!generationJob || !generationActive && generationJob.status !== 'completed' ? <div className="build-launch-card"><div className="build-orb"><Sparkles/></div><div><strong>Build the complete experience</strong><p>Pages, MongoDB data contracts, workflows, visual design, browser agents, security boundaries, and acceptance evidence will be generated together.</p></div><button onClick={() => void generate()} disabled={Boolean(busy) || detail.app.specificationApprovalStatus !== 'approved' || !generator?.available}>{busy === 'generate' ? <LoaderCircle className="spin"/> : <Rocket/>} Build my app</button></div> : null}

      {generationJob && <div className={`build-progress-card ${generationJob.status}`}>
        <header><div><span>BUILD RUN</span><strong>{friendlyPhase(generationJob)}</strong><small>{generationJob.status === 'completed' ? `Preview ${generationJob.result?.previewVersion} passed verification.` : `${generationJob.progress}% complete`}</small></div><div className="build-progress-number">{generationJob.progress}%</div></header>
        <div className="generation-progress-track"><i style={{ width: `${generationJob.progress}%` }}/></div>
        <div className="friendly-build-stages">{['Designing experience', 'Building pages and data', 'Adding workflows and agents', 'Verifying behavior', 'Preparing preview'].map((label, index) => { const threshold = [12, 35, 60, 78, 96][index]!; const complete = generationJob.progress >= threshold; const current = !complete && generationJob.progress >= (index ? [12, 35, 60, 78][index - 1]! : 0); return <span key={label} className={complete ? 'complete' : current ? 'current' : ''}>{complete ? <Check/> : current ? <LoaderCircle className="spin"/> : <Clock3/>}{label}</span>; })}</div>
        <div className="build-workers">{generationJob.workers.map((worker) => <article key={worker.templateId} className={worker.status}><span>{worker.status === 'running' ? <LoaderCircle className="spin"/> : worker.status === 'completed' ? <Check/> : worker.status === 'failed' ? <CircleAlert/> : <Clock3/>}</span><div><strong>{worker.name}</strong><small>{worker.status === 'running' ? 'Working now' : worker.status}{worker.metrics ? ` · ${worker.metrics.inputTokens + worker.metrics.outputTokens} tokens · ${worker.metrics.reasoningTokens} reasoning · ${worker.metrics.toolCalls} tools` : ''}</small></div></article>)}</div>
        <p className="safe-activity-note">Reasoning summaries and tool calls are visible. Private chain-of-thought and credentials are never exposed.</p>
        <details className="build-activity" open={generationActive || generationJob.status === 'completed'}><summary><span><Wrench/> Detailed agent and tool activity</span><em>{generationJob.events.length}</em></summary><div>{generationJob.events.slice().sort((a, b) => b.sequence - a.sequence).map((event) => <article key={event.id} className={event.type}><span>{event.type === 'tool' ? <Wrench/> : event.type === 'result' ? <Check/> : event.type === 'error' || event.type === 'warning' ? <CircleAlert/> : <Bot/>}</span><div><small>{event.actor}</small><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</div></article>)}</div></details>
        {generationActive && <button className="cancel-build" onClick={() => void cancelGeneration()}><X/> Cancel build</button>}
        {generationJob.status === 'completed' && <div className="build-complete-actions"><button onClick={() => setArea('review')}><Play/> Review working app</button><span>Production has not changed.</span></div>}
        {generationJob.error && <div className="build-error"><CircleAlert/><div><strong>No preview was published</strong><p>{generationJob.error}</p></div></div>}
      </div>}

      <details className="advanced-build-settings"><summary>Advanced build settings</summary><div><label>Build instruction<textarea aria-label="Build instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)}/></label>{generationProfile?.agents.map((worker, index) => { const selectedConnector = connectorById.get(worker.connector); return <article key={`${worker.templateId}-${index}`}><strong>{worker.name}</strong><label>Connector<select aria-label={`${worker.name} connector`} value={worker.connector} onChange={(event) => { const connector = connectorById.get(event.target.value); const model = connector?.models.find((candidate) => candidate.preferred)?.id ?? connector?.models[0]?.id; updateGenerationAgent(index, { connector: event.target.value, ...(model ? { model } : {}) }); }}>{generationOptions?.connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.name}{connector.configured ? '' : ' · unavailable'}</option>)}</select></label><label>Model<select aria-label={`${worker.name} model`} value={worker.model} onChange={(event) => updateGenerationAgent(index, { model: event.target.value })}>{selectedConnector?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Effort<select aria-label={`${worker.name} reasoning effort`} value={worker.effort} onChange={(event) => updateGenerationAgent(index, { effort: event.target.value as GenerationEffort })}>{generationOptions?.efforts.map((effort) => <option key={effort.id} value={effort.id}>{effort.name}</option>)}</select></label></article>; })}</div></details>
    </section>}

    {area === 'review' && <section className="review-experience">
      <header><div><span>PREVIEW & RELEASES</span><h2>Review the actual application</h2><p>The preview is isolated from production. Publish only after the experience is correct.</p></div>{previewRelease && <button className="publish-preview" onClick={() => void promotePreview()} disabled={Boolean(busy)}>{busy === 'promote' ? <LoaderCircle className="spin"/> : <Rocket/>} Publish this preview</button>}</header>
      <div className="app-preview-shell"><div className="app-preview-toolbar"><span><i/>{previewUrl ? 'Verified preview' : activeRelease ? 'Production' : 'No application build yet'}</span><div>{previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">Open preview <ExternalLink/></a>}{activeRelease && <a href={detail.app.url} target="_blank" rel="noreferrer">Open production <ExternalLink/></a>}</div></div>{previewUrl || activeRelease ? <iframe title={`${detail.app.name} application preview`} src={previewUrl ?? detail.app.url}/> : <div className="empty-preview"><Rocket/><strong>Build a preview first</strong><button onClick={() => setArea('build')}>Go to build</button></div>}</div>
      <div className="release-summary-grid"><article><span>Definition</span><strong>v{detail.app.specRevision}</strong><small>{detail.app.specificationApprovalStatus}</small></article><article><span>Preview</span><strong>{previewRelease?.version ?? '—'}</strong><small>{previewRelease ? 'verified and isolated' : 'not available'}</small></article><article><span>Production</span><strong>{activeRelease?.version ?? '—'}</strong><small>{activeRelease ? 'currently live' : 'not published'}</small></article><article><span>Evidence</span><strong>{latestBuild?.tests ?? 0}</strong><small>admission checks</small></article></div>
      <details className="release-history"><summary>Release history and evidence</summary><div>{detail.releases.map((release) => <article key={release.id}><span className={release.status}>{release.status}</span><strong>{release.version}</strong><small>spec v{release.specRevision} · source v{release.sourceRevision} · {new Date(release.createdAt).toLocaleString()}</small></article>)}{latestBuild?.checks.map((check) => <article key={check.id}><span className={check.status}>{check.status}</span><strong>{check.label}</strong><small>{check.detail}</small></article>)}</div></details>
    </section>}

    {area === 'settings' && <section className="application-settings-experience">
      <header><span>APPLICATION SETTINGS</span><h2>Administration and technical details</h2><p>These controls are available when needed, without interrupting the product interview.</p></header>
      <details><summary><span><ShieldCheck/> Audience, tenancy, and members</span><small>{detail.tenancy.mode.replaceAll('_', ' ')}</small></summary><TenancyStudio detail={detail} onDetail={setDetail} onNotice={setNotice} onError={setError}/></details>
      <details><summary><span><Palette/> Visual design system</span><small>{detail.themes.find((theme) => theme.revision === detail.app.themeRevision)?.name ?? 'Theme'}</small></summary><VisualDesignStudio detail={detail} onDetail={setDetail} onNotice={setNotice} onError={setError}/></details>
      <details><summary><span><Globe2/> Domains and locations</span><small>{detail.bindings.length} bindings</small></summary><div className="settings-domain"><div>{detail.bindings.map((binding) => <span key={binding.id}>{binding.hostname}{binding.pathPrefix} · {binding.status}</span>)}</div><form onSubmit={addDomain}><input aria-label="Custom hostname" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="app.customer.com"/><button disabled={!domain.trim() || Boolean(busy)}>{busy === 'domain' ? <LoaderCircle className="spin"/> : <Plus/>} Add hostname</button></form></div></details>
      <details><summary><span><Code2/> Technical architecture</span><small>{detail.modules.length} modules · {detail.schemas.length} entities</small></summary><div className="technical-summary-grid"><article><FileText/><strong>Pages and modules</strong>{detail.routes.map((route) => <span key={route.id}>{route.path} → {route.pageModuleId}</span>)}</article><article><Database/><strong>MongoDB entities</strong>{detail.schemas.map((schema) => <span key={schema.id}>{schema.displayName} · {Object.keys((schema.jsonSchema.properties ?? {}) as object).length} fields</span>)}</article><article><Bot/><strong>Browser agents</strong>{detail.agents.map((agent) => <span key={agent.id}>{agent.name} · {agent.maximumIterations} turns</span>)}{!detail.agents.length && <span>No runtime agents</span>}</article><article><GitBranch/><strong>Connectors</strong>{detail.connectors.map((connector) => <span key={connector.id}>{connector.id}:{connector.action}</span>)}{!detail.connectors.length && <span>No runtime connectors</span>}</article></div></details>
    </section>}
    {createDialog}
  </div>;
}
