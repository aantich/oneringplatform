import { describe, expect, it } from 'vitest';
import { AiService } from './ai.service.js';
import { loadPlatformEnvironment } from './environment.js';

loadPlatformEnvironment();

const liveDescribe = process.env.RUN_LIVE_AI_TESTS === '1' ? describe : describe.skip;

liveDescribe('live AI connector smoke tests', () => {
  const ai = new AiService();
  const prompt = 'Return one concise task for validating a secure multi-tenant product launch.';

  it('calls OpenAI through oneringai', async () => {
    expect(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY must be configured').toBeTruthy();
    const output = await ai.suggestTask(
      prompt,
      'openai-live-smoke',
      process.env.ONERING_OPENAI_MODEL ?? process.env.ONERING_DEFAULT_MODEL ?? 'gpt-5.4-mini',
    );
    expect(output.length).toBeGreaterThan(10);
    expect(output.length).toBeLessThanOrEqual(300);
  }, 60_000);

  it('calls Anthropic through oneringai', async () => {
    expect(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY must be configured').toBeTruthy();
    const output = await ai.suggestTask(
      prompt,
      'anthropic-live-smoke',
      process.env.ONERING_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    );
    expect(output.length).toBeGreaterThan(10);
    expect(output.length).toBeLessThanOrEqual(300);
  }, 60_000);
});
