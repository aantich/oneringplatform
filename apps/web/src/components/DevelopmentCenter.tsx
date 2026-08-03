import { Box, Check, CircleDot, Clock3, Code2, GitBranch, Play, ServerCog, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { DevelopmentRun, Project } from '../types';

export function DevelopmentCenter({ project, runs, onStart }: { project: Project; runs: DevelopmentRun[]; onStart: () => Promise<void> }) {
  const latest = runs.find((run) => run.projectId === project.id);
  return (
    <div className="development-layout">
      <section className="run-hero panel-card">
        <div className="run-hero__copy">
          <div className="eyebrow"><ServerCog size={13} /> Hosted development plane</div>
          <h2>From approved intent to a verified release</h2>
          <p>Each run gets an ephemeral isolated workspace. Durable state lives in Git, the structured spec, evidence, and immutable artifacts.</p>
          <div className="workspace-facts">
            <span><Box size={14} /> Ephemeral workspace</span>
            <span><ShieldCheck size={14} /> No production secrets</span>
            <span><GitBranch size={14} /> Canonical commit</span>
          </div>
        </div>
        <button className="launch-button" onClick={() => void onStart()} disabled={latest?.status === 'running'}>
          {latest?.status === 'running' ? <span className="spinner" /> : <Play size={18} fill="currentColor" />}
          <span><strong>{latest?.status === 'running' ? 'Run in progress' : 'Build next slice'}</strong><small>Spec v{project.specVersion} · managed mode</small></span>
        </button>
      </section>

      <div className="development-columns">
        <section className="pipeline-card panel-card">
          <div className="panel-heading"><div><div className="eyebrow">Latest development run</div><h2>{latest ? latest.branch : 'No run started yet'}</h2></div>{latest && <span className={`status-pill status-pill--${latest.status}`}>{latest.status}</span>}</div>
          {latest ? (
            <div className="pipeline-list">
              {latest.steps.map((step, index) => (
                <div className={`pipeline-step pipeline-step--${step.status}`} key={step.id}>
                  <div className="pipeline-track"><span>{step.status === 'passed' ? <Check size={14} /> : step.status === 'running' ? <span className="spinner spinner--small" /> : index + 1}</span>{index < latest.steps.length - 1 && <i />}</div>
                  <div><div className="pipeline-step__title"><strong>{step.label}</strong>{step.durationMs && <small>{(step.durationMs / 1000).toFixed(1)}s</small>}</div><p>{step.detail}</p></div>
                </div>
              ))}
            </div>
          ) : <div className="empty-state"><TerminalSquare size={32} /><h3>Ready when the design is</h3><p>Start the first hosted run to create a workspace and implement the next vertical slice.</p></div>}
        </section>

        <aside className="run-side">
          <section className="panel-card workspace-card">
            <div className="eyebrow">Active workspace</div>
            <div className="workspace-terminal">
              <div><span className="terminal-dot terminal-dot--red" /><span className="terminal-dot terminal-dot--yellow" /><span className="terminal-dot terminal-dot--green" /><small>{latest?.workspace ?? 'warm pool'}</small></div>
              <code><em>$</em> restore canonical repository</code>
              <code><em>✓</em> pin builder configuration</code>
              <code><em>✓</em> apply capability policy</code>
              <code className={latest?.status === 'running' ? 'terminal-live' : ''}><em>›</em> {latest?.status === 'running' ? 'builder agents working…' : 'awaiting run'}</code>
            </div>
          </section>
          <section className="panel-card run-history">
            <div className="eyebrow">Recent runs</div>
            {runs.filter((run) => run.projectId === project.id).slice(0, 4).map((run) => <div key={run.id}><span className={`history-icon history-icon--${run.status}`}>{run.status === 'passed' ? <Check size={13} /> : <CircleDot size={13} />}</span><span><strong>{run.branch}</strong><small><Clock3 size={11} /> {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><Code2 size={14} /></div>)}
            {!runs.length && <p className="muted-copy">Completed runs and evidence appear here.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
