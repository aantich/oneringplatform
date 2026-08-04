import { useEffect, useMemo, useState } from 'react';
import { Bot, Box, Braces, Cable, Check, CircleAlert, ClipboardCheck, Code2, Database, ExternalLink, FileText, GitBranch, Globe2, LoaderCircle, Palette, Play, Plus, RefreshCw, Route, Save, ShieldCheck, Sparkles, Trash2, UsersRound } from 'lucide-react';
import { api } from '../api';
import type { AppStructuredSpecification, AppTenancyMode, BrowserAppDetail, BrowserAppModule, BrowserAppSummary, BrowserGenerationAgentConfiguration, BrowserGenerationOptions, BrowserGenerationProfile, GenerationEffort } from '../types';
import { VisualDesignStudio } from './VisualDesignStudio';
import { TenancyStudio } from './TenancyStudio';

type Panel = 'requirements' | 'pages' | 'workflows' | 'tenancy' | 'design' | 'modules' | 'routes' | 'data' | 'security' | 'agents' | 'connectors' | 'evidence';

const panels: Array<{ id: Panel; label: string; icon: typeof Box }> = [
  { id: 'requirements', label: 'Living requirements', icon: FileText },
  { id: 'pages', label: 'Pages & states', icon: Route },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'tenancy', label: 'Users & tenancy', icon: UsersRound },
  { id: 'design', label: 'Visual design', icon: Palette },
  { id: 'modules', label: 'Modules', icon: Code2 },
  { id: 'routes', label: 'Routes', icon: Route },
  { id: 'data', label: 'Data model', icon: Database },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'agents', label: 'Browser agents', icon: Sparkles },
  { id: 'connectors', label: 'Connectors', icon: Cable },
  { id: 'evidence', label: 'Release evidence', icon: ClipboardCheck },
];

function profileForApp(detail: BrowserAppDetail, options: BrowserGenerationOptions): BrowserGenerationProfile {
  const stored = detail.app.generationProfile;
  if (!stored?.agents.length) return structuredClone(options.defaultProfile);
  const configuredConnectorExists = options.connectors.some((connector) => connector.configured);
  const agents = stored.agents.slice(0, options.maximumAgents).flatMap((configuration) => {
    const template = options.agents.find((candidate) => candidate.id === configuration.templateId);
    if (!template) return [];
    const connector = options.connectors.find((candidate) => candidate.id === configuration.connector);
    const available = connector && (!configuredConnectorExists || connector.configured)
      && connector.models.some((model) => model.id === configuration.model);
    return [{
      ...(available ? configuration : template.defaultConfiguration),
      templateVersion: template.defaultConfiguration.templateVersion,
      name: template.name,
      role: template.role,
    }];
  });
  return agents.length ? { agents, updatedAt: stored.updatedAt } : structuredClone(options.defaultProfile);
}

export function BrowserAppsStudio() {
  const [apps, setApps] = useState<BrowserAppSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<BrowserAppDetail>();
  const [generationOptions, setGenerationOptions] = useState<BrowserGenerationOptions>();
  const [generationProfile, setGenerationProfile] = useState<BrowserGenerationProfile>();
  const [selectedAppId, setSelectedAppId] = useState<string>();
  const [panel, setPanel] = useState<Panel>('tenancy');
  const [selectedModule, setSelectedModule] = useState<BrowserAppModule>();
  const [instruction, setInstruction] = useState('Refine the visual hierarchy while preserving every security contract.');
  const [domain, setDomain] = useState('pulse.customer.localhost');
  const [busy, setBusy] = useState<'generate' | 'build' | 'create'>();
  const [showCreate, setShowCreate] = useState(false);
  const [newApp, setNewApp] = useState<{ name: string; description: string; mode: AppTenancyMode }>({ name: '', description: '', mode: 'team' });
  const [requirements, setRequirements] = useState<BrowserAppDetail['specification']['sections']>([]);
  const [structure, setStructure] = useState<AppStructuredSpecification>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    try {
      const [list, options] = await Promise.all([api.browserApps(), api.browserGenerationOptions()]);
      setGenerationOptions(options);
      setApps(list);
      const target = list.find((item) => item.id === selectedAppId) ?? list[0];
      if (target) {
        const next = await api.browserApp(target.id);
        setSelectedAppId(target.id);
        setDetail(next);
        setGenerationProfile(profileForApp(next, options));
        setRequirements(structuredClone(next.specification.sections));
        setStructure(structuredClone(next.specification.structure));
        setSelectedModule((current) => next.modules.find((item) => item.id === current?.id) ?? next.modules[0]);
      } else {
        setSelectedAppId(undefined);
        setDetail(undefined);
        setGenerationProfile(structuredClone(options.defaultProfile));
        setStructure(undefined);
        setSelectedModule(undefined);
      }
      setError(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load browser apps'); }
    finally { setLoaded(true); }
  }

  useEffect(() => { void load(); }, []);
  const app = apps.find((item) => item.id === detail?.app.id);
  const activeRelease = detail?.releases.find((release) => release.status === 'active');
  const previewRelease = detail?.releases.find((release) => release.status === 'preview');
  const latestBuild = detail?.builds[0];
  const roles = useMemo(() => detail?.policies[0] ? Object.entries(detail.policies[0].grants) : [], [detail]);
  const specificationCurrent = detail ? detail.app.generatedFromSpecRevision === detail.app.specRevision : true;
  const previewUrl = previewRelease?.previewToken && app ? `${app.url}?preview=${encodeURIComponent(previewRelease.id)}&token=${encodeURIComponent(previewRelease.previewToken)}` : undefined;

  async function generate() {
    if (!app || !generationProfile || busy) return;
    setBusy('generate'); setNotice(undefined);
    try {
      const result = await api.generateBrowserApp(app.id, instruction, generationProfile);
      setDetail(result.detail);
      setGenerationProfile(result.detail.app.generationProfile ?? generationProfile);
      setApps(await api.browserApps());
      const team = result.plan.workers.map((worker) => worker.name).join(' + ');
      setNotice(`${result.plan.agent === 'oneringai' ? team : 'Safe fallback'} prepared source revision ${result.detail.app.sourceRevision} for preview after ${result.attempts ?? 1} verification attempt${(result.attempts ?? 1) === 1 ? '' : 's'}: ${result.plan.headline}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Generation failed'); }
    finally { setBusy(undefined); }
  }

  async function selectApp(appId: string) {
    setSelectedAppId(appId); setError(undefined); setNotice(undefined);
    try {
      const next = await api.browserApp(appId); setDetail(next); setRequirements(structuredClone(next.specification.sections)); setStructure(structuredClone(next.specification.structure)); setSelectedModule(next.modules[0]);
      if (generationOptions) setGenerationProfile(profileForApp(next, generationOptions));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open application'); }
  }

  async function createApp(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !newApp.name.trim() || !newApp.description.trim()) return;
    setBusy('create'); setError(undefined);
    try {
      const result = await api.createBrowserApp(newApp);
      const list = await api.browserApps(); setApps(list); setDetail(result.detail); setSelectedAppId(result.detail.app.id);
      if (generationOptions) setGenerationProfile(profileForApp(result.detail, generationOptions));
      setSelectedModule(result.detail.modules[0]); setRequirements(structuredClone(result.detail.specification.sections)); setStructure(structuredClone(result.detail.specification.structure)); setShowCreate(false); setNewApp({ name: '', description: '', mode: 'team' });
      setNotice(`${result.detail.app.name} was created and published with an isolated application graph.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create application'); }
    finally { setBusy(undefined); }
  }

  async function saveRequirements() {
    if (!detail || !structure || busy) return;
    setBusy('build'); setError(undefined); setNotice(undefined);
    try {
      const result = await api.reviseBrowserAppSpecification(detail.app.id, detail.specification.revision, requirements, structure);
      setDetail(result.detail); setRequirements(structuredClone(result.detail.specification.sections)); setStructure(structuredClone(result.detail.specification.structure));
      setNotice(`Living specification revision ${result.detail.specification.revision} is authoritative. The current source is now marked for regeneration.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save requirements'); }
    finally { setBusy(undefined); }
  }

  async function build() {
    if (!app || busy) return;
    setBusy('build'); setNotice(undefined);
    try {
      const result = await api.buildBrowserApp(app.id);
      setDetail(result.detail);
      setNotice(`Preview ${result.detail.releases.find((release) => release.status === 'preview')?.version ?? result.detail.releases[0]?.version} passed every admission gate. Production is unchanged until promotion.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Build failed'); }
    finally { setBusy(undefined); }
  }

  async function promotePreview() {
    if (!app || !previewRelease || busy) return;
    setBusy('build'); setError(undefined); setNotice(undefined);
    try {
      const result = await api.promoteBrowserAppRelease(app.id, previewRelease.id);
      setDetail(result.detail); setApps(await api.browserApps());
      setNotice(`Release ${result.detail.releases.find((release) => release.status === 'active')?.version} is now active. The exact verified preview artifact was promoted without rebuilding.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Release promotion failed'); }
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

  function addSpecifiedPage() {
    if (!structure) return;
    let suffix = structure.pages.length + 1;
    while (structure.pages.some((page) => page.id === `page-new-${suffix}`)) suffix += 1;
    const id = `page-new-${suffix}`;
    setStructure({
      ...structure,
      pages: [...structure.pages, {
        id, name: `New page ${suffix}`, path: `/new-page-${suffix}`, purpose: 'Describe what this page enables for its users.',
        public: false, roleIds: ['viewer', 'editor', 'admin'], states: ['loading', 'empty', 'error', 'forbidden', 'ready'],
        entityIds: [], workflowIds: [], agentIds: [], acceptanceCriterionIds: [],
      }],
    });
  }

  function addSpecifiedEntity() {
    if (!structure) return;
    let suffix = structure.entities.length + 1;
    while (structure.entities.some((entity) => entity.id === `entity-${suffix}`)) suffix += 1;
    setStructure({
      ...structure,
      entities: [...structure.entities, {
        id: `entity-${suffix}`, name: `Entity ${suffix}`, description: 'Describe the records people manage.',
        fields: [{ id: 'name', type: 'string', required: true, description: 'Human-readable name.' }],
      }],
    });
  }

  function addSpecifiedAgent() {
    if (!structure) return;
    let suffix = structure.agents.length + 1;
    while (structure.agents.some((agent) => agent.id === `agent-${suffix}`)) suffix += 1;
    setStructure({
      ...structure,
      agents: [...structure.agents, {
        id: `agent-${suffix}`, name: `Agent ${suffix}`, purpose: 'Help the user complete one bounded browser workflow.',
        connector: 'openai-main', model: 'gpt-5.4-mini', toolIds: [], maximumIterations: 4, humanApprovalRequired: false,
      }],
    });
  }

  function addSpecifiedWorkflow() {
    if (!structure) return;
    let suffix = structure.workflows.length + 1;
    while (structure.workflows.some((workflow) => workflow.id === `workflow-${suffix}`)) suffix += 1;
    setStructure({
      ...structure,
      workflows: [...structure.workflows, {
        id: `workflow-${suffix}`, name: `Workflow ${suffix}`, description: 'Describe the outcome of this browser workflow.',
        trigger: 'The user starts this workflow.', steps: [{ id: 'start', type: 'browser_action', description: 'Collect the required user input.' }],
      }],
      pages: structure.pages.map((page, index) => index === 0 ? { ...page, workflowIds: [...page.workflowIds, `workflow-${suffix}`] } : page),
    });
  }

  function updateGenerationAgent(index: number, patch: Partial<BrowserGenerationAgentConfiguration>) {
    if (!generationProfile) return;
    setGenerationProfile({
      ...generationProfile,
      agents: generationProfile.agents.map((agent, agentIndex) => agentIndex === index ? { ...agent, ...patch } : agent),
    });
  }

  function selectGenerationTemplate(index: number, templateId: string) {
    const template = generationOptions?.agents.find((candidate) => candidate.id === templateId);
    if (template) updateGenerationAgent(index, structuredClone(template.defaultConfiguration));
  }

  function selectGenerationConnector(index: number, connectorId: string) {
    const connector = generationOptions?.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector) return;
    const model = connector.models.find((candidate) => candidate.preferred)?.id ?? connector.models[0]?.id;
    if (model) updateGenerationAgent(index, { connector: connector.id, model });
  }

  function addGenerationAgent() {
    if (!generationOptions || !generationProfile || generationProfile.agents.length >= generationOptions.maximumAgents) return;
    const used = new Set(generationProfile.agents.map((agent) => agent.templateId));
    const template = generationOptions.agents.find((candidate) => !used.has(candidate.id));
    if (template) setGenerationProfile({ ...generationProfile, agents: [...generationProfile.agents, structuredClone(template.defaultConfiguration)] });
  }

  function removeGenerationAgent(index: number) {
    if (!generationProfile || generationProfile.agents.length <= 1) return;
    setGenerationProfile({ ...generationProfile, agents: generationProfile.agents.filter((_, agentIndex) => agentIndex !== index) });
  }

  const createForm = showCreate && <form onSubmit={createApp}><input aria-label="New app name" placeholder="Application name" value={newApp.name} onChange={(event) => setNewApp({ ...newApp, name: event.target.value })}/><input aria-label="New app description" placeholder="What does it help people do?" value={newApp.description} onChange={(event) => setNewApp({ ...newApp, description: event.target.value })}/><select aria-label="New app audience" value={newApp.mode} onChange={(event) => setNewApp({ ...newApp, mode: event.target.value as AppTenancyMode })}><option value="personal">Personal</option><option value="team">Team</option><option value="multi_organization">Multi-organization</option></select><button disabled={Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" /> : <Plus />} Create & publish</button></form>;

  if (error && !detail) return <div className="browser-empty"><ShieldCheck /><h2>Browser app runtime unavailable</h2><p>{error}</p><button onClick={() => void load()}>Retry connection</button></div>;
  if (loaded && !apps.length) return <div className="browser-empty"><Box /><h2>Create the first app in this Mongo-backed workspace</h2><p>This platform organization owns its apps, releases, end tenants, and runtime data.</p><section className="app-switcher-bar empty-app-creator"><button onClick={() => setShowCreate((value) => !value)}><Plus /> New app</button>{createForm}</section></div>;
  if (!detail || !app) return <div className="browser-empty"><LoaderCircle className="spin" /><h2>Loading Mongo-native application graph</h2></div>;

  return <div className="browser-studio">
    <section className="app-switcher-bar">
      <label><span>Browser application</span><select value={detail.app.id} onChange={(event) => void selectApp(event.target.value)}>{apps.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.tenancyMode.replaceAll('_', ' ')}</option>)}</select></label>
      <button onClick={() => setShowCreate((value) => !value)}><Plus /> New app</button>
      {createForm}
    </section>
    <section className="browser-hero">
      <div className="browser-hero-copy"><div className="mode-kicker"><Sparkles size={13} /> BROWSER-NATIVE · MONGO DATA · CLIENT AGENTS</div><h2>{app.name}</h2><p>{app.description}</p><div className="browser-meta"><span><Check size={13} /> MongoDB connected</span><span><Check size={13} /> Production {activeRelease?.version ?? 'not promoted'}</span><span className={specificationCurrent ? '' : 'browser-meta-warning'}>{specificationCurrent ? <Check size={13} /> : <CircleAlert size={13} />} Spec v{detail.app.specRevision} {specificationCurrent ? 'implemented' : 'needs generation'}</span><span><Check size={13} /> {detail.tenancy.mode === 'personal' ? 'Personal' : detail.tenancy.mode === 'team' ? 'Team workspace' : `${detail.endTenants.length} organizations`}</span><span><Check size={13} /> No app server</span></div></div>
      <div className="browser-hero-actions">{activeRelease && <a className="launch-app" href={app.url} target="_blank" rel="noreferrer"><Play size={16} fill="currentColor" /> Open production <ExternalLink size={14} /></a>}{previewUrl && <a className="launch-app launch-app--preview" href={previewUrl} target="_blank" rel="noreferrer"><Play size={16} /> Review preview <ExternalLink size={14} /></a>}{previewRelease && <button className="promote-preview" onClick={() => void promotePreview()} disabled={Boolean(busy)}><Check size={15} /> Promote verified preview</button>}<button onClick={() => void build()} disabled={Boolean(busy)}>{busy === 'build' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Verify new preview</button></div>
    </section>

    <section className="browser-stats">
      <article><Code2 /><div><strong>{detail.modules.length}</strong><span>versioned modules</span></div></article>
      <article><Route /><div><strong>{detail.routes.length}</strong><span>browser routes</span></div></article>
      <article><Database /><div><strong>{detail.schemas.length}</strong><span>secured entities</span></div></article>
      <article><ShieldCheck /><div><strong>{roles.length}</strong><span>standard roles</span></div></article>
      <article><Braces /><div><strong>{latestBuild?.tests ?? 0}</strong><span>release checks</span></div></article>
    </section>

    <section className="agent-generation-card">
      <div className="agent-generation-heading">
        <div className="agent-orb"><Sparkles /></div>
        <div className="agent-generation-copy"><span>ONERINGAI GENERATION TEAM</span><strong>Choose who builds the next traceable revision</strong><p>Each specialist runs through the selected connector and model. The server validates the configuration, keeps credentials outside the browser, and pins the exact team to the resulting preview.</p></div>
        {generationOptions && generationProfile && <button className="add-generation-agent" onClick={addGenerationAgent} disabled={generationProfile.agents.length >= generationOptions.maximumAgents || Boolean(busy)}><Plus /> Add specialist</button>}
      </div>
      {generationOptions && generationProfile ? <div className="generation-team" aria-label="Generation team">
        {generationProfile.agents.map((worker, index) => {
          const connector = generationOptions.connectors.find((candidate) => candidate.id === worker.connector);
          const configuredConnectorExists = generationOptions.connectors.some((candidate) => candidate.configured);
          return <article className="generation-worker" key={`${worker.templateId}-${index}`}>
            <span className="generation-worker-index"><Bot />{index + 1}</span>
            <label><span>Specialist</span><select aria-label={`Generation specialist ${index + 1}`} value={worker.templateId} onChange={(event) => selectGenerationTemplate(index, event.target.value)}>{generationOptions.agents.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={generationProfile.agents.some((selected, selectedIndex) => selectedIndex !== index && selected.templateId === candidate.id)}>{candidate.name} · {candidate.stage}</option>)}</select><small>{worker.role}</small></label>
            <label><span>Connector</span><select aria-label={`${worker.name} connector`} value={worker.connector} onChange={(event) => selectGenerationConnector(index, event.target.value)}>{generationOptions.connectors.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={configuredConnectorExists && !candidate.configured}>{candidate.name}{candidate.configured ? '' : ' · unavailable'}</option>)}</select><small>{connector?.configured ? 'Credential available' : 'Fallback only'}</small></label>
            <label><span>Model</span><select aria-label={`${worker.name} model`} value={worker.model} onChange={(event) => updateGenerationAgent(index, { model: event.target.value })}>{connector?.models.map((model) => <option key={model.id} value={model.id} title={model.description}>{model.name}{model.preferred ? ' · preferred' : ''}</option>)}</select><small>{connector?.vendor ?? 'Provider model'}</small></label>
            <label><span>Reasoning effort</span><select aria-label={`${worker.name} reasoning effort`} value={worker.effort} onChange={(event) => updateGenerationAgent(index, { effort: event.target.value as GenerationEffort })}>{generationOptions.efforts.map((effort) => <option key={effort.id} value={effort.id} title={effort.description}>{effort.name}</option>)}</select><small>{generationOptions.efforts.find((effort) => effort.id === worker.effort)?.description}</small></label>
            <button className="remove-generation-agent" aria-label={`Remove ${worker.name}`} title="Remove specialist" onClick={() => removeGenerationAgent(index)} disabled={generationProfile.agents.length <= 1 || Boolean(busy)}><Trash2 /></button>
          </article>;
        })}
      </div> : <div className="generation-options-loading"><LoaderCircle className="spin" /> Loading generation capabilities…</div>}
      <div className="agent-generation-form"><input aria-label="Generation instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} /><button onClick={() => void generate()} disabled={Boolean(busy) || !generationProfile}>{busy === 'generate' ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} Generate preview</button></div>
    </section>
    {notice && <div className="browser-notice"><Check size={16} />{notice}</div>}
    {error && <div className="browser-error">{error}</div>}

    <section className="browser-workbench">
      <aside className="workbench-nav">{panels.map((item) => <button key={item.id} className={panel === item.id ? 'active' : ''} onClick={() => setPanel(item.id)}><item.icon size={16} />{item.label}<span>{item.id === 'requirements' ? detail.specification.revision : item.id === 'pages' ? detail.specification.structure.pages.length : item.id === 'workflows' ? detail.specification.structure.workflows.length : item.id === 'tenancy' ? detail.tenancy.revision : item.id === 'design' ? detail.app.themeRevision : item.id === 'modules' ? detail.modules.length : item.id === 'routes' ? detail.routes.length : item.id === 'data' ? detail.schemas.length : item.id === 'security' ? roles.length : item.id === 'agents' ? detail.agents.length : item.id === 'evidence' ? latestBuild?.checks.length ?? 0 : detail.connectors.length}</span></button>)}</aside>
      <div className="workbench-content">
        {panel === 'requirements' && structure && <div className="requirements-editor"><div className="workbench-heading"><div><span>Authoritative application specification</span><small>Saving a revision marks generated source as outdated until a verified graph revision implements it.</small></div><button onClick={() => void saveRequirements()} disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" /> : <Save />} Save specification</button></div><article className="spec-purpose"><label>Application purpose<textarea value={structure.purpose} onChange={(event) => setStructure({ ...structure, purpose: event.target.value })}/></label><div className="spec-contract-summary"><span>{structure.pages.length} pages</span><span>{structure.entities.length} entities</span><span>{structure.workflows.length} workflows</span><span>{structure.agents.length} agents</span><span>{structure.acceptanceCriteria.length} acceptance criteria</span></div></article>{requirements.map((section, index) => <article key={section.id}><label>Stable ID<input value={section.id} disabled /></label><label>Section title<input value={section.title} onChange={(event) => setRequirements(requirements.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))}/></label><label>Requirement<textarea value={section.body} onChange={(event) => setRequirements(requirements.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))}/></label></article>)}<div className="acceptance-list"><div className="workbench-heading"><span>Executable acceptance contract</span><small>Every criterion references a stable requirement ID.</small></div>{structure.acceptanceCriteria.map((criterion) => <article key={criterion.id}><strong>{criterion.description}</strong><span>{criterion.kind}</span><code>{criterion.requirementId}</code></article>)}</div></div>}
        {panel === 'pages' && structure && <div className="page-spec-grid"><div className="workbench-heading"><div><span>Pages are independent specification nodes</span><small>Routes, states, roles, data, workflows and agents remain traceable separately.</small></div><button onClick={addSpecifiedPage}><Plus /> Add page</button></div>{structure.pages.map((page, index) => <article key={page.id}><div><span className="definition-icon"><Route /></span><div><small>{page.id}</small><input aria-label={`${page.name} page name`} value={page.name} onChange={(event) => setStructure({ ...structure, pages: structure.pages.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })}/></div><input aria-label={`${page.name} page path`} value={page.path} onChange={(event) => setStructure({ ...structure, pages: structure.pages.map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) })}/></div><label>Purpose<textarea value={page.purpose} onChange={(event) => setStructure({ ...structure, pages: structure.pages.map((item, itemIndex) => itemIndex === index ? { ...item, purpose: event.target.value } : item) })}/></label><div className="page-state-list">{page.states.map((state) => <span key={state}>{state}</span>)}</div><div className="spec-reference-groups"><label>Data used on this page<div className="spec-reference-list">{structure.entities.map((entity) => <button key={entity.id} type="button" className={page.entityIds.includes(entity.id) ? 'selected' : ''} onClick={() => setStructure({ ...structure, pages: structure.pages.map((item, itemIndex) => itemIndex === index ? { ...item, entityIds: item.entityIds.includes(entity.id) ? item.entityIds.filter((id) => id !== entity.id) : [...item.entityIds, entity.id] } : item) })}>{entity.name}</button>)}</div></label><label>Browser agents used<div className="spec-reference-list">{structure.agents.map((agent) => <button key={agent.id} type="button" className={page.agentIds.includes(agent.id) ? 'selected' : ''} onClick={() => setStructure({ ...structure, pages: structure.pages.map((item, itemIndex) => itemIndex === index ? { ...item, agentIds: item.agentIds.includes(agent.id) ? item.agentIds.filter((id) => id !== agent.id) : [...item.agentIds, agent.id] } : item) })}>{agent.name}</button>)}</div></label></div><small>{page.roleIds.join(' · ')} · {page.entityIds.length} entities · {page.agentIds.length} agents</small>{structure.pages.length > 1 && <button className="remove-page" onClick={() => setStructure({ ...structure, pages: structure.pages.filter((item) => item.id !== page.id) })}>Remove page from next specification</button>}</article>)}</div>}
        {panel === 'workflows' && structure && <div className="workflow-spec-editor"><div className="workbench-heading"><div><span>Browser workflow contracts</span><small>Each step declares where work runs: browser UI, secure data gateway, browser-owned agent loop, decision, or human approval.</small></div><button onClick={addSpecifiedWorkflow}><Plus /> Add workflow</button></div>{structure.workflows.map((workflow, workflowIndex) => <article key={workflow.id}><div className="workflow-spec-title"><div><small>{workflow.id}</small><input aria-label={`${workflow.id} name`} value={workflow.name} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, name: event.target.value } : item) })}/></div><input aria-label={`${workflow.id} trigger`} value={workflow.trigger} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, trigger: event.target.value } : item) })}/></div><label>Outcome<textarea value={workflow.description} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, description: event.target.value } : item) })}/></label><div className="workflow-step-editor">{workflow.steps.map((step, stepIndex) => <div key={step.id}><input aria-label={`${workflow.id} step ${stepIndex + 1} ID`} value={step.id} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, steps: item.steps.map((candidate, candidateIndex) => candidateIndex === stepIndex ? { ...candidate, id: event.target.value } : candidate) } : item) })}/><select value={step.type} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, steps: item.steps.map((candidate, candidateIndex) => candidateIndex === stepIndex ? { ...candidate, type: event.target.value as typeof step.type } : candidate) } : item) })}>{['browser_action', 'data_read', 'data_write', 'agent', 'decision', 'human_approval'].map((type) => <option key={type}>{type}</option>)}</select><input aria-label={`${step.id} description`} value={step.description} onChange={(event) => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, steps: item.steps.map((candidate, candidateIndex) => candidateIndex === stepIndex ? { ...candidate, description: event.target.value } : candidate) } : item) })}/>{workflow.steps.length > 1 && <button type="button" onClick={() => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, steps: item.steps.filter((_, candidateIndex) => candidateIndex !== stepIndex) } : item) })}>Remove</button>}</div>)}</div><div className="entity-spec-actions"><button type="button" onClick={() => setStructure({ ...structure, workflows: structure.workflows.map((item, index) => index === workflowIndex ? { ...item, steps: [...item.steps, { id: `step-${item.steps.length + 1}`, type: 'browser_action', description: 'Describe this step.' }] } : item) })}><Plus /> Add step</button><button type="button" className="remove-page" onClick={() => setStructure({ ...structure, workflows: structure.workflows.filter((item) => item.id !== workflow.id), pages: structure.pages.map((page) => ({ ...page, workflowIds: page.workflowIds.filter((id) => id !== workflow.id) })) })}>Remove workflow</button></div></article>)}</div>}
        {panel === 'tenancy' && <TenancyStudio detail={detail} onDetail={setDetail} onNotice={(message) => { setNotice(message); setError(undefined); }} onError={setError} />}
        {panel === 'design' && <VisualDesignStudio detail={detail} onDetail={setDetail} onNotice={(message) => { setNotice(message); setError(undefined); }} onError={setError} />}
        {panel === 'modules' && <div className="module-browser"><div className="module-list"><div className="workbench-heading"><span>Component graph</span><small>revision {detail.app.sourceRevision}</small></div>{detail.modules.map((item) => <button key={item.id} className={selectedModule?.id === item.id ? 'active' : ''} onClick={() => setSelectedModule(item)}><span className={`module-kind kind-${item.kind}`}>{item.kind}</span><strong>{item.name}</strong><small>{item.description}</small><i>{item.contentHash.slice(0, 8)}</i><em>{item.requirementIds.join(' · ')}</em></button>)}</div><div className="source-view"><div><span><GitBranch size={14} /> app://module/{selectedModule?.id}</span><small>immutable · TSX · requirements {selectedModule?.requirementIds.join(', ')}</small></div><pre>{selectedModule?.source}</pre></div></div>}
        {panel === 'routes' && <div className="definition-grid">{detail.routes.map((route) => <article key={route.id}><span className="definition-icon"><Route /></span><div><small>{route.public ? 'PUBLIC ROUTE' : 'PROTECTED ROUTE'}</small><strong>{route.path}</strong><p>Renders <code>app://module/{route.pageModuleId}</code></p></div><span className="definition-status">BrowserRouter</span></article>)}<article className="route-binding-card"><span className="definition-icon"><Globe2 /></span><div><small>ACTIVE BINDINGS</small><strong>One release, multiple locations</strong>{detail.bindings.map((binding) => <p key={binding.id}>{binding.hostname}{binding.pathPrefix} · {binding.type.replaceAll('_', ' ')} · {binding.status}</p>)}<div className="domain-binding-form"><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="app.customer.com"/><button onClick={() => void addDomain()} disabled={Boolean(busy)}>Add & verify local domain</button></div></div><span className="definition-status">build once</span></article></div>}
        {panel === 'data' && structure && <div className="entity-spec-editor"><div className="workbench-heading"><div><span>Authoritative data model</span><small>Field changes compile into immutable Mongo schema and policy revisions. Physical collections remain server-derived.</small></div><button onClick={addSpecifiedEntity}><Plus /> Add entity</button></div>{structure.entities.map((entity, entityIndex) => <article key={entity.id}><div className="entity-spec-title"><div><small>{entity.id}</small><input aria-label={`${entity.id} entity name`} value={entity.name} onChange={(event) => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, name: event.target.value } : item) })}/></div><input aria-label={`${entity.id} entity description`} value={entity.description} onChange={(event) => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, description: event.target.value } : item) })}/></div><div className="entity-field-editor">{entity.fields.map((field, fieldIndex) => <div key={field.id}><input aria-label={`${entity.id} field ${fieldIndex + 1} ID`} value={field.id} onChange={(event) => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, fields: item.fields.map((candidate, candidateIndex) => candidateIndex === fieldIndex ? { ...candidate, id: event.target.value } : candidate) } : item) })}/><select aria-label={`${field.id} type`} value={field.type} onChange={(event) => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, fields: item.fields.map((candidate, candidateIndex) => candidateIndex === fieldIndex ? { ...candidate, type: event.target.value as typeof field.type } : candidate) } : item) })}>{['string', 'number', 'boolean', 'date', 'enum', 'object', 'array'].map((type) => <option key={type}>{type}</option>)}</select><label><input type="checkbox" checked={field.required} onChange={(event) => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, fields: item.fields.map((candidate, candidateIndex) => candidateIndex === fieldIndex ? { ...candidate, required: event.target.checked } : candidate) } : item) })}/> required</label>{entity.fields.length > 1 && <button type="button" onClick={() => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, fields: item.fields.filter((_, candidateIndex) => candidateIndex !== fieldIndex) } : item) })}>Remove</button>}</div>)}</div><div className="entity-spec-actions"><button type="button" onClick={() => setStructure({ ...structure, entities: structure.entities.map((item, index) => index === entityIndex ? { ...item, fields: [...item.fields, { id: `field-${item.fields.length + 1}`, type: 'string', required: false, description: 'Describe this field.' }] } : item) })}><Plus /> Add field</button><button type="button" className="remove-page" onClick={() => setStructure({ ...structure, entities: structure.entities.filter((item) => item.id !== entity.id), pages: structure.pages.map((page) => ({ ...page, entityIds: page.entityIds.filter((id) => id !== entity.id) })) })}>Remove entity</button></div></article>)}<div className="workbench-heading generated-contract-heading"><div><span>Currently generated contracts</span><small>These are the immutable revisions served by the current editor graph.</small></div></div><div className="definition-grid">{detail.schemas.map((schema) => <article key={schema.id}><span className="definition-icon"><Database /></span><div><small>{schema.deploymentMode.replaceAll('_', ' ')}</small><strong>{schema.displayName}</strong><p>Logical entity <code>{schema.entity}</code></p><div className="field-chips">{Object.keys((schema.jsonSchema.properties ?? {}) as object).map((field) => <span key={field}>{field}</span>)}</div></div><span className="definition-status">{schema.indexes.length} indexes</span></article>)}</div></div>}
        {panel === 'security' && <div className="role-matrix"><div className="workbench-heading"><span>Server-enforced role policy</span><small>UI hints never replace API authorization</small></div>{roles.map(([role, grant]) => <article key={role}><strong>{role}</strong><div>{['create','read','update','delete'].map((operation) => <span key={operation} className={grant.operations.includes(operation) ? 'allowed' : 'denied'}>{grant.operations.includes(operation) ? '✓' : '—'} {operation}</span>)}</div><small>{grant.writeFields.length ? `Writable: ${grant.writeFields.join(', ')}` : 'No writable fields'}</small></article>)}</div>}
        {panel === 'agents' && structure && <div className="agent-spec-editor"><div className="workbench-heading"><div><span>Browser-agent contracts</span><small>The browser owns iteration, state, tool sequencing, checkpoints and approvals; the backend only gates model turns and tools.</small></div><button onClick={addSpecifiedAgent}><Plus /> Add agent</button></div>{structure.agents.map((agent, index) => <article key={agent.id}><div><small>{agent.id}</small><input aria-label={`${agent.id} name`} value={agent.name} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })}/></div><label>Purpose<textarea value={agent.purpose} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, purpose: event.target.value } : item) })}/></label><div className="agent-contract-fields"><label>OneRingAI connector<input value={agent.connector} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, connector: event.target.value } : item) })}/></label><label>Model<input value={agent.model} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, model: event.target.value } : item) })}/></label><label>Iteration budget<input type="number" min="1" max="12" value={agent.maximumIterations} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, maximumIterations: Number(event.target.value) } : item) })}/></label><label className="approval-toggle"><input type="checkbox" checked={agent.humanApprovalRequired} onChange={(event) => setStructure({ ...structure, agents: structure.agents.map((item, itemIndex) => itemIndex === index ? { ...item, humanApprovalRequired: event.target.checked } : item) })}/> Require human approval</label></div><div className="field-chips">{agent.toolIds.length ? agent.toolIds.map((tool) => <span key={tool}>{tool}</span>) : <span>no tools · model-only loop</span>}</div><button className="remove-page" type="button" onClick={() => setStructure({ ...structure, agents: structure.agents.filter((item) => item.id !== agent.id), pages: structure.pages.map((page) => ({ ...page, agentIds: page.agentIds.filter((id) => id !== agent.id) })) })}>Remove agent</button></article>)}<div className="workbench-heading generated-contract-heading"><div><span>Generated runtime definitions</span><small>Tool IDs must resolve to allowlisted connector actions before release admission.</small></div></div><div className="definition-grid">{detail.agents.map((agent) => <article key={agent.id}><span className="definition-icon"><Sparkles /></span><div><small>BROWSER-OWNED LOOP · MAX {agent.maximumIterations} TURNS</small><strong>{agent.name}</strong><p>{agent.description}</p><div className="field-chips">{agent.allowedRoles.map((role) => <span key={role}>{role}</span>)}{agent.toolIds.map((tool) => <span key={tool}>{tool}</span>)}</div></div><span className="definition-status">{agent.connector}</span></article>)}</div></div>}
        {panel === 'connectors' && <div className="definition-grid">{detail.connectors.map((connector) => <article key={connector.id}><span className="definition-icon"><Cable /></span><div><small>ONERINGAI CONNECTOR GRANT</small><strong>{connector.id} / {connector.action}</strong><p>{connector.description}</p><div className="field-chips">{connector.allowedRoles.map((role) => <span key={role}>{role}</span>)}</div></div><span className="definition-status">{connector.rateLimitPerMinute}/min</span></article>)}</div>}
        {panel === 'evidence' && <div className="release-evidence"><div className="workbench-heading"><div><span>Release admission evidence</span><small>{latestBuild?.artifactDigest ?? 'No immutable artifact digest yet'}</small></div><span className={`evidence-status ${latestBuild?.status}`}>{latestBuild?.status ?? 'unknown'}</span></div>{latestBuild && <div className="acceptance-coverage"><strong>{latestBuild.acceptance.covered}/{latestBuild.acceptance.total}</strong><span>acceptance criteria traceably covered · spec v{latestBuild.specRevision}</span></div>}{latestBuild?.checks.map((check) => <article key={check.id}><span className={check.status}><Check /></span><div><strong>{check.label}</strong><p>{check.detail}</p></div><small>{check.durationMs} ms</small></article>)}</div>}
      </div>
    </section>
  </div>;
}
