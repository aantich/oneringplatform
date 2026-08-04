import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, CircleAlert, LoaderCircle, Palette, Sparkles, WandSparkles } from 'lucide-react';
import { api } from '../api';
import type { BrowserAppDetail, ThemeRevision, ThemeStarter } from '../types';

interface Props {
  detail: BrowserAppDetail;
  onDetail: (detail: BrowserAppDetail) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const colorFields: Array<[keyof ThemeRevision['tokens']['colors'], string]> = [
  ['background', 'Page'], ['surface', 'Surface'], ['surfaceElevated', 'Raised'], ['text', 'Text'],
  ['textMuted', 'Muted text'], ['primary', 'Primary'], ['primaryContrast', 'On primary'], ['accent', 'Accent'],
  ['success', 'Success'], ['danger', 'Danger'], ['border', 'Border'],
];

export function VisualDesignStudio({ detail, onDetail, onNotice, onError }: Props) {
  const activeTheme = detail.themes.find((theme) => theme.revision === detail.app.themeRevision) ?? detail.themes[0]!;
  const [starters, setStarters] = useState<ThemeStarter[]>([]);
  const [draft, setDraft] = useState<ThemeRevision>(activeTheme);
  const [persistedRevision, setPersistedRevision] = useState<number>();
  const [direction, setDirection] = useState('Create a calm, premium operations workspace with excellent information hierarchy.');
  const [busy, setBusy] = useState<'agent' | 'publish'>();
  const [previewCss, setPreviewCss] = useState('');
  const [previewCssError, setPreviewCssError] = useState<string>();

  useEffect(() => { void api.themeStarters().then(setStarters).catch((error: Error) => onError(error.message)); }, []);
  useEffect(() => { setDraft(activeTheme); setPersistedRevision(undefined); }, [activeTheme.id]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.previewTheme(detail.app.id, {
        name: draft.name, description: draft.description, starterId: draft.starterId,
        tokens: draft.tokens, componentVariants: draft.componentVariants, customCss: draft.customCss,
      }).then((result) => {
        if (!cancelled) { setPreviewCss(result.scopedCss.replaceAll('.app-frame', '.theme-live-preview')); setPreviewCssError(undefined); }
      }).catch((reason: Error) => {
        if (!cancelled) { setPreviewCss(''); setPreviewCssError(reason.message); }
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [detail.app.id, draft]);

  const radius = { sharp: 6, soft: 14, rounded: 24 }[draft.tokens.shape.radius];
  const previewStyle = useMemo(() => ({
    '--preview-bg': draft.tokens.colors.background,
    '--preview-surface': draft.tokens.colors.surface,
    '--preview-raised': draft.tokens.colors.surfaceElevated,
    '--preview-text': draft.tokens.colors.text,
    '--preview-muted': draft.tokens.colors.textMuted,
    '--preview-primary': draft.tokens.colors.primary,
    '--preview-primary-contrast': draft.tokens.colors.primaryContrast,
    '--preview-accent': draft.tokens.colors.accent,
    '--preview-border': draft.tokens.colors.border,
    '--preview-radius': `${radius}px`,
    '--preview-font': draft.tokens.typography.fontFamily === 'serif' ? 'Georgia, serif' : draft.tokens.typography.fontFamily === 'system' ? 'system-ui, sans-serif' : `${draft.tokens.typography.fontFamily}, system-ui, sans-serif`,
  }) as CSSProperties, [draft, radius]);

  function changed(next: ThemeRevision) {
    setDraft(next);
    setPersistedRevision(undefined);
  }

  function applyStarter(starter: ThemeStarter) {
    changed({ ...draft, name: starter.name, description: starter.description, starterId: starter.id, tokens: structuredClone(starter.tokens), componentVariants: structuredClone(starter.componentVariants), customCss: '' });
  }

  async function generate() {
    setBusy('agent');
    try {
      const result = await api.generateTheme(detail.app.id, direction);
      setDraft(result.theme);
      setPersistedRevision(result.theme.revision);
      onNotice(`${result.agent === 'oneringai' ? 'Visual Design Agent' : 'Safe starter'} created theme revision ${result.theme.revision}: ${result.theme.name}. Review it before publishing.`);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Visual design generation failed'); }
    finally { setBusy(undefined); }
  }

  async function publish() {
    setBusy('publish');
    try {
      const revision = persistedRevision ?? (await api.createTheme(detail.app.id, {
        name: draft.name, description: draft.description, starterId: draft.starterId,
        tokens: draft.tokens, componentVariants: draft.componentVariants, customCss: draft.customCss,
      })).revision;
      const result = await api.publishTheme(detail.app.id, revision);
      onDetail(result.detail);
      setPersistedRevision(undefined);
      onNotice(`Theme ${result.theme.name} is published in release ${result.detail.releases.find((release) => release.status === 'active')?.version}.`);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Theme publish failed'); }
    finally { setBusy(undefined); }
  }

  return <div className="visual-design-studio">
    <section className="design-agent-bar">
      <span className="design-agent-icon"><WandSparkles /></span>
      <div><small>DEDICATED ONERINGAI VISUAL DESIGN AGENT</small><strong>Describe the feeling, not the CSS</strong><p>The agent uses the approved PRD, pages, superadmin prompt and accessibility contract.</p></div>
      <div className="design-agent-input"><input value={direction} onChange={(event) => setDirection(event.target.value)} aria-label="Visual direction"/><button onClick={() => void generate()} disabled={Boolean(busy)}>{busy === 'agent' ? <LoaderCircle className="spin" /> : <Sparkles />} Generate design</button></div>
    </section>

    <div className="design-layout">
      <aside className="theme-controls">
        <div className="design-section-title"><span>Starting points</span><small>{starters.length} curated systems</small></div>
        <div className="theme-starters">{starters.map((starter) => <button key={starter.id} className={draft.starterId === starter.id ? 'active' : ''} onClick={() => applyStarter(starter)}><span className="starter-colors">{[starter.tokens.colors.background, starter.tokens.colors.primary, starter.tokens.colors.accent].map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{starter.name}</strong><small>{starter.description}</small></button>)}</div>

        <div className="design-section-title design-section-title--spaced"><span>Color tokens</span><small>Validated hex</small></div>
        <div className="color-token-grid">{colorFields.map(([key, label]) => <label key={key}><span>{label}</span><div><input type="color" value={draft.tokens.colors[key]} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, colors: { ...draft.tokens.colors, [key]: event.target.value } } })}/><input aria-label={`${label} color`} value={draft.tokens.colors[key]} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, colors: { ...draft.tokens.colors, [key]: event.target.value } } })}/></div></label>)}</div>
      </aside>

      <main className="theme-preview-column">
        <div className="design-section-title"><span>Live application preview</span><small>Unsaved changes stay local</small></div>
        <div className={`theme-live-preview preview-nav-${draft.componentVariants.navigation} preview-cards-${draft.componentVariants.cards} preview-buttons-${draft.componentVariants.buttons}`} style={previewStyle}>
          <style>{previewCss}</style>
          <header><span className="preview-brand"><i>◉</i> Acme Operations</span><nav><b>Overview</b><span>Customers</span><span>Reports</span></nav><em>Live</em></header>
          <div className="preview-body hero-card"><span className="preview-eyebrow">OPERATIONS OVERVIEW</span><h2>Everything important, clearly prioritized.</h2><p>Generated components consume semantic design tokens, so visual changes remain decoupled from application behavior.</p><div className="preview-metrics architecture-cards"><article><small>Open requests</small><strong>248</strong><i>+12%</i></article><article><small>Resolved today</small><strong>94</strong><i>On target</i></article><article><small>Attention needed</small><strong>7</strong><i>Review</i></article></div><div className="preview-work"><section className="task-panel"><div className="section-heading"><strong>Recent activity</strong><button>View all</button></div>{['Northwind request approved','Technician assigned','SLA risk resolved'].map((item, index) => <p className="task-row" key={item}><i>{index + 1}</i><span><b>{item}</b><small>{index + 2} minutes ago</small></span><em>{index === 2 ? 'Done' : 'Active'}</em></p>)}</section><aside className="copilot-card"><span>AI COPILOT</span><strong>Three priorities are ready for review.</strong><p>Every action remains governed by your role policy.</p><button>Review priorities</button></aside></div></div>
        </div>

        <div className="theme-options-grid">
          <label>Typeface<select value={draft.tokens.typography.fontFamily} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, typography: { ...draft.tokens.typography, fontFamily: event.target.value as ThemeRevision['tokens']['typography']['fontFamily'] } } })}><option value="inter">Inter</option><option value="manrope">Manrope</option><option value="system">System</option><option value="serif">Editorial serif</option></select></label>
          <label>Heading style<select value={draft.tokens.typography.headingStyle} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, typography: { ...draft.tokens.typography, headingStyle: event.target.value as ThemeRevision['tokens']['typography']['headingStyle'] } } })}><option value="compact">Compact</option><option value="balanced">Balanced</option><option value="editorial">Editorial</option></select></label>
          <label>Density<select value={draft.tokens.density} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, density: event.target.value as ThemeRevision['tokens']['density'] } })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
          <label>Corner style<select value={draft.tokens.shape.radius} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, shape: { ...draft.tokens.shape, radius: event.target.value as ThemeRevision['tokens']['shape']['radius'] } } })}><option value="sharp">Sharp</option><option value="soft">Soft</option><option value="rounded">Rounded</option></select></label>
          <label>Navigation<select value={draft.componentVariants.navigation} onChange={(event) => changed({ ...draft, componentVariants: { ...draft.componentVariants, navigation: event.target.value as ThemeRevision['componentVariants']['navigation'] } })}><option value="solid">Solid</option><option value="glass">Glass</option><option value="minimal">Minimal</option></select></label>
          <label>Cards<select value={draft.componentVariants.cards} onChange={(event) => changed({ ...draft, componentVariants: { ...draft.componentVariants, cards: event.target.value as ThemeRevision['componentVariants']['cards'] } })}><option value="outlined">Outlined</option><option value="soft">Soft</option><option value="elevated">Elevated</option></select></label>
          <label>Buttons<select value={draft.componentVariants.buttons} onChange={(event) => changed({ ...draft, componentVariants: { ...draft.componentVariants, buttons: event.target.value as ThemeRevision['componentVariants']['buttons'] } })}><option value="solid">Solid</option><option value="gradient">Gradient</option><option value="outline">Outline</option></select></label>
          <label>Content width<select value={draft.tokens.contentWidth} onChange={(event) => changed({ ...draft, tokens: { ...draft.tokens, contentWidth: event.target.value as ThemeRevision['tokens']['contentWidth'] } })}><option value="narrow">Narrow</option><option value="standard">Standard</option><option value="wide">Wide</option></select></label>
        </div>

        <details className="advanced-css"><summary>Advanced scoped CSS override</summary><p>External imports and URLs are prohibited. Draft CSS is server-validated and rendered in the preview.</p><textarea value={draft.customCss} onChange={(event) => changed({ ...draft, customCss: event.target.value })} placeholder=".hero-card { /* advanced managed override */ }" />{previewCssError && <small>{previewCssError}</small>}</details>
      </main>

      <aside className="theme-publish-panel">
        <div className="theme-summary"><Palette /><small>WORKING THEME</small><input value={draft.name} onChange={(event) => changed({ ...draft, name: event.target.value })}/><textarea value={draft.description} onChange={(event) => changed({ ...draft, description: event.target.value })}/></div>
        <div className={`contrast-gate ${draft.accessibility.issues.length ? 'warning' : ''}`}>{draft.accessibility.issues.length ? <CircleAlert /> : <Check />}<div><strong>{draft.accessibility.issues.length ? 'Review required' : 'Accessibility gate'}</strong><span>{persistedRevision ? `${draft.accessibility.contrastScore}:1 minimum contrast` : 'Recalculated by the server on save'}</span></div></div>
        <button className="publish-theme-button" onClick={() => void publish()} disabled={Boolean(busy)}>{busy === 'publish' ? <LoaderCircle className="spin" /> : <Check />} Validate & publish theme</button>
        <p className="publish-help">Publishing compiles new CSS and promotes an immutable release. Data and application logic are unchanged.</p>
        <div className="theme-history"><div className="design-section-title"><span>Revision history</span><small>{detail.themes.length}</small></div>{detail.themes.slice(0, 6).map((theme) => <button key={theme.id} onClick={() => { setDraft(theme); setPersistedRevision(theme.revision); }}><span style={{ background: theme.tokens.colors.primary }} /><div><strong>{theme.name}</strong><small>v{theme.revision} · {theme.createdBy.replaceAll('-', ' ')}</small></div><em className={theme.status}>{theme.status}</em></button>)}</div>
      </aside>
    </div>
  </div>;
}
