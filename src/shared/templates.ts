import type { BlockType, CvStyle, FontId, Lang, TemplateId, Zone } from './types';

export const BLOCK_TITLES: Record<Lang, Record<BlockType, string>> = {
  fr: {
    profile: 'Profil',
    experience: 'Expérience professionnelle',
    education: 'Formation',
    skills: 'Compétences',
    languages: 'Langues',
    certifications: 'Certifications',
    projects: 'Projets',
    custom: 'Section personnalisée',
  },
  en: {
    profile: 'Profile',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    languages: 'Languages',
    certifications: 'Certifications',
    projects: 'Projects',
    custom: 'Custom section',
  },
};

/** UI (English) names for block types, used in palettes and menus. */
export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  profile: 'Profile',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
  projects: 'Projects',
  custom: 'Custom section',
};

export const BLOCK_ORDER: BlockType[] = [
  'profile',
  'experience',
  'projects',
  'education',
  'certifications',
  'skills',
  'languages',
];

export interface TemplateDef {
  id: TemplateId;
  label: string;
  description: string;
  zones: Zone[];
  /** Zone new blocks of each type land in when this template is chosen first. */
  defaultZone: (type: BlockType) => Zone;
  /** Relative spacing factor applied on top of style.sectionSpacing. */
  density: number;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'One column, generous spacing.',
    zones: ['main'],
    defaultZone: () => 'main',
    density: 1,
  },
  sidebar: {
    id: 'sidebar',
    label: 'Sidebar',
    description: 'Two zones: main story and a side column.',
    zones: ['main', 'side'],
    defaultZone: (t) => (t === 'skills' || t === 'languages' || t === 'certifications' ? 'side' : 'main'),
    density: 1,
  },
  compact: {
    id: 'compact',
    label: 'Compact',
    description: 'One column with tighter spacing. Text size is never reduced automatically.',
    zones: ['main'],
    defaultZone: () => 'main',
    density: 0.7,
  },
};

export interface FontDef {
  id: FontId;
  label: string;
  css: string;
  docx: string;
  kind: 'serif' | 'sans';
}

export const FONTS: Record<FontId, FontDef> = {
  'source-serif': {
    id: 'source-serif',
    label: 'Source Serif',
    css: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif",
    docx: 'Georgia',
    kind: 'serif',
  },
  lora: { id: 'lora', label: 'Lora', css: "'Lora Variable', Lora, Georgia, serif", docx: 'Georgia', kind: 'serif' },
  inter: {
    id: 'inter',
    label: 'Inter',
    css: "'Inter Variable', Inter, 'Helvetica Neue', Arial, sans-serif",
    docx: 'Calibri',
    kind: 'sans',
  },
  'plex-sans': {
    id: 'plex-sans',
    label: 'IBM Plex Sans',
    css: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
    docx: 'Calibri',
    kind: 'sans',
  },
};

export const HEADING_COLORS = ['#1F2A44', '#A84F36', '#7A4A2E', '#2F5D62', '#4A3F6B', '#202B3B'];

export const DEFAULT_STYLE: CvStyle = {
  bodyFont: 'inter',
  headingFont: 'source-serif',
  fontSize: 10.5,
  lineHeight: 1.4,
  headingColor: '#1F2A44',
  accentColor: '#A84F36',
  textColor: '#202B3B',
  marginMm: 18,
  sectionSpacing: 1,
  sidebarWidth: 32,
};

export const STYLE_LIMITS = {
  fontSize: { min: 8.5, max: 13, step: 0.5 },
  lineHeight: { min: 1.1, max: 1.8, step: 0.05 },
  marginMm: { min: 10, max: 30, step: 1 },
  sectionSpacing: { min: 0.5, max: 2, step: 0.1 },
  sidebarWidth: { min: 25, max: 42, step: 1 },
} as const;

export function clampStyle(style: CvStyle): CvStyle {
  const clamp = (v: number, lim: { min: number; max: number }) =>
    Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : lim.min;
  const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
  return {
    ...style,
    bodyFont: FONTS[style.bodyFont] ? style.bodyFont : DEFAULT_STYLE.bodyFont,
    headingFont: FONTS[style.headingFont] ? style.headingFont : DEFAULT_STYLE.headingFont,
    fontSize: clamp(style.fontSize, STYLE_LIMITS.fontSize),
    lineHeight: clamp(style.lineHeight, STYLE_LIMITS.lineHeight),
    marginMm: clamp(style.marginMm, STYLE_LIMITS.marginMm),
    sectionSpacing: clamp(style.sectionSpacing, STYLE_LIMITS.sectionSpacing),
    sidebarWidth: clamp(style.sidebarWidth, STYLE_LIMITS.sidebarWidth),
    headingColor: color(style.headingColor, DEFAULT_STYLE.headingColor),
    accentColor: color(style.accentColor, DEFAULT_STYLE.accentColor),
    textColor: color(style.textColor, DEFAULT_STYLE.textColor),
  };
}

/** A4 geometry in CSS pixels at 96 dpi. */
export const A4 = { widthMm: 210, heightMm: 297, pxPerMm: 96 / 25.4 };
export const mmToPx = (mm: number) => mm * A4.pxPerMm;
