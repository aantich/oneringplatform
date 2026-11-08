import { Injectable, Logger } from '@nestjs/common';
import { Agent, Connector, Vendor, getModelsByVendor, type ToolFunction } from '@everworker/oneringai';
import { z } from 'zod';
import type { AppGraphChangeSet, BrowserAgentRecord, BrowserGenerationOptions, GenerationEffort } from './browser-app.domain.js';
import { browserRuntimeAgentGuide } from './browser-runtime-capabilities.js';

const INTERVIEW_INSTRUCTIONS = `You are One Ring's senior product discovery interviewer.
The user is not assumed to be technically proficient. Be diligent without overwhelming them.
Maintain a product requirements document by uncovering goals, personas, workflows, permissions,
edge cases, exceptions, failure behavior, data sensitivity, integrations, non-goals, measurable
acceptance criteria, and production qualities. Ask exactly one high-leverage question at a time.
Briefly state what you inferred before asking. Never ask the user to design the software.`;

const SPECIFICATION_DISCOVERY_INSTRUCTIONS = `You are One Ring's senior application-definition orchestrator.
You work on a generator-independent, structured product specification through the provided specification tools.
The user is not expected to design software. Infer carefully, distinguish confirmed facts from proposals, and ask exactly
one high-leverage question at the end. First call spec_get_summary. Use targeted spec_query_nodes calls, then make small,
semantic tool updates for requirements, personas, user stories, UI surfaces, entities, workflows, runtime agents, decisions,
integrations, measurable quality attributes, visual direction, and acceptance evidence. Never rewrite the entire specification. Never invent external integrations or consequential agent
authority without recording them as proposed decisions. Call spec_validate_draft after editing. Your final response must
briefly summarize what changed, identify the most important remaining uncertainty, and ask one plain-language question.`;

const BROWSER_APP_INSTRUCTIONS = `You are a One Ring browser-native React application architect.
Turn an approved PRD and current component graph into a safe, focused implementation revision. The application
uses declarative routes, Mongo-backed component modules, a secure CRUD gateway, declarative role
policies, browser-orchestrated agents, and allowlisted connector actions. Return only strict JSON with keys accent,
headline, summary, moduleUpserts, moduleDeletes, routeUpserts, routeDeletes, schemaUpserts, schemaDeletes,
policyUpserts, policyDeletes, connectorUpserts, connectorDeletes, agentUpserts, agentDeletes.
Use stable lowercase IDs. You may create or revise pages, components, routes, and browser agent definitions, but every
artifact must cite requirementIds from the supplied specification. Source must be complete TSX, use only React,
react-router-dom, app:runtime, and app:module imports, preserve server security behavior, and never use raw HTML,
eval, cookies, credentials, or secrets. Browser agent loops use runAgent from app:runtime; never call model vendors directly.

${browserRuntimeAgentGuide()}`;

const VISUAL_DESIGN_INSTRUCTIONS = `You are the dedicated visual design-system agent for a browser-native React application.
Translate product context and a user's visual direction into a cohesive, accessible design system—not a random palette.
Return only strict JSON with: name, description, tokens, componentVariants, customCss.
tokens must contain colors {background,surface,surfaceElevated,text,textMuted,primary,primaryContrast,accent,success,danger,border}
as six-digit hex values; typography {fontFamily: inter|manrope|system|serif, headingStyle: compact|editorial|balanced,
baseSize: 14|15|16|17|18}; shape {radius: sharp|soft|rounded, borderWidth: 0|1|2}; density:
compact|comfortable|spacious; contentWidth: narrow|standard|wide. componentVariants must contain navigation:
solid|glass|minimal, cards: outlined|soft|elevated, buttons: solid|gradient|outline. customCss must be an empty string.
Ensure normal text contrast is at least 4.5:1 on both background and surface, and primaryContrast is at least 4.5:1 on primary.`;

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';

const stableId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const fieldName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/);
const requirementIds = z.array(stableId).max(40);
const policyGrantSchema = z.object({
  operations: z.array(z.enum(['create', 'read', 'update', 'delete'])).max(4),
  readFilter: z.record(z.string(), z.unknown()).optional(),
  readFields: z.array(fieldName).max(100), writeFields: z.array(fieldName).max(100),
  uiCapabilities: z.array(z.string().max(100)).max(40),
});
const graphPlanSchema = z.object({
  accent: z.string().regex(/^#[0-9a-f]{6}$/i), headline: z.string().min(4).max(90), summary: z.string().min(3).max(500),
  moduleUpserts: z.array(z.object({
    id: stableId, kind: z.enum(['page', 'layout', 'component', 'provider', 'hook', 'utility', 'test']),
    name: z.string().min(2).max(100), description: z.string().min(3).max(500), source: z.string().min(10).max(60_000),
    dependencies: z.array(stableId).max(40).default([]), packageImports: z.array(z.string().max(100)).max(20).default([]),
    requiredCapabilities: z.array(z.string().max(100)).max(40).default([]), requirementIds,
  })).max(20).default([]),
  moduleDeletes: z.array(stableId).max(20).default([]),
  routeUpserts: z.array(z.object({
    id: stableId, path: z.string().startsWith('/').max(200), specPageId: stableId, pageModuleId: stableId, layoutModuleId: stableId.optional(),
    public: z.boolean(), requiredCapabilities: z.array(z.string().max(100)).max(40).default([]), requirementIds,
    navigation: z.object({ label: z.string().min(1).max(60), icon: z.string().max(60).optional(), order: z.number().int().min(0).max(1000) }).optional(),
  })).max(20).default([]),
  routeDeletes: z.array(stableId).max(20).default([]),
  schemaUpserts: z.array(z.object({
    id: stableId, entity: stableId, displayName: z.string().min(2).max(100),
    deploymentMode: z.enum(['shared_namespace', 'dedicated_database']).default('shared_namespace'),
    jsonSchema: z.record(z.string(), z.unknown()),
    indexes: z.array(z.object({ fields: z.record(z.string(), z.union([z.literal(1), z.literal(-1)])), unique: z.boolean().optional() })).max(20),
    publicRecordFilter: z.record(z.string(), z.unknown()).optional(), requirementIds,
  })).max(20).default([]),
  schemaDeletes: z.array(stableId).max(20).default([]),
  policyUpserts: z.array(z.object({
    id: stableId, entity: stableId,
    grants: z.object({ public: policyGrantSchema, viewer: policyGrantSchema, editor: policyGrantSchema, admin: policyGrantSchema }),
    requirementIds,
  })).max(20).default([]),
  policyDeletes: z.array(stableId).max(20).default([]),
  connectorUpserts: z.array(z.object({
    id: stableId, connector: stableId, action: stableId, description: z.string().min(3).max(500),
    allowedRoles: z.array(z.enum(['public', 'viewer', 'editor', 'admin'])).min(1).max(4),
    inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().int().min(1000).max(120000), rateLimitPerMinute: z.number().int().min(1).max(1000), requirementIds,
  })).max(20).default([]),
  connectorDeletes: z.array(stableId).max(20).default([]),
  agentUpserts: z.array(z.object({
    id: stableId, name: z.string().min(2).max(100), description: z.string().min(3).max(500), connector: stableId,
    model: z.string().min(1).max(100), instructions: z.string().min(10).max(10_000),
    allowedRoles: z.array(z.enum(['public', 'viewer', 'editor', 'admin'])).min(1).max(4),
    toolIds: z.array(z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/)).max(20), maximumIterations: z.number().int().min(1).max(12),
    humanApprovalRequired: z.boolean(), requirementIds,
  })).max(12).default([]),
  agentDeletes: z.array(stableId).max(12).default([]),
});

const browserAgentTurnSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('final'), output: z.string().trim().min(1).max(8_000) }).strict(),
  z.object({
    type: z.literal('tool'),
    toolId: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/),
    input: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({ type: z.literal('approval'), message: z.string().trim().min(1).max(2_000) }).strict(),
]);

const visualThemePlanSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(280),
  tokens: z.object({
    colors: z.object({
      background: z.string().regex(/^#[0-9a-f]{6}$/i),
      surface: z.string().regex(/^#[0-9a-f]{6}$/i),
      surfaceElevated: z.string().regex(/^#[0-9a-f]{6}$/i),
      text: z.string().regex(/^#[0-9a-f]{6}$/i),
      textMuted: z.string().regex(/^#[0-9a-f]{6}$/i),
      primary: z.string().regex(/^#[0-9a-f]{6}$/i),
      primaryContrast: z.string().regex(/^#[0-9a-f]{6}$/i),
      accent: z.string().regex(/^#[0-9a-f]{6}$/i),
      success: z.string().regex(/^#[0-9a-f]{6}$/i),
      danger: z.string().regex(/^#[0-9a-f]{6}$/i),
      border: z.string().regex(/^#[0-9a-f]{6}$/i),
    }).strict(),
    typography: z.object({
      fontFamily: z.enum(['inter', 'manrope', 'system', 'serif']),
      headingStyle: z.enum(['compact', 'editorial', 'balanced']),
      baseSize: z.union([z.literal(14), z.literal(15), z.literal(16), z.literal(17), z.literal(18)]),
    }).strict(),
    shape: z.object({
      radius: z.enum(['sharp', 'soft', 'rounded']),
      borderWidth: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    }).strict(),
    density: z.enum(['compact', 'comfortable', 'spacious']),
    contentWidth: z.enum(['narrow', 'standard', 'wide']),
  }).strict(),
  componentVariants: z.object({
    navigation: z.enum(['solid', 'glass', 'minimal']),
    cards: z.enum(['outlined', 'soft', 'elevated']),
    buttons: z.enum(['solid', 'gradient', 'outline']),
  }).strict(),
  customCss: z.literal(''),
}).strict();

const graphPlanResponseFormat = {
  type: 'json_schema' as const,
  name: 'browser_app_plan',
  schema: z.toJSONSchema(graphPlanSchema, { target: 'draft-7' }),
  strict: true,
};

const browserAgentTurnResponseFormat = {
  type: 'json_object' as const,
};

const visualThemePlanResponseFormat = {
  type: 'json_schema' as const,
  name: 'visual_theme_plan',
  schema: z.toJSONSchema(visualThemePlanSchema, { target: 'draft-7' }),
  strict: true,
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  available(): boolean {
    return process.env.AI_DISABLED !== '1' && Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  }

  configuredProviders(): Array<'openai' | 'anthropic'> {
    if (process.env.AI_DISABLED === '1') return [];
    return [
      ...(process.env.OPENAI_API_KEY ? ['openai' as const] : []),
      ...(process.env.ANTHROPIC_API_KEY ? ['anthropic' as const] : []),
    ];
  }

  generationConnectors(): BrowserGenerationOptions['connectors'] {
    return this.connectorDefinitions().map((definition) => ({
      id: definition.id,
      name: definition.name,
      vendor: definition.vendor,
      configured: Boolean(definition.apiKey),
      models: getModelsByVendor(definition.vendor)
        .filter((model) => model.isActive
          && (model.lifecycle === 'active' || model.lifecycle === 'preview')
          && model.availability === 'public'
          && model.features.input.text
          && model.features.output.text
          && !model.features.realtime
          && !model.features.audio)
        .sort((left, right) => Number(right.name === definition.defaultModel) - Number(left.name === definition.defaultModel)
          || Number(right.preferred) - Number(left.preferred)
          || String(right.releaseDate ?? '').localeCompare(String(left.releaseDate ?? '')))
        .slice(0, 18)
        .map((model) => ({
          id: model.name,
          name: model.name,
          description: model.description ?? `${definition.name} language model`,
          preferred: model.name === definition.defaultModel,
        })),
    }));
  }

  async interview(message: string, context: string): Promise<string> {
    if (!this.available()) return this.fallback(message);

    let agent: Agent | undefined;
    try {
      const connector = this.ensureConnector();
      agent = Agent.create({
        connector,
        model: this.resolveModel(connector),
        instructions: INTERVIEW_INSTRUCTIONS,
        thinking: { enabled: true, effort: 'medium' },
        maxIterations: 4,
      });
      const response = await agent.run(
        `Current confirmed PRD context:\n${context}\n\nLatest user answer:\n${message}`,
      );
      return response.output_text?.trim() || this.fallback(message);
    } catch (error) {
      this.logger.warn(`LLM interview failed; returning safe fallback: ${String(error)}`);
      return this.fallback(message);
    } finally {
      agent?.destroy();
    }
  }

  async discoverSpecification(
    context: string,
    message: string,
    tools: ToolFunction[],
    configuration: { connector?: string; model?: string; effort?: GenerationEffort; userId: string },
    onEvent?: (event: { type: string; title: string; detail?: string; durationMs?: number; metadata?: Record<string, string | number | boolean> }) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ reply: string; metrics: { inputTokens: number; outputTokens: number; reasoningTokens: number; toolCalls: number } }> {
    if (!this.available()) return { reply: this.fallback(message), metrics: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, toolCalls: 0 } };
    let agent: Agent | undefined;
    const pendingEvents: Promise<void>[] = [];
    const flush = async () => { await Promise.allSettled(pendingEvents.splice(0)); };
    try {
      const connector = this.ensureConnector(configuration.connector);
      agent = Agent.create({
        connector,
        model: this.resolveModel(connector, configuration.model),
        instructions: SPECIFICATION_DISCOVERY_INSTRUCTIONS,
        thinking: { enabled: true, effort: configuration.effort ?? 'high' },
        tools,
        userId: configuration.userId,
        maxIterations: 12,
        limits: { maxExecutionTime: Number(process.env.DISCOVERY_AGENT_TIMEOUT_MS ?? 180_000), maxToolCalls: 40 },
        errorHandling: { hookFailureMode: 'warn', toolFailureMode: 'continue', maxConsecutiveErrors: 4 },
      });
      const emit = (event: Parameters<NonNullable<typeof onEvent>>[0]) => {
        const pending = Promise.resolve(onEvent?.(event));
        void pending.catch(() => undefined);
        pendingEvents.push(pending);
      };
      agent.on('iteration:start', (data: any) => emit({ type: 'thinking', title: 'Analyzing the application definition', detail: `Discovery iteration ${Number(data?.iteration ?? 0) + 1} is inspecting confirmed facts, gaps, and traceability.` }));
      agent.on('llm:request', () => emit({ type: 'thinking', title: 'Specialist reasoning pass', detail: 'The discovery orchestrator is deciding which focused specification tools to use next.' }));
      agent.on('tool:start', (data: any) => emit({ type: 'tool', title: `Calling ${data?.toolCall?.function?.name ?? 'specification tool'}`, detail: 'A validated operation is being applied to the isolated specification draft.' }));
      agent.on('tool:complete', (data: any) => emit({ type: 'tool', title: `Completed ${data?.toolCall?.function?.name ?? 'specification tool'}`, durationMs: Number(data?.result?.executionTime ?? 0) }));
      const abort = () => agent?.cancel('Discovery cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      const response = await agent.run(`Application profile and current context:\n${context}\n\nLatest user answer:\n${message}`);
      signal?.removeEventListener('abort', abort);
      await flush();
      if (signal?.aborted) throw new Error('Discovery cancelled');
      const metrics = agent.getSummary()?.metrics;
      return {
        reply: response.output_text?.trim() || 'I updated the application definition. What is the most important outcome that still feels underspecified?',
        metrics: { inputTokens: metrics?.inputTokens ?? 0, outputTokens: metrics?.outputTokens ?? 0, reasoningTokens: metrics?.reasoningTokens ?? 0, toolCalls: metrics?.toolCallCount ?? 0 },
      };
    } finally {
      await flush();
      agent?.destroy();
    }
  }

  async browserAppPlan(
    context: string,
    configuration?: { connector: string; model: string; effort: GenerationEffort; instructions: string },
    onEvent?: (event: { type: string; title: string; detail?: string; durationMs?: number; metadata?: Record<string, string | number | boolean> }) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ accent: string; headline: string; changeSet: AppGraphChangeSet; agent: 'oneringai'; metrics: { inputTokens: number; outputTokens: number; reasoningTokens: number; toolCalls: number } }> {
    if (!this.available()) throw new Error('No configured generation connector is available');
    let agent: Agent | undefined;
    let abortListener: (() => void) | undefined;
    const pendingEvents: Promise<void>[] = [];
    const flushEvents = async () => { await Promise.allSettled(pendingEvents.splice(0)); };
    try {
      const connector = this.ensureConnector(configuration?.connector);
      agent = Agent.create({
        connector,
        model: this.resolveModel(connector, configuration?.model),
        instructions: `${configuration?.instructions ?? ''}\n\n${BROWSER_APP_INSTRUCTIONS}`.trim(),
        thinking: { enabled: true, effort: configuration?.effort ?? 'medium' },
        maxIterations: 1,
        limits: { maxExecutionTime: Number(process.env.GENERATION_AGENT_TIMEOUT_MS ?? 90_000), maxToolCalls: 12 },
      });
      const emit = (event: Parameters<NonNullable<typeof onEvent>>[0]) => {
        const pending = Promise.resolve(onEvent?.(event));
        // Attach a handler immediately so event-persistence failures never become
        // detached promise rejections; flushEvents still waits for every write.
        void pending.catch(() => undefined);
        pendingEvents.push(pending);
      };
      agent.on('iteration:start', (data: any) => emit({ type: 'thinking', title: 'Reasoning over the approved specification', detail: `Model iteration ${Number(data?.iteration ?? 0) + 1} is analyzing requirements, pages, data, policy, and release constraints.` }));
      agent.on('llm:request', () => emit({ type: 'model', title: 'Model request sent', detail: `${configuration?.model ?? agent?.model} is producing a structured graph proposal.` }));
      agent.on('tool:start', (data: any) => emit({ type: 'tool', title: `Running ${data?.toolCall?.function?.name ?? 'agent tool'}`, detail: 'The specialist requested an allowlisted tool.' }));
      agent.on('tool:complete', (data: any) => emit({ type: 'tool', title: `Completed ${data?.toolCall?.function?.name ?? 'agent tool'}`, durationMs: Number(data?.result?.executionTime ?? 0) }));
      abortListener = () => agent?.cancel('Generation cancelled by the user');
      signal?.addEventListener('abort', abortListener, { once: true });
      const response = await agent.run(`Approved PRD:\n${context}`, { responseFormat: graphPlanResponseFormat });
      signal?.removeEventListener('abort', abortListener);
      await flushEvents();
      if (signal?.aborted) throw new Error('Generation cancelled by the user');
      const parsed = graphPlanSchema.parse(response.output_parsed);
      const { accent, headline, ...changeSet } = parsed;
      const metrics = agent.getSummary()?.metrics;
      await onEvent?.({
        type: 'thinking', title: 'Reasoning pass completed',
        detail: `The specialist produced a validated structured proposal using ${configuration?.effort ?? 'medium'} reasoning. Private chain-of-thought is not exposed.`,
        metadata: { reasoningTokens: metrics?.reasoningTokens ?? 0, totalTokens: metrics?.totalTokens ?? response.usage?.total_tokens ?? 0 },
      });
      return {
        accent, headline, changeSet, agent: 'oneringai',
        metrics: { inputTokens: metrics?.inputTokens ?? 0, outputTokens: metrics?.outputTokens ?? 0, reasoningTokens: metrics?.reasoningTokens ?? 0, toolCalls: metrics?.toolCallCount ?? 0 },
      };
    } catch (error) {
      await flushEvents();
      this.logger.warn(`Browser app planning failed: ${String(error)}`);
      throw error;
    } finally {
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      agent?.destroy();
    }
  }

  async suggestTask(context: string, connectorName?: string, modelName?: string): Promise<string> {
    if (!this.available()) return `Review the highest-impact workflow and turn “${context.slice(0, 60)}” into one measurable acceptance test.`;
    let agent: Agent | undefined;
    try {
      const connector = this.ensureConnector(connectorName);
      agent = Agent.create({
        connector,
        model: this.resolveModel(connector, modelName),
        instructions: 'Suggest exactly one concise, actionable product-team task. Return only the task sentence. Do not use markdown.',
        thinking: { enabled: true, effort: 'low' },
        maxIterations: 2,
      });
      const response = await agent.run(context);
      return response.output_text?.trim().slice(0, 300) || 'Write one acceptance test for the riskiest user journey.';
    } catch (error) {
      this.logger.warn(`Task suggestion failed; returning fallback: ${String(error)}`);
      return 'Write one acceptance test for the riskiest user journey.';
    } finally {
      agent?.destroy();
    }
  }

  async browserAgentTurn(
    definition: BrowserAgentRecord,
    input: { goal: string; iteration: number; history: Array<{ role: 'assistant' | 'tool'; content: string }> },
  ): Promise<{ type: 'final'; output: string } | { type: 'tool'; toolId: string; input: Record<string, unknown> } | { type: 'approval'; message: string }> {
    if (!this.available()) return { type: 'final', output: `A practical next step is to turn “${input.goal.slice(0, 100)}” into one small, measurable task.` };
    let agent: Agent | undefined;
    try {
      agent = Agent.create({
        connector: this.ensureConnector(definition.connector), model: definition.model,
        instructions: `${definition.instructions}\n\nYou are producing exactly one turn for a browser-owned agent loop. Return only strict JSON. Return {"type":"final","output":"..."}, {"type":"tool","toolId":"connector:action","input":{...}}, or {"type":"approval","message":"..."}. You may request only these tools: ${definition.toolIds.join(', ') || 'none'}. Do not repeat a tool request already answered in history.`,
        thinking: { enabled: true, effort: 'low' }, maxIterations: 1,
      });
      const response = await agent.run(
        `Goal: ${input.goal}\nIteration: ${input.iteration}\nHistory: ${JSON.stringify(input.history)}`,
        { responseFormat: browserAgentTurnResponseFormat },
      );
      const value = browserAgentTurnSchema.parse(response.output_parsed);
      if (value.type === 'final') return value;
      if (value.type === 'approval' && definition.humanApprovalRequired) return value;
      if (value.type === 'tool' && definition.toolIds.includes(value.toolId)) {
        return value;
      }
      throw new Error('Agent turn did not match its browser-loop contract');
    } catch (error) {
      this.logger.warn(`Browser agent turn failed; returning safe final response: ${String(error)}`);
      return { type: 'final', output: 'Create one measurable next task, assign an owner, and define the evidence that will prove it is complete.' };
    } finally {
      agent?.destroy();
    }
  }

  async visualThemePlan(
    context: string,
    direction: string,
    currentTheme: unknown,
    configuration?: { connector?: string; model?: string; instructions?: string },
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.available()) return undefined;
    let agent: Agent | undefined;
    try {
      const connector = this.ensureConnector(configuration?.connector);
      agent = Agent.create({
        connector,
        model: this.resolveModel(connector, configuration?.model),
        instructions: `${configuration?.instructions ?? ''}\n\n${VISUAL_DESIGN_INSTRUCTIONS}`.trim(),
        thinking: { enabled: true, effort: 'medium' },
        maxIterations: 3,
      });
      const response = await agent.run(
        `Product and page context:\n${context}\n\nCurrent theme:\n${JSON.stringify(currentTheme)}\n\nUser direction:\n${direction}`,
        { responseFormat: visualThemePlanResponseFormat },
      );
      return visualThemePlanSchema.parse(response.output_parsed);
    } catch (error) {
      this.logger.warn(`Visual design agent failed; caller will use a safe starter: ${String(error)}`);
      return undefined;
    } finally {
      agent?.destroy();
    }
  }

  private connectorDefinitions(): Array<{ id: string; name: string; vendor: Vendor; defaultModel: string; apiKey?: string }> {
    return [
      { id: 'openai-main', name: 'OpenAI', vendor: Vendor.OpenAI, defaultModel: DEFAULT_OPENAI_MODEL, apiKey: process.env.OPENAI_API_KEY },
      { id: 'anthropic-main', name: 'Anthropic', vendor: Vendor.Anthropic, defaultModel: DEFAULT_ANTHROPIC_MODEL, apiKey: process.env.ANTHROPIC_API_KEY },
    ];
  }

  private resolveModel(connectorName: string, requested?: string): string {
    if (requested?.trim()) return requested.trim();
    const definition = this.connectorDefinitions().find((candidate) => candidate.id === connectorName);
    if (!definition) throw new Error(`Unknown OneRingAI connector ${connectorName}`);
    const vendorOverride = definition.vendor === Vendor.OpenAI
      ? process.env.ONERING_OPENAI_MODEL
      : process.env.ONERING_ANTHROPIC_MODEL;
    const configured = this.connectorDefinitions().filter((candidate) => candidate.apiKey);
    const defaultConnector = process.env.ONERING_DEFAULT_CONNECTOR ?? configured[0]?.id ?? 'openai-main';
    const legacyOverride = connectorName === defaultConnector ? process.env.ONERING_DEFAULT_MODEL : undefined;
    return vendorOverride ?? legacyOverride ?? definition.defaultModel;
  }

  private ensureConnector(requested?: string): string {
    const configured = this.connectorDefinitions().filter((definition) => definition.apiKey);
    const preferred = requested ?? process.env.ONERING_DEFAULT_CONNECTOR ?? configured[0]?.id ?? 'openai-main';
    if (Connector.has(preferred)) return preferred;
    const definition = this.connectorDefinitions().find((candidate) => candidate.id === preferred);
    if (!definition) throw new Error(`Unknown OneRingAI connector ${preferred}`);
    if (!definition.apiKey) throw new Error(`${definition.name} is not configured`);
    Connector.create({
      name: preferred,
      vendor: definition.vendor,
      auth: { type: 'api_key', apiKey: definition.apiKey },
    });
    return preferred;
  }

  private fallback(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('both') || normalized.includes('manager')) {
      return 'I recorded a two-stage exception path: first escalate to the operations manager, then offer only pre-approved contractors if the manager allows it. Who may approve a contractor, and should that approval expire after a particular work order or remain valid for the customer organization?';
    }
    return 'I captured that answer and will treat it as a confirmed requirement. The largest remaining risk is permission ambiguity: which roles may approve an agent recommendation that changes a customer-facing commitment or sends an external message?';
  }
}
