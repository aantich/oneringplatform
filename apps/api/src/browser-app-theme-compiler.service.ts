import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ThemeRevision, ThemeTokens } from './browser-app.domain.js';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const tokensSchema = z.object({
  colors: z.object({
    background: hex, surface: hex, surfaceElevated: hex, text: hex, textMuted: hex,
    primary: hex, primaryContrast: hex, accent: hex, success: hex, danger: hex, border: hex,
  }).strict(),
  typography: z.object({
    fontFamily: z.enum(['inter', 'manrope', 'system', 'serif']),
    headingStyle: z.enum(['compact', 'editorial', 'balanced']),
    baseSize: z.union([z.literal(14), z.literal(15), z.literal(16), z.literal(17), z.literal(18)]),
  }).strict(),
  shape: z.object({ radius: z.enum(['sharp', 'soft', 'rounded']), borderWidth: z.union([z.literal(0), z.literal(1), z.literal(2)]) }).strict(),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  contentWidth: z.enum(['narrow', 'standard', 'wide']),
}).strict();

const variantsSchema = z.object({
  navigation: z.enum(['solid', 'glass', 'minimal']),
  cards: z.enum(['outlined', 'soft', 'elevated']),
  buttons: z.enum(['solid', 'gradient', 'outline']),
}).strict();

@Injectable()
export class BrowserAppThemeCompilerService {
  parse(input: unknown): {
    name: string;
    description: string;
    starterId?: string;
    tokens: ThemeTokens;
    componentVariants: ThemeRevision['componentVariants'];
    customCss: string;
  } {
    const object = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const name = z.string().trim().min(2).max(80).parse(object.name);
    const description = z.string().trim().min(3).max(280).parse(object.description);
    const tokens = tokensSchema.parse(object.tokens);
    const componentVariants = variantsSchema.parse(object.componentVariants);
    const customCss = z.string().max(20_000).default('').parse(object.customCss ?? '');
    this.scopeCustomCss(customCss);
    return {
      name, description, tokens, componentVariants, customCss,
      ...(typeof object.starterId === 'string' ? { starterId: object.starterId.slice(0, 80) } : {}),
    };
  }

  accessibility(tokens: ThemeTokens): { contrastScore: number; issues: string[] } {
    const background = this.contrast(tokens.colors.text, tokens.colors.background);
    const surface = this.contrast(tokens.colors.text, tokens.colors.surface);
    const primary = this.contrast(tokens.colors.primaryContrast, tokens.colors.primary);
    const issues: string[] = [];
    if (background < 4.5) issues.push(`Body text/background contrast is ${background.toFixed(2)}; minimum is 4.5.`);
    if (surface < 4.5) issues.push(`Body text/surface contrast is ${surface.toFixed(2)}; minimum is 4.5.`);
    if (primary < 4.5) issues.push(`Button text/primary contrast is ${primary.toFixed(2)}; minimum is 4.5.`);
    return { contrastScore: Number(Math.min(background, surface, primary).toFixed(2)), issues };
  }

  compile(baseCss: string, theme: ThemeRevision): string {
    const { colors, typography, shape, density, contentWidth } = theme.tokens;
    const font = {
      inter: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
      manrope: 'Manrope, Inter, ui-sans-serif, system-ui, sans-serif',
      system: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      serif: 'Georgia, Cambria, Times New Roman, serif',
    }[typography.fontFamily];
    const radius = { sharp: '6px', soft: '14px', rounded: '24px' }[shape.radius];
    const densityScale = { compact: '.82', comfortable: '1', spacious: '1.18' }[density];
    const width = { narrow: '980px', standard: '1180px', wide: '1440px' }[contentWidth];
    const headingSpacing = { compact: '-.055em', editorial: '-.025em', balanced: '-.04em' }[typography.headingStyle];
    const navigationCss = {
      solid: `.app-nav{background:var(--or-surface);backdrop-filter:none}`,
      glass: `.app-nav{background:color-mix(in srgb,var(--or-bg) 82%,transparent);backdrop-filter:blur(20px)}`,
      minimal: `.app-nav{background:var(--or-bg);border-bottom-color:transparent}`,
    }[theme.componentVariants.navigation];
    const cardsCss = {
      outlined: `.hero-card,.toolbar-card,.task-panel,.copilot-card,.architecture-cards article{box-shadow:none;background:var(--or-surface);border-color:var(--or-border)}`,
      soft: `.hero-card,.toolbar-card,.task-panel,.copilot-card,.architecture-cards article{box-shadow:none;background:color-mix(in srgb,var(--or-surface) 92%,var(--or-primary) 8%);border-color:color-mix(in srgb,var(--or-border) 75%,transparent)}`,
      elevated: `.hero-card,.toolbar-card,.task-panel,.copilot-card,.architecture-cards article{background:var(--or-surface);box-shadow:0 24px 65px color-mix(in srgb,var(--or-bg) 68%,transparent);border-color:color-mix(in srgb,var(--or-border) 65%,transparent)}`,
    }[theme.componentVariants.cards];
    const buttonsCss = {
      solid: `.quick-add button,.copilot-card button{background:var(--or-primary);color:var(--or-primary-contrast)}`,
      gradient: `.quick-add button,.copilot-card button{background:linear-gradient(135deg,var(--or-primary),color-mix(in srgb,var(--or-primary) 68%,var(--or-accent)));color:var(--or-primary-contrast)}`,
      outline: `.quick-add button,.copilot-card button{background:transparent;color:var(--or-primary);border:var(--or-border-width) solid var(--or-primary)}`,
    }[theme.componentVariants.buttons];

    return `${baseCss}\n:root{color-scheme:${this.luminance(colors.background) > .45 ? 'light' : 'dark'};--or-bg:${colors.background};--or-surface:${colors.surface};--or-surface-elevated:${colors.surfaceElevated};--or-text:${colors.text};--or-muted:${colors.textMuted};--or-primary:${colors.primary};--or-primary-contrast:${colors.primaryContrast};--or-accent:${colors.accent};--or-success:${colors.success};--or-danger:${colors.danger};--or-border:${colors.border};--or-radius:${radius};--or-border-width:${shape.borderWidth}px;--or-density:${densityScale};--or-content-width:${width};font-family:${font};font-size:${typography.baseSize}px;color:var(--or-text);background:var(--or-bg)}
body{color:var(--or-text);background:radial-gradient(circle at 80% -10%,color-mix(in srgb,var(--or-primary) 24%,transparent),transparent 34%),var(--or-bg)}
.app-nav{border-color:var(--or-border);padding-left:max(calc(18px * var(--or-density)),calc((100vw - var(--or-content-width))/2));padding-right:max(calc(18px * var(--or-density)),calc((100vw - var(--or-content-width))/2))}.brand,.app-nav a.active{color:var(--or-text)}.app-nav a{color:var(--or-muted)}.app-nav a.active{background:color-mix(in srgb,var(--or-primary) 16%,transparent)}.brand-mark{background:linear-gradient(135deg,var(--or-primary),var(--or-accent));color:var(--or-primary-contrast)}.runtime-badge{color:var(--or-success);border-color:color-mix(in srgb,var(--or-success) 38%,transparent)}
.runtime-identity{display:grid;gap:3px;min-width:170px}.runtime-identity>span{color:var(--or-muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.runtime-identity select{max-width:220px;border:var(--or-border-width) solid var(--or-border);border-radius:calc(var(--or-radius) * .45);background:var(--or-surface);color:var(--or-text);padding:7px 28px 7px 9px;font:600 12px/1.2 inherit}
.task-page,.about-page{max-width:var(--or-content-width);padding-top:calc(48px * var(--or-density))}.hero-card,.toolbar-card,.task-panel,.copilot-card,.architecture-cards article{border-width:var(--or-border-width);border-radius:var(--or-radius);color:var(--or-text)}.hero-card h1,.about-page h1{letter-spacing:${headingSpacing}}.hero-card p,.about-page>p,.copilot-card p,.task-row p{color:var(--or-muted)}.eyebrow{color:var(--or-primary)}.progress-orb{background:radial-gradient(circle,var(--or-surface) 55%,transparent 57%),conic-gradient(var(--or-primary) 0 65%,var(--or-border) 65%)}
.toolbar-card,.task-panel{background:var(--or-surface)}.role-switcher button{background:var(--or-surface-elevated);color:var(--or-muted);border-radius:calc(var(--or-radius) * .5)}.role-switcher button.active{background:var(--or-primary);color:var(--or-primary-contrast)}.session-pill span{background:var(--or-success)}.quick-add input{background:var(--or-bg);border-color:var(--or-border);color:var(--or-text);border-radius:calc(var(--or-radius) * .55)}.quick-add input:focus{border-color:var(--or-primary)}.permission-note{background:color-mix(in srgb,var(--or-primary) 11%,transparent);color:color-mix(in srgb,var(--or-primary) 60%,var(--or-text))}.task-row{background:var(--or-surface-elevated);border-radius:calc(var(--or-radius) * .6)}.status-done .status-button{background:var(--or-success);border-color:var(--or-success)}.delete-button{color:var(--or-danger)}.copilot-card .spark{background:var(--or-primary)}
    @media(max-width:680px){.app-nav{height:auto;min-height:72px;flex-wrap:wrap;padding-top:10px;padding-bottom:10px}.runtime-identity{order:3;width:100%}.runtime-identity select{max-width:none;width:100%}}
${navigationCss}\n${cardsCss}\n${buttonsCss}\n${this.scopeCustomCss(theme.customCss)}`;
  }

  compileCustomCss(input: string): string {
    return this.scopeCustomCss(input);
  }

  private scopeCustomCss(input: string): string {
    if (!input.trim()) return '';
    if (/[\\<>@]|(?:url|expression)\s*\(|javascript:/i.test(input)) throw new BadRequestException('Custom CSS contains a prohibited construct');
    const css = input.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const allowedSelectors = ['.hero-card', '.toolbar-card', '.task-panel', '.copilot-card', '.task-row', '.about-page', '.architecture-cards', '.quick-add', '.section-heading', '.permission-note', '.progress-orb'];
    const allowedProperties = /^(?:color|background(?:-color|-image)?|border(?:-(?:color|width|style|radius))?|box-shadow|font(?:-family|-size|-weight|-style)?|letter-spacing|line-height|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|gap|outline(?:-(?:color|width|style|offset))?)$/;
    const output: string[] = [];
    let consumed = 0;
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of css.matchAll(rule)) {
      if (match.index !== consumed && css.slice(consumed, match.index).trim()) throw new BadRequestException('Custom CSS must contain simple style rules only');
      consumed = match.index! + match[0].length;
      const selectors = match[1]!.split(',').map((selector) => selector.trim());
      if (!selectors.length || selectors.some((selector) => !allowedSelectors.some((allowed) => selector === allowed || selector.startsWith(`${allowed} `) || selector.startsWith(`${allowed}:`)))) {
        throw new BadRequestException('Custom CSS selector is outside the managed application content scope');
      }
      const declarations = match[2]!.split(';').map((item) => item.trim()).filter(Boolean);
      if (!declarations.length) throw new BadRequestException('Custom CSS rule has no declarations');
      for (const declaration of declarations) {
        const separator = declaration.indexOf(':');
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        if (separator < 1 || !allowedProperties.test(property) || !value || /!important/i.test(value)) throw new BadRequestException(`Custom CSS property is not allowed: ${property || 'invalid declaration'}`);
      }
      output.push(`${selectors.map((selector) => `.app-frame ${selector}`).join(',')}{${declarations.join(';')}}`);
    }
    if (consumed !== css.length && css.slice(consumed).trim()) throw new BadRequestException('Custom CSS could not be parsed safely');
    return output.join('\n');
  }

  private contrast(a: string, b: string): number {
    const first = this.luminance(a); const second = this.luminance(b);
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
  }

  private luminance(hex: string): number {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0]! + .7152 * channels[1]! + .0722 * channels[2]!;
  }
}
