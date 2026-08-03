import { createHash } from 'node:crypto';
import type {
  AppModuleRecord,
  AppMembership,
  BrowserApp,
  BrowserAppSpecification,
  ConnectorActionRecord,
  DataSchemaRecord,
  EntityPolicyRecord,
  EndTenant,
  RouteBinding,
  RouteDefinition,
  ThemeRevision,
  ThemeStarter,
  TenancyRevision,
} from './browser-app.domain.js';

const now = new Date().toISOString();
const appId = 'pulse-tasks';

const taskPageSource = `import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, bootstrap, setDemoRole } from 'app:runtime';

type Role = 'public' | 'viewer' | 'editor' | 'admin';
type Task = { id: string; title: string; description?: string; status: 'todo' | 'doing' | 'done'; visibility: 'public' | 'members'; version: number; createdAt: string };
type Session = { principal: { role: Role }; capabilities: string[] };

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [session, setSession] = useState<Session>();
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const current = await bootstrap(true) as Session;
      setSession(current);
      const result = await api('/data/tasks') as { items: Task[] };
      setTasks(result.items);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load tasks'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const canCreate = session?.capabilities.includes('tasks:create') ?? false;
  const canDelete = session?.capabilities.includes('tasks:delete') ?? false;
  const completed = useMemo(() => tasks.filter((task) => task.status === 'done').length, [tasks]);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api('/data/tasks', { method: 'POST', body: JSON.stringify({ title: title.trim(), status: 'todo', visibility: 'members' }) });
      setTitle('');
      await load();
    } finally { setBusy(false); }
  }

  async function advance(task: Task) {
    const next = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo';
    await api('/data/tasks/' + task.id, { method: 'PATCH', headers: { 'if-match': String(task.version) }, body: JSON.stringify({ status: next }) });
    await load();
  }

  async function remove(task: Task) {
    await api('/data/tasks/' + task.id, { method: 'DELETE', headers: { 'if-match': String(task.version) } });
    await load();
  }

  async function changeRole(role: Role) {
    await setDemoRole(role);
    await load();
  }

  async function suggest() {
    setBusy(true);
    try {
      const result = await api('/connectors/idea-assistant/actions/suggest', { method: 'POST', body: JSON.stringify({ context: 'A practical next task for a small product team' }) }) as { suggestion: string };
      setIdea(result.suggestion);
    } finally { setBusy(false); }
  }

  return <main className="task-page">
    <section className="hero-card">
      <div><span className="eyebrow">BROWSER-NATIVE APP</span><h1>Make progress visible.</h1><p>A real React app generated and served by One Ring. MongoDB stores its component graph, data model, policies and releases.</p></div>
      <div className="progress-orb"><strong>{completed}/{tasks.length}</strong><span>completed</span></div>
    </section>

    <section className="toolbar-card">
      <div><small>Test security as</small><div className="role-switcher">{(['public','viewer','editor','admin'] as Role[]).map((role) => <button className={session?.principal.role === role ? 'active' : ''} onClick={() => void changeRole(role)} key={role}>{role}</button>)}</div></div>
      <div className="session-pill"><span />{session?.principal.role ?? 'loading'} session</div>
    </section>

    {error && <div className="error-banner">{error}</div>}
    <section className="workspace-grid">
      <div className="task-panel">
        <div className="section-heading"><div><span className="eyebrow">LIVE COLLECTION</span><h2>Team tasks</h2></div><span>{tasks.length} records</span></div>
        {canCreate && <form className="quick-add" onSubmit={createTask}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What should happen next?" /><button disabled={busy}>Add task</button></form>}
        {!canCreate && <div className="permission-note">Your current role has read-only access. Switch to editor or admin to create records.</div>}
        <div className="task-list">{tasks.map((task) => <article key={task.id} className={'task-row status-' + task.status}>
          <button className="status-button" disabled={!session?.capabilities.includes('tasks:update')} onClick={() => void advance(task)} aria-label="Advance task"><span /></button>
          <div><strong>{task.title}</strong><p>{task.description || (task.visibility === 'public' ? 'Visible to public visitors' : 'Members only')}</p></div>
          <span className="status-label">{task.status}</span>
          {canDelete && <button className="delete-button" onClick={() => void remove(task)}>Delete</button>}
        </article>)}</div>
      </div>

      <aside className="copilot-card"><span className="spark">✦</span><span className="eyebrow">SECURE CONNECTOR</span><h2>Idea assistant</h2><p>The browser sends an allowed operation and arguments. The encrypted LLM credential stays on the platform.</p><button disabled={busy || session?.principal.role === 'public'} onClick={() => void suggest()}>Suggest my next task</button>{idea && <blockquote>{idea}</blockquote>}<div className="boundary-list"><span>✓ Role checked</span><span>✓ Input validated</span><span>✓ Credential server-side</span><span>✓ Invocation audited</span></div></aside>
    </section>
  </main>;
}`;

const aboutPageSource = `import React from 'react';
export default function AboutPage() {
  return <main className="about-page"><span className="eyebrow">HOW IT WORKS</span><h1>Code is a graph, not a filesystem.</h1><p>Every page, component, route, policy and schema is independently versioned in MongoDB. Publishing compiles an immutable browser release; the secure platform gateway remains authoritative.</p><div className="architecture-cards"><article><strong>01</strong><h2>Living specification</h2><p>The PRD remains the source of truth for every generated revision.</p></article><article><strong>02</strong><h2>Component graph</h2><p>oneringai agents update typed modules and declarative route definitions.</p></article><article><strong>03</strong><h2>Secure runtime</h2><p>CRUD rules and connector permissions are enforced outside the browser.</p></article></div></main>;
}`;

export const runtimeCss = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eef1ff;background:#090b13;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 80% -10%,#352764 0,transparent 34%),#090b13;color:#eef1ff}button,input{font:inherit}button{cursor:pointer}.app-frame{min-height:100vh}.app-nav{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,calc((100vw - 1180px)/2));border-bottom:1px solid #ffffff12;background:#090b13d9;backdrop-filter:blur(20px);position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:11px;font-weight:800}.brand-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#8b6cff,#5eead4);color:#080a11;box-shadow:0 0 25px #8069ff55}.app-nav nav{display:flex;gap:8px}.app-nav a{color:#9299b1;text-decoration:none;padding:9px 14px;border-radius:10px;font-size:14px}.app-nav a.active{color:#fff;background:#ffffff12}.runtime-badge{font-size:12px;color:#75e6c8;border:1px solid #75e6c844;padding:7px 10px;border-radius:999px}.task-page,.about-page{max-width:1180px;margin:0 auto;padding:48px 24px 80px}.hero-card{display:flex;justify-content:space-between;gap:32px;align-items:center;padding:44px;border:1px solid #ffffff14;border-radius:28px;background:linear-gradient(135deg,#181526,#11131d);box-shadow:0 28px 70px #0005}.eyebrow{display:block;color:#8f7cff;font-size:11px;font-weight:800;letter-spacing:.14em;margin-bottom:10px}.hero-card h1,.about-page h1{font-size:clamp(40px,6vw,68px);line-height:.98;letter-spacing:-.055em;margin:0 0 18px;max-width:760px}.hero-card p,.about-page>p{color:#a5abc0;font-size:17px;line-height:1.65;max-width:700px;margin:0}.progress-orb{width:150px;height:150px;flex:none;border-radius:50%;display:grid;place-content:center;text-align:center;background:radial-gradient(circle,#191728 55%,transparent 57%),conic-gradient(#7b66ff 0 65%,#292b38 65%);box-shadow:0 0 55px #725cff26}.progress-orb strong{font-size:26px}.progress-orb span{font-size:11px;color:#959bb0;text-transform:uppercase;letter-spacing:.1em}.toolbar-card{margin:20px 0;display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border:1px solid #ffffff12;border-radius:18px;background:#11131b}.toolbar-card small{display:block;color:#777e94;margin-bottom:8px}.role-switcher{display:flex;gap:6px;flex-wrap:wrap}.role-switcher button{border:0;background:#20232f;color:#9299ad;border-radius:8px;padding:7px 11px;text-transform:capitalize}.role-switcher button.active{background:#7864f5;color:white}.session-pill{display:flex;align-items:center;gap:8px;color:#a6adbe;font-size:13px}.session-pill span{width:8px;height:8px;border-radius:50%;background:#61e0b8;box-shadow:0 0 12px #61e0b8}.workspace-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,.8fr);gap:20px}.task-panel,.copilot-card{border:1px solid #ffffff12;border-radius:22px;background:#11131b;padding:24px}.section-heading{display:flex;justify-content:space-between;align-items:center}.section-heading h2,.copilot-card h2{margin:0;font-size:24px}.section-heading>span{font-size:12px;color:#7d8498}.quick-add{display:flex;gap:10px;margin:20px 0}.quick-add input{flex:1;background:#090b12;border:1px solid #ffffff17;color:#fff;padding:13px 15px;border-radius:12px;outline:none}.quick-add input:focus{border-color:#7964f5}.quick-add button,.copilot-card button{border:0;border-radius:12px;background:linear-gradient(135deg,#806cff,#6652db);color:white;font-weight:700;padding:12px 16px}.quick-add button:disabled,.copilot-card button:disabled{opacity:.45}.permission-note{margin:18px 0;padding:12px 14px;border-radius:12px;background:#806cff12;color:#a9a0da;font-size:13px}.task-list{display:grid;gap:8px}.task-row{display:grid;grid-template-columns:30px 1fr auto auto;gap:12px;align-items:center;padding:14px;border-radius:14px;background:#171923;border:1px solid transparent}.task-row:hover{border-color:#ffffff12}.task-row strong{font-size:14px}.task-row p{margin:4px 0 0;color:#747b90;font-size:12px}.status-button{width:24px;height:24px;border:1px solid #4d5265;background:transparent;border-radius:50%;display:grid;place-items:center}.status-done .status-button{background:#61ddb7;border-color:#61ddb7}.status-done .status-button span{width:7px;height:4px;border-left:2px solid #08231b;border-bottom:2px solid #08231b;transform:rotate(-45deg) translateY(-1px)}.status-label{text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:#858ba0}.delete-button{border:0;background:transparent;color:#e6889d;font-size:11px}.copilot-card{position:relative;background:linear-gradient(160deg,#19152a,#11131b);overflow:hidden}.copilot-card:after{content:'';position:absolute;width:180px;height:180px;border-radius:50%;background:#745fff25;filter:blur(40px);right:-80px;top:-80px;pointer-events:none}.copilot-card .spark{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#7d67f3;margin-bottom:28px}.copilot-card p{color:#8e95aa;line-height:1.6;font-size:14px}.copilot-card button{width:100%;margin:10px 0 14px}.copilot-card blockquote{margin:0 0 16px;padding:14px;background:#ffffff0a;border-left:2px solid #7864f5;border-radius:8px;color:#d8d5e8;font-size:13px;line-height:1.5}.boundary-list{display:grid;gap:8px;color:#72798e;font-size:12px}.error-banner{padding:12px 15px;background:#401a26;color:#ffb3c2;border-radius:12px;margin-bottom:18px}.about-page{padding-top:80px}.architecture-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:44px}.architecture-cards article{padding:26px;border:1px solid #ffffff12;border-radius:20px;background:#11131b}.architecture-cards article>strong{color:#7c68ed}.architecture-cards h2{font-size:18px}.architecture-cards p{color:#858ca1;line-height:1.5}@media(max-width:780px){.runtime-badge{display:none}.app-nav{padding:0 18px}.task-page,.about-page{padding:28px 16px 60px}.hero-card{padding:28px;align-items:flex-start}.progress-orb{width:96px;height:96px}.progress-orb strong{font-size:18px}.workspace-grid{grid-template-columns:1fr}.toolbar-card{align-items:flex-start;gap:16px}.session-pill{display:none}.architecture-cards{grid-template-columns:1fr}.task-row{grid-template-columns:28px 1fr auto}.delete-button{grid-column:2}.hero-card h1,.about-page h1{font-size:40px}}`;

function module(id: string, kind: AppModuleRecord['kind'], name: string, description: string, source: string): AppModuleRecord {
  return {
    id, appId, revision: 1, kind, name, description, source,
    dependencies: [], packageImports: ['react'], requiredCapabilities: [],
    contentHash: createHash('sha256').update(source).digest('hex'), createdAt: now,
  };
}

export const seedBrowserApp: BrowserApp = {
  id: appId,
  publicKey: appId,
  ownerOrganizationId: 'everworker-labs',
  name: 'Pulse Tasks',
  description: 'A browser-native team task application generated from a living PRD.',
  runtimeProfile: 'browser_data',
  projectId: 'fieldops-ai',
  specRevision: 13,
  sourceRevision: 1,
  schemaRevision: 1,
  policyRevision: 1,
  connectorRevision: 1,
  themeRevision: 1,
  tenancyRevision: 1,
  tenancyMode: 'multi_organization',
  createdAt: now,
  updatedAt: now,
};

export const seedBrowserAppSpecification: BrowserAppSpecification = {
  id: 'pulse-tasks-spec-v13', appId, revision: 13, projectId: 'fieldops-ai', status: 'approved', createdAt: now,
  sections: [
    { id: 'goal', title: 'Product goal', body: 'Help operations teams coordinate role-aware work through a secure browser-native task workspace.' },
    { id: 'security', title: 'Security boundary', body: 'All private records are scoped by verified app and organization membership; browser code never supplies authoritative tenant scope.' },
    { id: 'experience', title: 'Experience', body: 'Provide responsive task, architecture, identity, connector and exception states with accessible visual hierarchy.' },
  ],
};

export const seedModules = [
  module('task-board-page', 'page', 'Task board', 'CRUD task board with role-aware controls and a secure connector action.', taskPageSource),
  module('about-page', 'page', 'Architecture page', 'Explains the generated app runtime.', aboutPageSource),
];

export const seedRoutes: RouteDefinition[] = [
  { id: 'route-home', appId, revision: 1, path: '/', pageModuleId: 'task-board-page', public: true, requiredCapabilities: [], navigation: { label: 'Tasks', order: 1 } },
  { id: 'route-about', appId, revision: 1, path: '/about', pageModuleId: 'about-page', public: true, requiredCapabilities: [], navigation: { label: 'Architecture', order: 2 } },
];

export const seedSchemas: DataSchemaRecord[] = [{
  id: 'schema-tasks', appId, revision: 1, entity: 'tasks', displayName: 'Task',
  physicalCollection: 'a_pulse_tasks_prod_tasks', deploymentMode: 'shared_namespace',
  jsonSchema: {
    type: 'object', additionalProperties: false, required: ['title', 'status', 'visibility'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 160 },
      description: { type: 'string', maxLength: 1000 },
      status: { enum: ['todo', 'doing', 'done'] },
      visibility: { enum: ['public', 'members'] },
    },
  },
  indexes: [{ fields: { status: 1, createdAt: -1 } }, { fields: { visibility: 1, createdAt: -1 } }],
  publicRecordFilter: { visibility: 'public' },
}];

export const seedPolicies: EntityPolicyRecord[] = [{
  id: 'policy-tasks', appId, revision: 1, entity: 'tasks',
  grants: {
    public: { operations: ['read'], readFilter: { visibility: 'public' }, readFields: ['id', 'title', 'description', 'status', 'visibility', 'version', 'createdAt', 'updatedAt'], writeFields: [], uiCapabilities: ['tasks:read-public'] },
    viewer: { operations: ['read'], readFields: ['id', 'title', 'description', 'status', 'visibility', 'version', 'createdAt', 'updatedAt'], writeFields: [], uiCapabilities: ['tasks:read'] },
    editor: { operations: ['create', 'read', 'update'], readFields: ['id', 'title', 'description', 'status', 'visibility', 'version', 'createdAt', 'updatedAt'], writeFields: ['title', 'description', 'status', 'visibility'], uiCapabilities: ['tasks:read', 'tasks:create', 'tasks:update'] },
    admin: { operations: ['create', 'read', 'update', 'delete'], readFields: ['id', 'title', 'description', 'status', 'visibility', 'version', 'createdAt', 'updatedAt'], writeFields: ['title', 'description', 'status', 'visibility'], uiCapabilities: ['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete'] },
  },
}];

export const seedConnectors: ConnectorActionRecord[] = [{
  id: 'idea-assistant', appId, revision: 1, connector: 'openai-main', action: 'suggest',
  description: 'Suggest a concise next task from user-provided context.', allowedRoles: ['viewer', 'editor', 'admin'],
  inputSchema: { type: 'object', additionalProperties: false, required: ['context'], properties: { context: { type: 'string', minLength: 3, maxLength: 500 } } },
  outputSchema: { type: 'object', additionalProperties: false, required: ['suggestion', 'connector', 'action'], properties: { suggestion: { type: 'string', maxLength: 4000 }, connector: { type: 'string' }, action: { type: 'string' } } },
  timeoutMs: 20_000, rateLimitPerMinute: 10,
}];

export const seedBindings: RouteBinding[] = [
  { id: 'binding-path', appId, environment: 'production', type: 'platform_path', hostname: 'localhost', pathPrefix: '/apps/pulse-tasks', canonical: true, status: 'active' },
  { id: 'binding-host', appId, environment: 'production', type: 'platform_hostname', hostname: 'pulse.apps.localhost', pathPrefix: '/', canonical: false, status: 'active' },
];

export const seedTasks = [
  { id: 'task-public-welcome', appId, title: 'Explore the public task board', description: 'This record demonstrates server-enforced public visibility.', status: 'done', visibility: 'public', version: 1, createdAt: now, updatedAt: now },
  { id: 'task-secure-data', appId, tenantId: 'northwind', title: 'Test role-aware CRUD controls', description: 'Switch to editor to create and update tasks.', status: 'doing', visibility: 'members', version: 1, createdAt: now, updatedAt: now },
  { id: 'task-connector', appId, tenantId: 'northwind', title: 'Call the protected idea connector', description: 'The API key remains encrypted on the server.', status: 'todo', visibility: 'members', version: 1, createdAt: now, updatedAt: now },
  { id: 'task-globex-private', appId, tenantId: 'globex', title: 'Prepare the Globex launch review', description: 'This record proves organization-level data isolation.', status: 'todo', visibility: 'members', version: 1, createdAt: now, updatedAt: now },
];

export const seedTenancy: TenancyRevision = {
  id: 'tenancy-multi-organization-v1', appId, revision: 1, mode: 'multi_organization',
  organizationLabel: 'Organization', allowMultipleMemberships: true, status: 'published',
  createdBy: 'system', createdAt: now,
};

export const seedEndTenants: EndTenant[] = [
  { id: 'northwind', appId, slug: 'northwind', name: 'Northwind Operations', status: 'active', createdAt: now },
  { id: 'globex', appId, slug: 'globex', name: 'Globex Dispatch', status: 'active', createdAt: now },
];

export const seedMemberships: AppMembership[] = [
  { id: 'membership-viewer-northwind', appId, userId: 'demo-viewer', email: 'viewer@northwind.demo', displayName: 'Nora Viewer', tenantId: 'northwind', roles: ['viewer'], status: 'active', version: 1, createdAt: now, updatedAt: now },
  { id: 'membership-editor-northwind', appId, userId: 'demo-editor', email: 'editor@northwind.demo', displayName: 'Evan Editor', tenantId: 'northwind', roles: ['editor'], status: 'active', version: 1, createdAt: now, updatedAt: now },
  { id: 'membership-admin-northwind', appId, userId: 'demo-admin', email: 'admin@pulse.demo', displayName: 'Ada Admin', tenantId: 'northwind', roles: ['admin'], status: 'active', version: 1, createdAt: now, updatedAt: now },
  { id: 'membership-admin-globex', appId, userId: 'demo-admin', email: 'admin@pulse.demo', displayName: 'Ada Admin', tenantId: 'globex', roles: ['admin'], status: 'active', version: 1, createdAt: now, updatedAt: now },
];

export const themeStarters: ThemeStarter[] = [
  {
    id: 'midnight-violet', name: 'Midnight Violet', description: 'Focused, premium and technical.',
    tokens: {
      colors: { background: '#090b13', surface: '#11131b', surfaceElevated: '#171923', text: '#eef1ff', textMuted: '#a5abc0', primary: '#806cff', primaryContrast: '#ffffff', accent: '#5eead4', success: '#61ddb7', danger: '#e6889d', border: '#292b38' },
      typography: { fontFamily: 'inter', headingStyle: 'compact', baseSize: 16 },
      shape: { radius: 'rounded', borderWidth: 1 }, density: 'comfortable', contentWidth: 'standard',
    },
    componentVariants: { navigation: 'glass', cards: 'soft', buttons: 'gradient' },
  },
  {
    id: 'paper-studio', name: 'Paper Studio', description: 'Bright, editorial and quietly confident.',
    tokens: {
      colors: { background: '#f5f3ee', surface: '#ffffff', surfaceElevated: '#ebe8e0', text: '#171713', textMuted: '#66645d', primary: '#2f5d50', primaryContrast: '#ffffff', accent: '#c46d3b', success: '#2f765f', danger: '#a33f4b', border: '#d7d2c7' },
      typography: { fontFamily: 'serif', headingStyle: 'editorial', baseSize: 17 },
      shape: { radius: 'soft', borderWidth: 1 }, density: 'spacious', contentWidth: 'narrow',
    },
    componentVariants: { navigation: 'minimal', cards: 'outlined', buttons: 'solid' },
  },
  {
    id: 'ocean-signal', name: 'Ocean Signal', description: 'Clear operational blues with energetic cyan.',
    tokens: {
      colors: { background: '#07141d', surface: '#0d202d', surfaceElevated: '#123044', text: '#edfaff', textMuted: '#9ab8c5', primary: '#24a8d8', primaryContrast: '#03131b', accent: '#63e6be', success: '#55d6a7', danger: '#ff7d8f', border: '#214256' },
      typography: { fontFamily: 'manrope', headingStyle: 'balanced', baseSize: 16 },
      shape: { radius: 'soft', borderWidth: 1 }, density: 'comfortable', contentWidth: 'wide',
    },
    componentVariants: { navigation: 'solid', cards: 'outlined', buttons: 'solid' },
  },
  {
    id: 'ember-console', name: 'Ember Console', description: 'Warm, decisive and dense for power users.',
    tokens: {
      colors: { background: '#160d0a', surface: '#241511', surfaceElevated: '#321d17', text: '#fff3e8', textMuted: '#c7a798', primary: '#f2763d', primaryContrast: '#1b0903', accent: '#ffc857', success: '#87c38f', danger: '#ff7b86', border: '#4a2a21' },
      typography: { fontFamily: 'system', headingStyle: 'compact', baseSize: 15 },
      shape: { radius: 'sharp', borderWidth: 1 }, density: 'compact', contentWidth: 'wide',
    },
    componentVariants: { navigation: 'solid', cards: 'outlined', buttons: 'solid' },
  },
  {
    id: 'sage-workspace', name: 'Sage Workspace', description: 'Natural, calm and approachable.',
    tokens: {
      colors: { background: '#edf1e8', surface: '#fafcf7', surfaceElevated: '#dfe7d8', text: '#1d2a1e', textMuted: '#647063', primary: '#3f7153', primaryContrast: '#ffffff', accent: '#b76f45', success: '#43845e', danger: '#a8454f', border: '#c7d1c1' },
      typography: { fontFamily: 'manrope', headingStyle: 'balanced', baseSize: 16 },
      shape: { radius: 'rounded', borderWidth: 1 }, density: 'spacious', contentWidth: 'standard',
    },
    componentVariants: { navigation: 'minimal', cards: 'soft', buttons: 'solid' },
  },
];

export const seedTheme: ThemeRevision = {
  id: 'theme-midnight-violet-v1', appId, revision: 1, name: themeStarters[0]!.name,
  description: themeStarters[0]!.description, starterId: themeStarters[0]!.id,
  tokens: themeStarters[0]!.tokens, componentVariants: themeStarters[0]!.componentVariants,
  customCss: '', status: 'published', createdBy: 'system',
  accessibility: { contrastScore: 17.12, issues: [] }, createdAt: now,
};
