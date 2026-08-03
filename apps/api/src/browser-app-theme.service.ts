import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ThemeRevision } from './browser-app.domain.js';
import { themeStarters } from './browser-app.seed.js';
import { AiService } from './ai.service.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppThemeCompilerService } from './browser-app-theme-compiler.service.js';
import { StoreService } from './store.service.js';

@Injectable()
export class BrowserAppThemeService {
  constructor(
    @Inject(BrowserAppRepository) private readonly repository: BrowserAppRepository,
    @Inject(BrowserAppThemeCompilerService) private readonly compiler: BrowserAppThemeCompilerService,
    @Inject(BrowserAppBuildService) private readonly builder: BrowserAppBuildService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(StoreService) private readonly platformStore: StoreService,
  ) {}

  starters() {
    return structuredClone(themeStarters);
  }

  preview(input: unknown) {
    try {
      const parsed = this.compiler.parse(input);
      return { scopedCss: this.compiler.compileCustomCss(parsed.customCss), accessibility: this.compiler.accessibility(parsed.tokens) };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid theme definition');
    }
  }

  async createDraft(appId: string, input: unknown, createdBy: ThemeRevision['createdBy'] = 'user'): Promise<ThemeRevision> {
    const app = await this.repository.findApp(appId);
    if (!app) throw new NotFoundException('Browser app not found');
    let parsed: ReturnType<BrowserAppThemeCompilerService['parse']>;
    try {
      parsed = this.compiler.parse(input);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid theme definition');
    }
    const revision = await this.repository.nextThemeRevision(app.id);
    const theme: ThemeRevision = {
      id: randomUUID(), appId: app.id, revision, ...parsed, status: 'draft', createdBy,
      accessibility: this.compiler.accessibility(parsed.tokens), createdAt: new Date().toISOString(),
    };
    await this.repository.insertTheme(theme);
    return theme;
  }

  async generate(appId: string, direction: string): Promise<{ theme: ThemeRevision; agent: 'oneringai' | 'fallback' }> {
    if (!direction.trim()) throw new BadRequestException('Visual direction is required');
    const detail = await this.repository.detail(appId);
    if (!detail) throw new NotFoundException('Browser app not found');
    const current = detail.themes.find((theme) => theme.revision === detail.app.themeRevision) ?? detail.themes[0];
    const platform = this.platformStore.snapshot();
    const visualAgent = platform.agents.find((agent) => agent.id === 'visual-designer');
    const context = [
      detail.app.name, detail.app.description,
      ...detail.specification.sections.map((section) => `${section.title}: ${section.body}`),
      `Routes: ${detail.routes.map((route) => route.path).join(', ')}`,
      `Pages: ${detail.modules.filter((module) => module.kind === 'page').map((module) => module.name).join(', ')}`,
    ].join('\n');
    const generated = await this.ai.visualThemePlan(context, direction.trim(), current, visualAgent ? {
      connector: visualAgent.connector, model: visualAgent.model, instructions: visualAgent.instructions,
    } : undefined);
    const fallback = this.selectFallback(direction);
    let agent: 'oneringai' | 'fallback' = generated ? 'oneringai' : 'fallback';
    let input: unknown = generated ? this.sanitizeGenerated(generated, fallback) : { ...fallback, customCss: '' };
    try {
      return { theme: await this.createDraft(appId, input, 'visual-design-agent'), agent };
    } catch {
      agent = 'fallback';
      input = { ...fallback, customCss: '' };
      return { theme: await this.createDraft(appId, input, 'visual-design-agent'), agent };
    }
  }

  async publish(appId: string, revision: number) {
    const app = await this.repository.findApp(appId);
    if (!app) throw new NotFoundException('Browser app not found');
    const theme = await this.repository.theme(app.id, revision);
    if (!theme) throw new NotFoundException('Theme revision not found');
    if (theme.accessibility.issues.length) {
      throw new BadRequestException({ message: 'Theme does not pass accessibility gates', issues: theme.accessibility.issues });
    }
    const previousRevision = app.themeRevision;
    await this.repository.setPublishedTheme(app.id, theme.revision);
    try {
      const publication = await this.builder.buildAndRelease(app.id);
      return { theme: await this.repository.theme(app.id, theme.revision), publication };
    } catch (error) {
      await this.repository.setPublishedTheme(app.id, previousRevision);
      throw error;
    }
  }

  private selectFallback(direction: string) {
    const normalized = direction.toLowerCase();
    const id = normalized.includes('light') || normalized.includes('editorial') ? 'paper-studio'
      : normalized.includes('warm') || normalized.includes('orange') ? 'ember-console'
        : normalized.includes('natural') || normalized.includes('green') ? 'sage-workspace'
          : normalized.includes('blue') || normalized.includes('ocean') ? 'ocean-signal'
            : 'midnight-violet';
    return structuredClone(themeStarters.find((starter) => starter.id === id)!);
  }

  private sanitizeGenerated(generated: Record<string, unknown>, fallback: ReturnType<BrowserAppThemeService['selectFallback']>) {
    const object = generated as Record<string, any>;
    const tokens = object.tokens && typeof object.tokens === 'object' ? object.tokens : {};
    const colors = tokens.colors && typeof tokens.colors === 'object' ? tokens.colors : {};
    const typography = tokens.typography && typeof tokens.typography === 'object' ? tokens.typography : {};
    const shape = tokens.shape && typeof tokens.shape === 'object' ? tokens.shape : {};
    const variants = object.componentVariants && typeof object.componentVariants === 'object' ? object.componentVariants : {};
    const pick = <T extends string>(value: unknown, allowed: readonly T[], safe: T): T =>
      typeof value === 'string' && allowed.includes(value as T) ? value as T : safe;
    const color = (value: unknown, safe: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : safe;
    const safeColors = fallback.tokens.colors;
    return {
      name: typeof object.name === 'string' && object.name.trim().length >= 2 ? object.name.trim().slice(0, 80) : fallback.name,
      description: typeof object.description === 'string' && object.description.trim().length >= 3 ? object.description.trim().slice(0, 280) : fallback.description,
      tokens: {
        colors: Object.fromEntries(Object.entries(safeColors).map(([key, value]) => [key, color(colors[key], value)])),
        typography: {
          fontFamily: pick(typography.fontFamily, ['inter', 'manrope', 'system', 'serif'] as const, fallback.tokens.typography.fontFamily),
          headingStyle: pick(typography.headingStyle, ['compact', 'editorial', 'balanced'] as const, fallback.tokens.typography.headingStyle),
          baseSize: [14, 15, 16, 17, 18].includes(typography.baseSize) ? typography.baseSize : fallback.tokens.typography.baseSize,
        },
        shape: {
          radius: pick(shape.radius, ['sharp', 'soft', 'rounded'] as const, fallback.tokens.shape.radius),
          borderWidth: [0, 1, 2].includes(shape.borderWidth) ? shape.borderWidth : fallback.tokens.shape.borderWidth,
        },
        density: pick(tokens.density, ['compact', 'comfortable', 'spacious'] as const, fallback.tokens.density),
        contentWidth: pick(tokens.contentWidth, ['narrow', 'standard', 'wide'] as const, fallback.tokens.contentWidth),
      },
      componentVariants: {
        navigation: pick(variants.navigation, ['solid', 'glass', 'minimal'] as const, fallback.componentVariants.navigation),
        cards: pick(variants.cards, ['outlined', 'soft', 'elevated'] as const, fallback.componentVariants.cards),
        buttons: pick(variants.buttons, ['solid', 'gradient', 'outline'] as const, fallback.componentVariants.buttons),
      },
      customCss: '',
    };
  }
}
