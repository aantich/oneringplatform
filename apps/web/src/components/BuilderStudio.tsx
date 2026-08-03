import { useMemo, useState } from 'react';
import { Bot, ChevronRight, CircleCheck, Cpu, PlugZap, Save, ShieldCheck, SlidersHorizontal, Wrench } from 'lucide-react';
import type { BuilderAgent, ConnectorSummary } from '../types';

export function BuilderStudio({
  agents,
  connectors,
  version,
  onSave,
}: {
  agents: BuilderAgent[];
  connectors: ConnectorSummary[];
  version: string;
  onSave: (id: string, patch: Partial<BuilderAgent>) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const [draft, setDraft] = useState<BuilderAgent | undefined>(selected);
  const stages = useMemo(() => Array.from(new Set(agents.map((agent) => agent.stage))), [agents]);

  const select = (agent: BuilderAgent) => {
    setSelectedId(agent.id);
    setDraft(structuredClone(agent));
  };

  if (!draft) return null;
  return (
    <div className="studio-layout">
      <section className="agent-catalog panel-card">
        <div className="panel-heading studio-heading">
          <div>
            <div className="eyebrow"><ShieldCheck size={13} /> Superadmin</div>
            <h2>Builder System Studio</h2>
          </div>
          <span className="version-chip">{version.replace('builder-', '')}</span>
        </div>
        <p className="panel-intro">Versioned oneringai specialists that design, build, review, and release every managed app.</p>
        {stages.map((stage) => (
          <div className="agent-stage" key={stage}>
            <span>{stage}</span>
            {agents.filter((agent) => agent.stage === stage).map((agent) => (
              <button key={agent.id} className={selectedId === agent.id ? 'agent-row active' : 'agent-row'} onClick={() => select(agent)}>
                <span className="agent-row__icon"><Bot size={16} /></span>
                <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                <span className={`agent-score ${agent.lastEvaluatedScore >= 90 ? 'agent-score--good' : ''}`}>{agent.lastEvaluatedScore}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        ))}
      </section>

      <section className="agent-editor panel-card">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Platform template · v{draft.version}</div>
            <h2>{draft.name}</h2>
          </div>
          <label className="switch"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span /></label>
        </div>
        <div className="editor-grid">
          <label className="field"><span><Cpu size={14} /> Connector</span><select value={draft.connector} onChange={(e) => setDraft({ ...draft, connector: e.target.value })}>{connectors.filter((c) => c.kind === 'llm').map((connector) => <option value={connector.id} key={connector.id}>{connector.name}{connector.configured ? '' : ' · unavailable'}</option>)}</select></label>
          <label className="field"><span><SlidersHorizontal size={14} /> Model</span><input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
        </div>
        <label className="field field--large"><span>Hidden platform instructions</span><textarea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></label>
        <div className="capability-section">
          <div className="capability-heading"><span><Wrench size={15} /> Tools</span><small>Capability-scoped in hosted workspaces</small></div>
          <div className="token-list">{draft.tools.map((tool) => <span key={tool}>{tool}<CircleCheck size={12} /></span>)}</div>
        </div>
        <div className="capability-section">
          <div className="capability-heading"><span><PlugZap size={15} /> Plugins & overlays</span><small>Injected by oneringai context</small></div>
          <div className="token-list token-list--violet">{draft.plugins.map((plugin) => <span key={plugin}>{plugin}<CircleCheck size={12} /></span>)}</div>
        </div>
        <div className="eval-card">
          <div className="eval-ring" style={{ '--score': `${draft.lastEvaluatedScore * 3.6}deg` } as React.CSSProperties}><strong>{draft.lastEvaluatedScore}</strong><small>eval</small></div>
          <div><strong>Latest evaluation passed</strong><p>Ambiguity handling, traceability, safety, concision, and escalation behavior.</p></div>
          <span className="status-pill status-pill--approved">approved</span>
        </div>
        <div className="editor-actions">
          <span>Changes create a new draft version. Published runs remain pinned.</span>
          <button className="primary-button" onClick={() => void onSave(draft.id, draft)}><Save size={15} /> Save new version</button>
        </div>
      </section>

      <aside className="connector-rail panel-card">
        <div className="eyebrow">Connector vault</div>
        <h3>Runtime availability</h3>
        <p>Secrets remain encrypted and never enter prompts or source.</p>
        {connectors.map((connector) => (
          <div className="connector-row" key={connector.id}>
            <span className={`connector-logo connector-logo--${connector.kind}`}><PlugZap size={15} /></span>
            <span><strong>{connector.name}</strong><small>{connector.model ?? connector.kind}</small></span>
            <span className={connector.configured ? 'connector-state connector-state--on' : 'connector-state'} />
          </div>
        ))}
      </aside>
    </div>
  );
}
