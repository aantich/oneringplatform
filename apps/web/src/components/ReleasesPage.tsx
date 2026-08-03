import { Check, ExternalLink, GitCommitHorizontal, PackageCheck, Rocket, ShieldCheck, TestTube2 } from 'lucide-react';
import type { Project, Release } from '../types';

export function ReleasesPage({ project, releases, onPromote }: { project: Project; releases: Release[]; onPromote: (id: string) => Promise<void> }) {
  const relevant = releases.filter((release) => release.projectId === project.id);
  const preview = relevant.find((release) => release.environment === 'preview' && release.status === 'ready');
  const production = relevant.find((release) => release.environment === 'production' && release.status === 'active');
  const alreadyLive = Boolean(preview && production?.artifactDigest === preview.artifactDigest);
  return (
    <div className="releases-page">
      <section className="release-summary panel-card">
        <div>
          <div className="eyebrow"><PackageCheck size={13} /> Immutable artifact promotion</div>
          <h2>{preview ? alreadyLive ? `${preview.version} is live` : `${preview.version} is ready` : 'No preview awaiting promotion'}</h2>
          <p>The exact verified artifact moves between environments. Nothing is rebuilt on the way to production.</p>
        </div>
        {preview && <button className="primary-button primary-button--large" disabled={alreadyLive} onClick={() => void onPromote(preview.id)}>{alreadyLive ? <Check size={17} /> : <Rocket size={17} />}{alreadyLive ? 'Running in production' : 'Promote to production'}</button>}
      </section>
      {preview && <section className="evidence-strip">
        <div><TestTube2 /><span><strong>{preview.evidence.tests}</strong><small>tests passed</small></span></div>
        <div><ShieldCheck /><span><strong>{preview.evidence.policyChecks}</strong><small>policy checks</small></span></div>
        <div><Check /><span><strong>{preview.evidence.coverage}%</strong><small>coverage</small></span></div>
        <div><GitCommitHorizontal /><span><strong>{preview.sourceCommit}</strong><small>source commit</small></span></div>
      </section>}
      <section className="release-table panel-card">
        <div className="panel-heading"><div><div className="eyebrow">Release ledger</div><h2>Provenance & rollback</h2></div></div>
        <div className="table-head"><span>Release</span><span>Environment</span><span>Evidence</span><span>Artifact</span><span>Status</span><span /></div>
        {relevant.map((release) => <div className="table-row" key={release.id}>
          <span><strong>{release.version}</strong><small>{new Date(release.createdAt).toLocaleString()}</small></span>
          <span className={`environment-chip environment-chip--${release.environment}`}>{release.environment}</span>
          <span>{release.evidence.tests} tests · {release.evidence.coverage}%</span>
          <span><code>{release.artifactDigest.slice(0, 19)}…</code></span>
          <span><span className={`status-pill status-pill--${release.status}`}>{release.status}</span></span>
          <a href={release.url} target="_blank" rel="noreferrer" aria-label={`Open ${release.version}`}><ExternalLink size={15} /></a>
        </div>)}
      </section>
    </div>
  );
}
