/**
 * PLX Design System — TypeScript token exports
 *
 * Mirror of tokens.css for build-time consumers (charts, generators,
 * agent prompts, type-safe component props). Values are kept in sync
 * with tokens.css by hand for v0; codegen can be added later if drift
 * becomes a problem.
 *
 * IMPORT PATH (after migration):
 *   import { tokens, lightTokens, darkTokens } from '@/design-system/tokens';
 *
 * SOURCE OF TRUTH: tokens.css. If you change a value here, change it
 * there too. Drift between the two is a hygiene violation.
 */

export const lightTokens = {
  // surfaces
  paper:        '#FBF9F5',
  paper2:       '#F6F2EA',
  card:         '#FBF9F5',

  // text
  ink:          '#1B1A17',
  ink2:         '#3A3833',
  muted:        '#6B665B',

  // hairlines
  grid:         'rgba(27, 26, 23, 0.16)',
  grid2:        'rgba(27, 26, 23, 0.08)',

  // brand
  accent:       '#244A39',
  accentSoft:   '#BCCFBF',

  // status
  ok:           '#5C7A55',
  warn:         '#C99340',
  info:         '#5B7B91',
  hot:          '#52606E',

  // status foreground shades (AA text on surfaces + 12% chip fills)
  okText:       '#48603F',
  warnText:     '#7E5C0F',
  infoText:     '#476378',
  hotText:      '#46535F',

  // scrim — drawer/sheet backdrop wash
  scrim:        'rgba(27, 26, 23, 0.5)',
} as const;

export const darkTokens = {
  paper:        '#1A1816',
  paper2:       '#22201D',
  card:         '#1A1816',
  ink:          '#F1ECE0',
  ink2:         '#C9C2B5',
  muted:        '#827B6F',
  grid:         'rgba(241, 236, 224, 0.12)',
  grid2:        'rgba(241, 236, 224, 0.06)',
  accent:       '#7AB18C',
  accentSoft:   '#2D4D3B',
  ok:           '#7A9E6F',
  warn:         '#D9A85C',
  info:         '#7A9DB3',
  hot:          '#8FA0B0',
  okText:       'var(--p-ok)',
  warnText:     'var(--p-warn)',
  infoText:     'var(--p-info)',
  hotText:      'var(--p-hot)',
  scrim:        'rgba(0, 0, 0, 0.6)',
} as const;

export const fonts = {
  serif: 'var(--font-mazius-display, "Mazius Display"), "Times New Roman", Georgia, serif',
  sans:  'var(--font-inter, "Inter"), "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  mono:  'var(--font-jetbrains-mono, "JetBrains Mono"), "IBM Plex Mono", ui-monospace, monospace',
} as const;

export const textScale = {
  display: '56px',
  h1:      '32px',
  h2:      '24px',
  h3:      '18px',
  body:    '14px',
  bodyCompact: '13px',
  small:   '12px',
  mono:    '11px',
  meta:    '10px',
  kicker:  '9.5px',
  tick:    '9px',
} as const;

export const tracking = {
  tick: '0.22em',
  meta: '0.16em',
  data: '0.04em',
} as const;

export const radius = {
  sm:      '3px',
  default: '4px',
  lg:      '6px',
} as const;

export const space = {
  1: '4px',
  2: '8px',
  3: '14px',
  4: '22px',
  5: '32px',
  6: '48px',
  7: '72px',
} as const;

export const motion = {
  ease:     'cubic-bezier(0.2, 0.8, 0.2, 1)',
  durFast:  '120ms',
  dur:      '180ms',
  durSlow:  '320ms',
} as const;

/** Icon sizes — the two sizes brand surfaces use (Phase 5). */
export const icon = {
  default: '16px',
  lg:      '32px',
} as const;

/** Layout constants for ticket-detail key/value field grids. */
export const layout = {
  fieldLabelW: '160px',
} as const;

/** Layering — chrome contract (drawer above backdrop; see CONTRIBUTING §2). */
export const layer = {
  drawer: '60',
  scrim:  '59',
} as const;

/** CSS custom property names — useful when you need the var, not the value. */
export const cssVar = {
  paper:       'var(--p-paper)',
  paper2:      'var(--p-paper-2)',
  card:        'var(--p-card)',
  ink:         'var(--p-ink)',
  ink2:        'var(--p-ink-2)',
  muted:       'var(--p-muted)',
  grid:        'var(--p-grid)',
  grid2:       'var(--p-grid-2)',
  accent:      'var(--p-accent)',
  accentSoft:  'var(--p-accent-soft)',
  ok:          'var(--p-ok)',
  warn:        'var(--p-warn)',
  info:        'var(--p-info)',
  hot:         'var(--p-hot)',
  fontSerif:   'var(--p-font-serif)',
  fontSans:    'var(--p-font-sans)',
  fontMono:    'var(--p-font-mono)',
} as const;

/** Default export = light scheme values. */
export const tokens = lightTokens;

export type TokenName = keyof typeof lightTokens;
export type FontStack = keyof typeof fonts;
