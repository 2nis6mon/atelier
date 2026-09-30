import type { LibraryRecord, RecordKind } from '../../../shared/types';
import { formatRange } from '../../../shared/dates';

export type FieldType = 'text' | 'textarea' | 'date' | 'bool' | 'list' | 'tags' | 'links';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
}

export const KIND_LABELS: Record<RecordKind, { one: string; many: string; icon: string }> = {
  experience: { one: 'Experience', many: 'Experiences', icon: 'briefcase' },
  education: { one: 'Education', many: 'Education', icon: 'library' },
  skill: { one: 'Skill', many: 'Skills', icon: 'sparkle' },
  language: { one: 'Language', many: 'Languages', icon: 'translate' },
  certification: { one: 'Certification', many: 'Certifications', icon: 'check' },
  project: { one: 'Project', many: 'Projects', icon: 'layout' },
  profile: { one: 'Profile', many: 'Profiles', icon: 'content' },
  personal: { one: 'Personal details', many: 'Personal details', icon: 'home' },
  custom: { one: 'Custom item', many: 'Custom sections', icon: 'plus' },
};

export const FIELDS: Record<RecordKind, FieldDef[]> = {
  experience: [
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
    { key: 'location', label: 'Location', type: 'text', placeholder: 'Paris, France' },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'end', label: 'End', type: 'date' },
    { key: 'current', label: 'Present', type: 'bool' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'bullets', label: 'Key responsibilities', type: 'list' },
    { key: 'achievements', label: 'Achievements', type: 'list' },
    { key: 'technologies', label: 'Technologies', type: 'tags' },
  ],
  project: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'end', label: 'End', type: 'date' },
    { key: 'url', label: 'Link', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'bullets', label: 'Highlights', type: 'list' },
    { key: 'technologies', label: 'Technologies', type: 'tags' },
  ],
  education: [
    { key: 'institution', label: 'School', type: 'text' },
    { key: 'degree', label: 'Degree', type: 'text' },
    { key: 'field', label: 'Field', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'end', label: 'End', type: 'date' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ],
  certification: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'issuer', label: 'Issuer', type: 'text' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'url', label: 'Link', type: 'text' },
  ],
  skill: [
    { key: 'name', label: 'Skill', type: 'text' },
    { key: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Frontend, Tools' },
    { key: 'level', label: 'Level', type: 'text' },
  ],
  language: [
    { key: 'name', label: 'Language', type: 'text' },
    { key: 'level', label: 'Level', type: 'text', placeholder: 'e.g. Native, C1, Fluent' },
  ],
  profile: [
    { key: 'title', label: 'Title', type: 'text', placeholder: 'e.g. Frontend profile (FR)' },
    { key: 'text', label: 'Text', type: 'textarea' },
  ],
  personal: [
    { key: 'fullName', label: 'Full name', type: 'text' },
    { key: 'headline', label: 'Headline', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'links', label: 'Links', type: 'links' },
  ],
  custom: [
    { key: 'section', label: 'Section', type: 'text' },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'subtitle', label: 'Subtitle', type: 'text' },
    { key: 'date', label: 'Date', type: 'text' },
    { key: 'text', label: 'Text', type: 'textarea' },
    { key: 'bullets', label: 'Bullets', type: 'list' },
  ],
};

export function recordTitle(r: LibraryRecord): string {
  const d = r.data as unknown as Record<string, unknown>;
  switch (r.kind) {
    case 'experience':
      return String(d.company || 'Untitled experience');
    case 'education':
      return String(d.institution || d.degree || 'Untitled education');
    case 'personal':
      return String(d.fullName || 'Personal details');
    case 'profile':
      return String(d.title || String(d.text ?? '').slice(0, 40) || 'Profile');
    case 'custom':
      return String(d.title || d.section || 'Custom item');
    default:
      return String(d.name || 'Untitled');
  }
}

export function recordSubtitle(r: LibraryRecord): string {
  const d = r.data as unknown as Record<string, unknown>;
  switch (r.kind) {
    case 'experience':
      return String(d.role ?? '');
    case 'education':
      return String(d.degree ?? '');
    case 'project':
      return String(d.role ?? '');
    case 'skill':
      return String(d.category ?? '');
    case 'language':
      return String(d.level ?? '');
    case 'certification':
      return String(d.issuer ?? '');
    case 'personal':
      return String(d.headline ?? '');
    default:
      return '';
  }
}

export function recordDates(r: LibraryRecord): string {
  const d = r.data as unknown as Record<string, unknown>;
  if (r.kind === 'experience' || r.kind === 'project' || r.kind === 'education') {
    return formatRange(String(d.start ?? ''), String(d.end ?? ''), Boolean(d.current), r.lang);
  }
  return '';
}

export function emptyData(kind: RecordKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[kind]) out[f.key] = f.type === 'list' || f.type === 'tags' || f.type === 'links' ? [] : f.type === 'bool' ? false : '';
  if (kind === 'skill') out.name = 'New skill';
  if (kind === 'language') out.name = 'New language';
  return out;
}
