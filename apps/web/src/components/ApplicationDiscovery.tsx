import { useEffect, useMemo, useState } from 'react';
import { Bot, Brain, Check, CircleAlert, Database, FileText, GitBranch, LayoutGrid, LoaderCircle, Palette, Route, Send, Sparkles, UsersRound, Wrench, X } from 'lucide-react';
import { api } from '../api';
import type { ApplicationDiscoverySession, BrowserAppDetail, BrowserGenerationOptions, GenerationEffort } from '../types';
import { ApplicationBlueprint } from './ApplicationBlueprint';

type DefinitionView = 'document' | 'blueprint';

export function ApplicationDiscovery({
  appId,
  appName,
  specification,
  options,
  approved,
  confirming,
  onSpecificationUpdated,
  onConfirm,
  onError,
}: {
  appId: string;
  appName: string;
  specification: BrowserAppDetail['specification'];
  options?: BrowserGenerationOptions;
  approved: boolean;
  confirming: boolean;
  onSpecificationUpdated: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [session, setSession] = useState<ApplicationDiscoverySession>();
  const [message, setMessage] = useState('');
  const [definitionView, setDefinitionView] = useState<DefinitionView>('document');
  const connectorDefault = options?.connectors.find((candidate) => candidate.configured) ?? options?.connectors[0];
  const [connector, setConnector] = useState(connectorDefault?.id ?? 'openai-main');
  const selectedConnector = options?.connectors.find((candidate) => candidate.id === connector) ?? connectorDefault;
  const [model, setModel] = useState(selectedConnector?.models.find((candidate) => candidate.preferred)?.id ?? selectedConnector?.models[0]?.id ?? 'gpt-5.6-terra');
  const [effort, setEffort] = useState<GenerationEffort>('high');

  const refresh = async () => {
    const next = await api.applicationDiscovery(appId);
    const revisionChanged = session && next.currentSpecRevision !== session.currentSpecRevision;
    setSession(next);
    if (revisionChanged) await onSpecificationUpdated();
    return next;
  };

  useEffect(() => {
    setSession(undefined);
    setMessage('');
    void refresh().catch((reason) => onError(reason instanceof Error ? reason.message : 'Unable to load discovery'));
  }, [appId]);
  useEffect(() => {
    if (connectorDefault && !options?.connectors.some((candidate) => candidate.id === connector)) setConnector(connectorDefault.id);
  }, [options]);
  useEffect(() => {
    const nextConnector = options?.connectors.find((candidate) => candidate.id === connector);
    if (nextConnector && !nextConnector.models.some((candidate) => candidate.id === model)) setModel(nextConnector.models.find((candidate) => candidate.preferred)?.id ?? nextConnector.models[0]?.id ?? model);
  }, [connector, options]);
  useEffect(() => {
    if (session?.status !== 'running') return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 450);
    return () => window.clearInterval(timer);
  }, [session?.status, session?.currentSpecRevision, appId]);

  const submit = async () => {
    if (!message.trim() || session?.status === 'running') return;
    try {
      const next = await api.startApplicationDiscovery(appId, message.trim(), { connector, model, effort });
      setSession(next);
      setMessage('');
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Unable to start discovery'); }
  };

  if (!session) return <div className="discovery-loading"><LoaderCircle className="spin"/> Preparing your interview…</div>;
  const workingSections = session.draft?.sections ?? specification.sections ?? [];
  const rawWorking = session.draft?.structure ?? specification.structure;
  const working = {
    ...rawWorking,
    personas: rawWorking.personas ?? [], userStories: rawWorking.userStories ?? [], roles: rawWorking.roles ?? [], pages: rawWorking.pages ?? [],
    entities: rawWorking.entities ?? [], workflows: rawWorking.workflows ?? [], agents: rawWorking.agents ?? [], integrations: rawWorking.integrations ?? [],
    decisions: rawWorking.decisions ?? [], qualityAttributes: rawWorking.qualityAttributes ?? [], acceptanceCriteria: rawWorking.acceptanceCriteria ?? [],
    designBrief: rawWorking.designBrief ?? { tone: 'Product-appropriate, clear, and accessible.', principles: [], accessibilityTarget: 'AA' as const },
  };
  const recentChanges = new Set(session.draft?.changes.slice(-5).map((change) => change.targetId) ?? []);
  const recentEvents = session.events.slice().sort((a, b) => b.sequence - a.sequence).slice(0, 18);
  const blocked = session.coverage.contradictions.length > 0;

  const changed = (id: string) => recentChanges.has(id) ? 'live-definition-card live-definition-card--changed' : 'live-definition-card';
  return <div className="definition-experience">
    <section className="interview-pane">
      <header className="interview-heading">
        <div><span>PRODUCT INTERVIEW</span><strong>Tell us what you want to build</strong><small>One useful question at a time. The application definition updates beside you.</small></div>
        <div className={`live-interview-state ${session.status}`}><i/>{session.status === 'running' ? 'Updating live' : 'Ready'}</div>
      </header>

      <div className="discovery-thread">{session.messages.length ? session.messages.map((entry) => <article key={entry.id} className={entry.role}><span>{entry.role === 'assistant' ? <Sparkles/> : 'YOU'}</span><div><small>{entry.role === 'assistant' ? 'Product guide' : 'You'}</small><p>{entry.content}</p></div></article>) : <div className="discovery-welcome"><Sparkles/><strong>What should {appName} help people accomplish?</strong><p>Describe the desired outcome in your own words. We will identify the users, workflows, data, rules, design, and agent behavior together.</p></div>}</div>

      {session.status === 'running' && <div className="interview-working"><LoaderCircle className="spin"/><div><strong>{session.phase.replaceAll('-', ' ')}</strong><span>{recentEvents[0]?.title ?? 'Understanding your answer'}</span></div></div>}

      <div className="discovery-composer"><textarea aria-label="Discovery answer" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Answer naturally—short or detailed is fine…" disabled={session.status === 'running'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}/><button onClick={() => void submit()} disabled={!message.trim() || session.status === 'running'}>{session.status === 'running' ? <LoaderCircle className="spin"/> : <Send/>}{session.status === 'running' ? 'Working…' : 'Send'}</button>{session.status === 'running' && <button className="discovery-cancel" aria-label="Cancel discovery update" onClick={() => void api.cancelApplicationDiscovery(appId).then(setSession)}><X/></button>}</div>

      <details className="interview-advanced"><summary>Interview model settings</summary><div className="discovery-profile-controls"><label>Connector<select value={connector} onChange={(event) => setConnector(event.target.value)} disabled={session.status === 'running'}>{options?.connectors.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={!candidate.configured && Boolean(options.connectors.some((item) => item.configured))}>{candidate.name}{candidate.configured ? '' : ' · unavailable'}</option>)}</select></label><label>Model<select value={model} onChange={(event) => setModel(event.target.value)} disabled={session.status === 'running'}>{selectedConnector?.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.preferred ? ' · preferred' : ''}</option>)}</select></label><label>Reasoning<select value={effort} onChange={(event) => setEffort(event.target.value as GenerationEffort)} disabled={session.status === 'running'}>{options?.efforts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label></div></details>

      <details className="interview-activity" open={session.status === 'running'}><summary><span><Brain/> Agent activity</span><em>{recentEvents.length}</em></summary><div>{recentEvents.map((event) => <article key={event.id} className={event.type}><span>{event.type === 'tool' ? <Wrench/> : event.type === 'specification' || event.type === 'result' ? <Check/> : event.type === 'error' ? <CircleAlert/> : <Brain/>}</span><div><small>{event.actor}</small><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</div></article>)}</div></details>
    </section>

    <aside className="live-definition-pane" aria-live="polite">
      <header><div><span>LIVE APPLICATION DEFINITION</span><strong>{working.purpose}</strong><small>Draft based on specification v{session.draft?.baseSpecRevision ?? specification.revision} · autosaved as agents work</small></div><div className="definition-view-switch"><button className={definitionView === 'document' ? 'active' : ''} onClick={() => setDefinitionView('document')}><FileText/> Document</button><button className={definitionView === 'blueprint' ? 'active' : ''} onClick={() => setDefinitionView('blueprint')}><LayoutGrid/> Blueprint</button></div></header>

      {definitionView === 'document' ? <div className="live-definition-document">
        <section className={changed('purpose')}><header><FileText/><strong>Product intent</strong><span>{workingSections.length} requirements</span></header><p>{working.purpose}</p><div className="definition-tags">{workingSections.slice(0, 6).map((section) => <span key={section.id}>{section.title}</span>)}</div></section>
        <section className="definition-pair">
          <article className="live-definition-card"><header><UsersRound/><strong>People</strong><span>{working.personas.length}</span></header>{working.personas.length ? working.personas.map((persona) => <div key={persona.id} className={recentChanges.has(persona.id) ? 'definition-node changed' : 'definition-node'}><strong>{persona.name}</strong><p>{persona.description}</p><small>{persona.goals.join(' · ')}</small></div>) : <p className="definition-empty">Personas will appear as the interview identifies them.</p>}</article>
          <article className="live-definition-card"><header><Sparkles/><strong>User stories</strong><span>{working.userStories.length}</span></header>{working.userStories.length ? working.userStories.map((story) => <div key={story.id} className={recentChanges.has(story.id) ? 'definition-node changed' : 'definition-node'}><strong>{story.title}</strong><p>{story.statement}</p><small>{story.priority}</small></div>) : <p className="definition-empty">Goals will become prioritized user stories.</p>}</article>
        </section>
        <section className="definition-pair">
          <article className="live-definition-card"><header><Route/><strong>Pages and experiences</strong><span>{working.pages.length}</span></header>{working.pages.map((page) => <div key={page.id} className={recentChanges.has(page.id) ? 'definition-node changed' : 'definition-node'}><strong>{page.name}</strong><code>{page.path}</code><p>{page.purpose}</p></div>)}</article>
          <article className="live-definition-card"><header><GitBranch/><strong>Workflows</strong><span>{working.workflows.length}</span></header>{working.workflows.map((workflow) => <div key={workflow.id} className={recentChanges.has(workflow.id) ? 'definition-node changed' : 'definition-node'}><strong>{workflow.name}</strong><p>{workflow.description}</p><small>{workflow.steps.length} steps · {workflow.trigger}</small></div>)}</article>
        </section>
        <section className="definition-pair">
          <article className="live-definition-card"><header><Database/><strong>Data</strong><span>{working.entities.length}</span></header>{working.entities.map((entity) => <div key={entity.id} className={recentChanges.has(entity.id) ? 'definition-node changed' : 'definition-node'}><strong>{entity.name}</strong><p>{entity.description}</p><small>{entity.fields.map((field) => field.id).join(' · ')}</small></div>)}</article>
          <article className="live-definition-card"><header><Bot/><strong>Agents and integrations</strong><span>{working.agents.length + working.integrations.length}</span></header>{[...working.agents, ...working.integrations].map((item) => <div key={item.id} className={recentChanges.has(item.id) ? 'definition-node changed' : 'definition-node'}><strong>{item.name}</strong><p>{item.purpose}</p></div>)}{!working.agents.length && !working.integrations.length && <p className="definition-empty">Only agent behavior the product actually needs will be added.</p>}</article>
        </section>
        <section className="live-definition-card"><header><Palette/><strong>Experience direction</strong><span>{working.designBrief.accessibilityTarget}</span></header><p>{working.designBrief.tone}</p><div className="definition-tags">{working.designBrief.principles.map((principle) => <span key={principle}>{principle}</span>)}</div></section>
      </div> : <div className="live-blueprint"><ApplicationBlueprint structure={working} revision={session.draft?.baseSpecRevision ?? specification.revision}/></div>}

      <footer className="definition-confirmation">
        <div className="definition-readiness"><span className={blocked ? 'blocked' : 'ready'}>{blocked ? <CircleAlert/> : <Check/>}{blocked ? 'Needs one more decision' : 'Ready when you are'}</span><strong>{session.coverage.score}% understood</strong><small>{blocked ? session.coverage.contradictions[0] : session.coverage.missing.length ? `${session.coverage.missing.length} areas can still be refined in conversation.` : 'The definition is thorough and internally consistent.'}</small></div>
        <button className="confirm-definition" onClick={() => void onConfirm()} disabled={session.status === 'running' || blocked || confirming}>{confirming ? <LoaderCircle className="spin"/> : <Check/>}{approved ? 'Continue to build' : 'Looks good — build my app'}</button>
      </footer>
    </aside>
  </div>;
}
