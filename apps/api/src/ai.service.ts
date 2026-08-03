import { Injectable, Logger } from '@nestjs/common';
import { Agent, Connector, Vendor } from '@everworker/oneringai';

const INTERVIEW_INSTRUCTIONS = `You are One Ring's senior product discovery interviewer.
The user is not assumed to be technically proficient. Be diligent without overwhelming them.
Maintain a product requirements document by uncovering goals, personas, workflows, permissions,
edge cases, exceptions, failure behavior, data sensitivity, integrations, non-goals, measurable
acceptance criteria, and production qualities. Ask exactly one high-leverage question at a time.
Briefly state what you inferred before asking. Never ask the user to design the software.`;

const BROWSER_APP_INSTRUCTIONS = `You are a One Ring browser-native React application architect.
Turn an approved PRD and current component graph into a safe, focused implementation revision. The application
uses declarative routes, Mongo-backed component modules, a secure CRUD gateway, declarative role
policies, and allowlisted connector actions. Return only strict JSON with keys accent, headline, and modulePatches.
accent must be a six-digit CSS hex color. headline must be under 90 characters. modulePatches is an optional array
of {moduleId,description,source}; only patch module IDs supplied in the prompt. Source must be complete TSX, use only
React and app:runtime/app:module imports, preserve security behavior, and never use raw HTML, eval, cookies, or secrets.`;

const VISUAL_DESIGN_INSTRUCTIONS = `You are the dedicated visual design-system agent for a browser-native React application.
Translate product context and a user's visual direction into a cohesive, accessible design system—not a random palette.
Return only strict JSON with: name, description, tokens, componentVariants, customCss.
tokens must contain colors {background,surface,surfaceElevated,text,textMuted,primary,primaryContrast,accent,success,danger,border}
as six-digit hex values; typography {fontFamily: inter|manrope|system|serif, headingStyle: compact|editorial|balanced,
baseSize: 14|15|16|17|18}; shape {radius: sharp|soft|rounded, borderWidth: 0|1|2}; density:
compact|comfortable|spacious; contentWidth: narrow|standard|wide. componentVariants must contain navigation:
solid|glass|minimal, cards: outlined|soft|elevated, buttons: solid|gradient|outline. customCss must be an empty string.
Ensure normal text contrast is at least 4.5:1 on both background and surface, and primaryContrast is at least 4.5:1 on primary.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  available(): boolean {
    return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
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

  async browserAppPlan(context: string): Promise<{ accent: string; headline: string; modulePatches: Array<{ moduleId: string; description: string; source: string }>; agent: 'oneringai' | 'fallback' }> {
    if (!this.available()) return { accent: '#806cff', headline: 'Turn shared work into visible progress.', modulePatches: [], agent: 'fallback' };
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(),
        model: process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
        instructions: BROWSER_APP_INSTRUCTIONS,
        temperature: 0.2,
        maxIterations: 3,
      });
      const response = await agent.run(`Approved PRD:\n${context}`);
      const raw = response.output_text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, '') ?? '';
      const parsed = JSON.parse(raw) as { accent?: unknown; headline?: unknown; modulePatches?: unknown };
      if (typeof parsed.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(parsed.accent)) throw new Error('Invalid accent');
      if (typeof parsed.headline !== 'string' || parsed.headline.length < 4 || parsed.headline.length > 90) throw new Error('Invalid headline');
      const modulePatches = Array.isArray(parsed.modulePatches) ? parsed.modulePatches.slice(0, 8).flatMap((patch) => {
        if (!patch || typeof patch !== 'object') return [];
        const value = patch as Record<string, unknown>;
        return typeof value.moduleId === 'string' && typeof value.source === 'string' && value.source.length <= 60_000
          ? [{ moduleId: value.moduleId, source: value.source, description: typeof value.description === 'string' ? value.description.slice(0, 280) : 'Agent-generated implementation revision.' }] : [];
      }) : [];
      return { accent: parsed.accent, headline: parsed.headline, modulePatches, agent: 'oneringai' };
    } catch (error) {
      this.logger.warn(`Browser app planning failed; using safe plan: ${String(error)}`);
      return { accent: '#806cff', headline: 'Turn shared work into visible progress.', modulePatches: [], agent: 'fallback' };
    }
  }

  async suggestTask(context: string, connectorName?: string): Promise<string> {
    if (!this.available()) return `Review the highest-impact workflow and turn “${context.slice(0, 60)}” into one measurable acceptance test.`;
    try {
      const agent = Agent.create({
        connector: this.ensureConnector(connectorName),
        model: process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
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

  private ensureConnector(requested?: string): string {
    const preferred = requested ?? process.env.ONERING_DEFAULT_CONNECTOR ?? 'openai-main';
    if (Connector.has(preferred)) return preferred;

    if (preferred.startsWith('anthropic') && process.env.ANTHROPIC_API_KEY) {
      Connector.create({
        name: preferred,
        vendor: Vendor.Anthropic,
        auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY },
      });
      return preferred;
    }

    if (process.env.OPENAI_API_KEY) {
      Connector.create({
        name: preferred,
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY },
      });
      return preferred;
    }

    const anthropic = 'anthropic-main';
    if (!Connector.has(anthropic)) {
      Connector.create({
        name: anthropic,
        vendor: Vendor.Anthropic,
        auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY ?? '' },
      });
    }
    return anthropic;
  }

  private fallback(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('both') || normalized.includes('manager')) {
      return 'I recorded a two-stage exception path: first escalate to the operations manager, then offer only pre-approved contractors if the manager allows it. Who may approve a contractor, and should that approval expire after a particular work order or remain valid for the customer organization?';
    }
    return 'I captured that answer and will treat it as a confirmed requirement. The largest remaining risk is permission ambiguity: which roles may approve an agent recommendation that changes a customer-facing commitment or sends an external message?';
  }
}
