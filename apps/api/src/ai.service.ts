import { Injectable, Logger } from '@nestjs/common';
import { Agent, Connector, Vendor, getModelsByVendor } from '@everworker/oneringai';
import { z } from 'zod';
import type { AppGraphChangeSet, BrowserAgentRecord, BrowserGenerationOptions, GenerationEffort } from './browser-app.domain.js';

const INTERVIEW_INSTRUCTIONS = `You are One Ring's senior product discovery interviewer.
The user is not assumed to be technically proficient. Be diligent without overwhelming them.
Maintain a product requirements document by uncovering goals, personas, workflows, permissions,
edge cases, exceptions, failure behavior, data sensitivity, integrations, non-goals, measurable
acceptance criteria, and production qualities. Ask exactly one high-leverage question at a time.
Briefly state what you inferred before asking. Never ask the user to design the software.`;

const BROWSER_APP_INSTRUCTIONS = `You are a One Ring browser-native React application architect.
Turn an approved PRD and current component graph into a safe, focused implementation revision. The application
uses declarative routes, Mongo-backed component modules, a secure CRUD gateway, declarative role
policies, browser-orchestrated agents, and allowlisted connector actions. Return only strict JSON with keys accent,
headline, summary, moduleUpserts, moduleDeletes, routeUpserts, routeDeletes, schemaUpserts, schemaDeletes,
policyUpserts, policyDeletes, agentUpserts, agentDeletes.
Use stable lowercase IDs. You may create or revise pages, components, routes, and browser agent definitions, but every
artifact must cite requirementIds from the supplied specification. Source must be complete TSX, use only React,
react-router-dom, app:runtime, and app:module imports, preserve server security behavior, and never use raw HTML,
eval, cookies, credentials, or secrets. Browser agent loops use runAgent from app:runtime; never call model vendors directly.`;

const VISUAL_DESIGN_INSTRUCTIONS = `You are the dedicated visual design-system agent for a browser-native React application.
Translate product context and a user's visual direction into a cohesive, accessible design system—not a random palette.
Return only strict JSON with: name, description, tokens, componentVariants, customCss.
tokens must contain colors {background,surface,surfaceElevated,text,textMuted,primary,primaryContrast,accent,success,danger,border}
as six-digit hex values; typography {fontFamily: inter|manrope|system|serif, headingStyle: compact|editorial|balanced,
baseSize: 14|15|16|17|18}; shape {radius: sharp|soft|rounded, borderWidth: 0|1|2}; density:
compact|comfortable|spacious; contentWidth: narrow|standard|wide. componentVariants must contain navigation:
solid|glass|minimal, cards: outlined|soft|elevated, buttons: solid|gradient|outline. customCss must be an empty string.
Ensure normal text contrast is at least 4.5:1 on both background and surface, and primaryContrast is at least 4.5:1 on primary.`;

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
  agentUpserts: z.array(z.object({
    id: stableId, name: z.string().min(2).max(100), description: z.string().min(3).max(500), connector: stableId,
    model: z.string().min(1).max(100), instructions: z.string().min(10).max(10_000),
    allowedRoles: z.array(z.enum(['public', 'viewer', 'editor', 'admin'])).min(1).max(4),
    toolIds: z.array(z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/)).max(20), maximumIterations: z.number().int().min(1).max(12),
    humanApprovalRequired: z.boolean(), requirementIds,
  })).max(12).default([]),
  agentDeletes: z.array(stableId).max(12).default([]),
});

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
        .filter((model) => model.isActive)
        .sort((left, right) => Number(right.preferred) - Number(left.preferred)
          || String(right.releaseDate ?? '').localeCompare(String(left.releaseDate ?? '')))
        .slice(0, 40)
        .map((model) => ({
          id: model.name,
          name: model.name,
          description: model.description ?? `${definition.name} language model`,
          preferred: Boolean(model.preferred),
        })),
    }));
  }

  async interview(message: string, context: string): Promise<string> {
    if (!this.available()) return this.fallback(message);

    try {
      const connector = this.ensureConnector();
      const agent = Agent.create({
        connector,
        model: process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
        instructions: INTERVIEW_INSTRUCTIONS,
        temperature: 0.25,
        maxIterations: 4,
      });
      const response = await agent.run(
        `Current confirmed PRD context:\n${context}\n\nLatest user answer:\n${message}`,
      );
      return response.output_text?.trim() || this.fallback(message);
    } catch (error) {
      this.logger.warn(`LLM interview failed; returning safe fallback: ${String(error)}`);
      return this.fallback(message);
    }
  }

  async browserAppPlan(
    context: string,
    configuration?: { connector: string; model: string; effort: GenerationEffort; instructions: string },
  ): Promise<{ accent: string; headline: string; changeSet: AppGraphChangeSet; agent: 'oneringai' | 'fallback' }> {
    const fallback = {
      accent: '#806cff', headline: 'Turn shared work into visible progress.', agent: 'fallback' as const,
      changeSet: {
        summary: 'Verified the current graph without unsafe changes.',
        moduleUpserts: [], moduleDeletes: [], routeUpserts: [], routeDeletes: [],
        schemaUpserts: [], schemaDeletes: [], policyUpserts: [], policyDeletes: [], agentUpserts: [], agentDeletes: [],
      },
    };
    if (!this.available()) return fallback;
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(configuration?.connector),
        model: configuration?.model ?? process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
        instructions: `${configuration?.instructions ?? ''}\n\n${BROWSER_APP_INSTRUCTIONS}`.trim(),
        thinking: { enabled: true, effort: configuration?.effort ?? 'medium' },
        maxIterations: 3,
      });
      const response = await agent.run(`Approved PRD:\n${context}`);
      const raw = response.output_text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, '') ?? '';
      const parsed = graphPlanSchema.parse(JSON.parse(raw));
      const { accent, headline, ...changeSet } = parsed;
      return { accent, headline, changeSet, agent: 'oneringai' };
    } catch (error) {
      this.logger.warn(`Browser app planning failed; using safe plan: ${String(error)}`);
      return fallback;
    }
  }

  async suggestTask(context: string, connectorName?: string, modelName?: string): Promise<string> {
    if (!this.available()) return `Review the highest-impact workflow and turn “${context.slice(0, 60)}” into one measurable acceptance test.`;
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(connectorName),
        model: modelName ?? process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
        instructions: 'Suggest exactly one concise, actionable product-team task. Return only the task sentence. Do not use markdown.',
        temperature: 0.35,
        maxIterations: 2,
      });
      const response = await agent.run(context);
      return response.output_text?.trim().slice(0, 300) || 'Write one acceptance test for the riskiest user journey.';
    } catch (error) {
      this.logger.warn(`Task suggestion failed; returning fallback: ${String(error)}`);
      return 'Write one acceptance test for the riskiest user journey.';
    }
  }

  async browserAgentTurn(
    definition: BrowserAgentRecord,
    input: { goal: string; iteration: number; history: Array<{ role: 'assistant' | 'tool'; content: string }> },
  ): Promise<{ type: 'final'; output: string } | { type: 'tool'; toolId: string; input: Record<string, unknown> } | { type: 'approval'; message: string }> {
    if (!this.available()) return { type: 'final', output: `A practical next step is to turn “${input.goal.slice(0, 100)}” into one small, measurable task.` };
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(definition.connector), model: definition.model,
        instructions: `${definition.instructions}\n\nYou are producing exactly one turn for a browser-owned agent loop. Return only strict JSON. Return {"type":"final","output":"..."}, {"type":"tool","toolId":"connector:action","input":{...}}, or {"type":"approval","message":"..."}. You may request only these tools: ${definition.toolIds.join(', ') || 'none'}. Do not repeat a tool request already answered in history.`,
        temperature: 0.2, maxIterations: 1,
      });
      const response = await agent.run(`Goal: ${input.goal}\nIteration: ${input.iteration}\nHistory: ${JSON.stringify(input.history)}`);
      const raw = response.output_text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, '') ?? '';
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (value.type === 'final' && typeof value.output === 'string' && value.output.trim()) return { type: 'final', output: value.output.trim().slice(0, 8_000) };
      if (value.type === 'approval' && typeof value.message === 'string' && definition.humanApprovalRequired) return { type: 'approval', message: value.message.trim().slice(0, 2_000) };
      if (value.type === 'tool' && typeof value.toolId === 'string' && definition.toolIds.includes(value.toolId) && value.input && typeof value.input === 'object' && !Array.isArray(value.input)) {
        return { type: 'tool', toolId: value.toolId, input: value.input as Record<string, unknown> };
      }
      throw new Error('Agent turn did not match its browser-loop contract');
    } catch (error) {
      this.logger.warn(`Browser agent turn failed; returning safe final response: ${String(error)}`);
      return { type: 'final', output: 'Create one measurable next task, assign an owner, and define the evidence that will prove it is complete.' };
    }
  }

  async visualThemePlan(
    context: string,
    direction: string,
    currentTheme: unknown,
    configuration?: { connector?: string; model?: string; instructions?: string },
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.available()) return undefined;
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(configuration?.connector),
        model: configuration?.model || process.env.ONERING_DEFAULT_MODEL || 'gpt-5.4-mini',
        instructions: `${configuration?.instructions ?? ''}\n\n${VISUAL_DESIGN_INSTRUCTIONS}`.trim(),
        temperature: 0.25,
        maxIterations: 3,
      });
      const response = await agent.run(
        `Product and page context:\n${context}\n\nCurrent theme:\n${JSON.stringify(currentTheme)}\n\nUser direction:\n${direction}`,
      );
      const raw = response.output_text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, '') ?? '';
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`Visual design agent failed; caller will use a safe starter: ${String(error)}`);
      return undefined;
    }
  }

  private connectorDefinitions(): Array<{ id: string; name: string; vendor: Vendor; apiKey?: string }> {
    return [
      { id: 'openai-main', name: 'OpenAI', vendor: Vendor.OpenAI, apiKey: process.env.OPENAI_API_KEY },
      { id: 'anthropic-main', name: 'Anthropic', vendor: Vendor.Anthropic, apiKey: process.env.ANTHROPIC_API_KEY },
    ];
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
