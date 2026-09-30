// Heuristic, local (no AI) conversion of CV text into candidate library
// records. The result is always shown to the user for review and editing
// before anything is saved; nothing here is treated as authoritative.

import { findDateRange, findSingleDate } from './dates';
import { detectLang, normalizeForMatch } from './lang';
import type {
  CertificationData,
  CustomData,
  EducationData,
  ExperienceData,
  Lang,
  LanguageData,
  PersonalData,
  ProfileData,
  ProjectData,
  RecordDataMap,
  RecordKind,
  SkillData,
} from './types';

export interface ParsedCandidate<K extends RecordKind = RecordKind> {
  tempId: string;
  kind: K;
  data: RecordDataMap[K];
  lang: Lang;
  confidence: 'high' | 'medium' | 'low';
  issues: string[];
  rawText: string;
}

export interface ParsedCv {
  lang: Lang;
  candidates: ParsedCandidate[];
  unassigned: string[];
  sections: Array<{ kind: SectionKind; title: string }>;
}

type SectionKind = 'profile' | 'experience' | 'education' | 'skills' | 'languages' | 'certifications' | 'projects' | 'custom';

const SECTION_KEYWORDS: Array<[SectionKind, string[]]> = [
  ['experience', ['experience professionnelle', 'experiences professionnelles', 'experience', 'experiences', 'work experience', 'professional experience', 'parcours professionnel', 'employment history', 'employment', 'career', 'emplois']],
  ['education', ['formation', 'formations', 'education', 'etudes', 'diplomes', 'academic background', 'cursus', 'formation academique']],
  ['skills', ['competences', 'competences techniques', 'skills', 'technical skills', 'hard skills', 'soft skills', 'outils', 'technologies', 'stack technique', 'savoir faire', 'expertise', 'domaines de competence', 'core skills', 'key skills']],
  ['languages', ['langues', 'languages', 'langues etrangeres', 'language skills']],
  ['certifications', ['certifications', 'certification', 'certificats', 'certificates', 'licences et certifications', 'licenses & certifications', 'licenses and certifications']],
  ['projects', ['projets', 'projects', 'projets personnels', 'personal projects', 'side projects', 'realisations']],
  ['profile', ['profil', 'profile', 'resume', 'summary', 'professional summary', 'a propos', 'a propos de moi', 'about', 'about me', 'objectif', 'presentation', 'profil professionnel']],
  ['custom', ['centres d interet', 'centres d interets', 'interets', 'interests', 'hobbies', 'loisirs', 'benevolat', 'volunteering', 'publications', 'references', 'distinctions', 'awards', 'associatif']],
];

const ROLE_WORDS = [
  'developpeur', 'developpeuse', 'developer', 'engineer', 'ingenieur', 'ingenieure', 'manager', 'lead', 'chef', 'consultant', 'consultante',
  'designer', 'analyst', 'analyste', 'stagiaire', 'intern', 'internship', 'stage', 'architect', 'architecte', 'product', 'head', 'directeur',
  'directrice', 'director', 'responsable', 'cto', 'ceo', 'vp', 'owner', 'scientist', 'specialist', 'specialiste', 'administrator',
  'administrateur', 'technicien', 'technician', 'officer', 'coordinator', 'coordinateur', 'coordinatrice', 'assistant', 'assistante',
  'freelance', 'fullstack', 'full-stack', 'frontend', 'front-end', 'backend', 'back-end', 'devops', 'sre', 'qa', 'tester', 'testeur',
  'charge', 'chargee', 'associate', 'principal', 'senior', 'junior', 'staff', 'expert', 'formateur', 'teacher', 'enseignant', 'professor',
  'alternant', 'alternance', 'apprenti', 'fondateur', 'founder', 'co-founder', 'cofondateur', 'president', 'business', 'commercial',
];

const LOCATION_WORDS = [
  'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'lille', 'nantes', 'nice', 'strasbourg', 'montpellier', 'rennes', 'grenoble',
  'london', 'londres', 'berlin', 'madrid', 'barcelona', 'barcelone', 'bruxelles', 'brussels', 'geneve', 'geneva', 'zurich', 'lausanne',
  'amsterdam', 'dublin', 'lisbonne', 'lisbon', 'new york', 'san francisco', 'montreal', 'quebec', 'luxembourg', 'milan', 'rome', 'munich',
  'france', 'remote', 'teletravail', 'full remote', 'hybride', 'hybrid', 'uk', 'usa', 'canada', 'belgique', 'suisse', 'switzerland',
  'germany', 'allemagne', 'spain', 'espagne', 'italy', 'italie', 'ile-de-france', 'ile de france',
];

const DEGREE_WORDS = ['master', 'licence', 'bachelor', 'diplome', 'msc', 'bsc', 'mba', 'dut', 'bts', 'but', 'ingenieur', 'doctorat', 'phd', 'baccalaureat', 'bac', 'degree', 'diploma', 'certificate', 'mastere', 'deug', 'dea', 'dess', 'cap', 'bep', 'titre'];
const SCHOOL_WORDS = ['universite', 'university', 'ecole', 'school', 'institut', 'institute', 'college', 'iut', 'lycee', 'academy', 'academie', 'polytechnique', 'insa', 'epita', 'epitech', 'sciences po', 'hec', 'essec', 'escp', 'sorbonne', 'centrale', 'mines', 'telecom', 'openclassrooms', 'campus'];

const BULLET_RE = /^\s*(?:[•·▪◦‣●○■□►▶➢➤✓✔\-–—*]|\d+[.)])\s+/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?0?\d\)?[\s.-]?)(?:\d{1,2}[\s.-]?){4,5}\d{1,2}/;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|[a-z0-9-]+\.(?:dev|io|me|fr|com|net|org|co|app|design))(?:\/[^\s,;|]*)?)/i;

let tempCounter = 0;
const tempId = () => `c${Date.now().toString(36)}${(tempCounter++).toString(36)}`;

function words(text: string): string[] {
  return normalizeForMatch(text).split(' ').filter(Boolean);
}

function hasAnyWord(text: string, list: string[]): boolean {
  const n = ` ${normalizeForMatch(text)} `;
  return list.some((w) => n.includes(` ${w} `));
}

function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

/** Returns the section kind if the line looks like a section heading. */
export function detectHeading(line: string): { kind: SectionKind; title: string } | null {
  const trimmed = line.trim().replace(/[:：]$/, '').trim();
  if (!trimmed || trimmed.length > 48 || isBullet(trimmed)) return null;
  if (EMAIL_RE.test(trimmed) || /\d{4}/.test(trimmed)) return null;
  const n = normalizeForMatch(trimmed);
  for (const [kind, keys] of SECTION_KEYWORDS) {
    if (keys.includes(n)) return { kind, title: trimmed };
  }
  // Uppercase short lines are headings of unknown sections.
  const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const isUpper = letters.length >= 4 && letters === letters.toUpperCase() && words(trimmed).length <= 4;
  if (isUpper) {
    for (const [kind, keys] of SECTION_KEYWORDS) if (keys.some((k) => n.startsWith(k))) return { kind, title: trimmed };
    return { kind: 'custom', title: trimmed };
  }
  for (const [kind, keys] of SECTION_KEYWORDS) {
    if (keys.some((k) => k.split(' ').length > 1 && n.startsWith(k)) && words(trimmed).length <= 5) return { kind, title: trimmed };
  }
  return null;
}

function splitCells(line: string): string[] {
  return line
    .split(/\t+|\s{3,}|\s[|·•]\s|\s[—–]\s|\s-\s/)
    .map((s) => s.trim().replace(/^[,|·•—–-]+|[,|·•—–-]+$/g, '').trim())
    .filter(Boolean);
}

function isLocation(text: string): boolean {
  const n = normalizeForMatch(text);
  if (!n || n.length > 40) return false;
  const parts = n.split(/\s*,\s*|\s+\(|\)/).filter(Boolean);
  return parts.length > 0 && LOCATION_WORDS.some((w) => n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`) || parts.includes(w));
}

function looksLikeRole(text: string): boolean {
  return hasAnyWord(text, ROLE_WORDS);
}

/** Joins wrapped lines: continuation lines are appended to the previous line. */
export function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      out.push('');
      continue;
    }
    const prev = out[out.length - 1];
    const continuation =
      prev !== undefined &&
      prev !== '' &&
      !isBullet(line) &&
      !detectHeading(line) &&
      !findDateRange(line) &&
      /^[a-zàâäçéèêëîïôöùûüÿœ(]/.test(line.trim()) &&
      !/[.!?:]$/.test(prev.trim());
    if (continuation) out[out.length - 1] = `${prev.trim()} ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

function candidate<K extends RecordKind>(
  kind: K,
  data: RecordDataMap[K],
  lang: Lang,
  rawText: string,
  issues: string[] = [],
): ParsedCandidate<K> {
  const confidence = issues.length === 0 ? 'high' : issues.length === 1 ? 'medium' : 'low';
  return { tempId: tempId(), kind, data, lang, confidence, issues, rawText };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function parseHeader(lines: string[]): { personal: PersonalData; leftovers: string[] } {
  const personal: PersonalData = { fullName: '', headline: '', email: '', phone: '', location: '', links: [] };
  const leftovers: string[] = [];
  const nonContact: string[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    const email = EMAIL_RE.exec(line);
    if (email) {
      if (!personal.email) personal.email = email[0];
      line = line.replace(email[0], ' ');
    }
    let url = URL_RE.exec(line);
    while (url) {
      const value = url[1];
      if (!personal.links.some((l) => l.url === value) && !value.includes('@')) {
        const label = /linkedin/i.test(value) ? 'LinkedIn' : /github/i.test(value) ? 'GitHub' : 'Website';
        personal.links.push({ label, url: value });
      }
      line = line.replace(url[0], ' ');
      url = URL_RE.exec(line);
    }
    const phone = PHONE_RE.exec(line);
    if (phone && phone[0].replace(/\D/g, '').length >= 9) {
      if (!personal.phone) personal.phone = phone[0].trim();
      line = line.replace(phone[0], ' ');
    }
    for (const cell of splitCells(line)) {
      if (isLocation(cell) && !personal.location) personal.location = cell;
      else if (cell.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2) nonContact.push(cell);
    }
  }
  const nameIdx = nonContact.findIndex((l) => {
    const w = l.split(/\s+/);
    return w.length >= 2 && w.length <= 5 && !looksLikeRole(l) && /^[A-ZÀ-Ý]/.test(l) && !/\d/.test(l);
  });
  if (nameIdx >= 0) {
    personal.fullName = nonContact[nameIdx];
    const rest = nonContact.filter((_, i) => i !== nameIdx);
    const headline = rest.find((l) => looksLikeRole(l)) ?? rest[0] ?? '';
    personal.headline = headline;
    leftovers.push(...rest.filter((l) => l !== headline));
  } else {
    leftovers.push(...nonContact);
  }
  return { personal, leftovers };
}

// ---------------------------------------------------------------------------
// Entries (experience, education, projects)
// ---------------------------------------------------------------------------

interface RawEntry {
  headerCells: string[];
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
  paragraphs: string[];
  raw: string[];
}

function splitEntries(lines: string[], singleDates: boolean): RawEntry[] {
  const content = lines.filter((l) => l.trim());
  const dateIdx: number[] = [];
  content.forEach((l, i) => {
    if (findDateRange(l) || (singleDates && !isBullet(l) && findSingleDate(l) && l.length < 120)) dateIdx.push(i);
  });
  if (dateIdx.length === 0) {
    // No dates: each non-bullet header line followed by bullets forms an entry.
    const entries: RawEntry[] = [];
    let cur: RawEntry | null = null;
    for (const l of content) {
      if (!isBullet(l) && (cur === null || cur.bullets.length > 0 || cur.paragraphs.length > 0 || l.length < 90)) {
        if (cur && (cur.bullets.length || cur.paragraphs.length || !isHeaderish(l))) {
          entries.push(cur);
          cur = null;
        }
        if (!cur) cur = { headerCells: [], start: '', end: '', current: false, bullets: [], paragraphs: [], raw: [] };
        if (isHeaderish(l) && cur.bullets.length === 0 && cur.headerCells.length < 3) cur.headerCells.push(...splitCells(l));
        else cur.paragraphs.push(l.trim());
        cur.raw.push(l);
      } else if (cur) {
        if (isBullet(l)) cur.bullets.push(stripBullet(l));
        else cur.paragraphs.push(l.trim());
        cur.raw.push(l);
      }
    }
    if (cur) entries.push(cur);
    return entries;
  }
  // Each date line anchors an entry; up to two short header lines right before it belong to it.
  const starts: number[] = [];
  dateIdx.forEach((d, k) => {
    const prevBoundary = k === 0 ? 0 : dateIdx[k - 1] + 1;
    let s = d;
    for (let back = 1; back <= 2; back++) {
      const i = d - back;
      if (i < prevBoundary) break;
      const l = content[i];
      if (isBullet(l) || !isHeaderish(l)) break;
      // a previous entry's trailing header-ish line only if nothing followed its own date
      s = i;
    }
    if (k > 0 && s <= dateIdx[k - 1]) s = dateIdx[k - 1] + 1;
    starts.push(s);
  });
  if (starts[0] > 0) starts[0] = 0;
  const entries: RawEntry[] = [];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : content.length;
    const chunk = content.slice(s, end);
    const d = dateIdx[k] - s;
    const entry: RawEntry = { headerCells: [], start: '', end: '', current: false, bullets: [], paragraphs: [], raw: chunk };
    chunk.forEach((l, i) => {
      if (i === d) {
        const range = findDateRange(l);
        let rest = l;
        if (range) {
          entry.start = range.start;
          entry.end = range.end;
          entry.current = range.current;
          rest = l.slice(0, range.index) + ' \t ' + l.slice(range.index + range.length);
        } else {
          const single = findSingleDate(l);
          if (single) {
            entry.end = single.date;
            rest = l.slice(0, single.index) + ' \t ' + l.slice(single.index + single.length);
          }
        }
        entry.headerCells.push(...splitCells(rest));
      } else if (isBullet(l)) {
        entry.bullets.push(stripBullet(l));
      } else if (i < d || (entry.bullets.length === 0 && entry.paragraphs.length === 0 && isHeaderish(l) && entry.headerCells.length < 3)) {
        entry.headerCells.push(...splitCells(l));
      } else {
        entry.paragraphs.push(l.trim());
      }
    });
    entries.push(entry);
  });
  return entries;
}

function isHeaderish(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 90 && !/[.!?]$/.test(t) && !isBullet(t);
}

function toExperience(e: RawEntry, lang: Lang): ParsedCandidate<'experience'> {
  const cells = e.headerCells.filter((c) => c.replace(/[^A-Za-zÀ-ÿ]/g, '').length > 0);
  let location = '';
  const others: string[] = [];
  for (const c of cells) {
    if (!location && isLocation(c)) location = c;
    else if (c.includes(',') && isLocation(c.split(',').slice(1).join(','))) {
      const [first, ...rest] = c.split(',');
      others.push(first.trim());
      if (!location) location = rest.join(',').trim();
    } else others.push(c);
  }
  // "Role chez/at Company" in a single cell
  const expanded: string[] = [];
  for (const c of others) {
    const m = /^(.+?)\s+(?:chez|at|@)\s+(.+)$/i.exec(c);
    if (m) expanded.push(m[1], m[2]);
    else expanded.push(c);
  }
  let role = expanded.find((c) => looksLikeRole(c)) ?? '';
  let company = expanded.find((c) => c !== role) ?? '';
  const issues: string[] = [];
  if (!role && expanded.length >= 2) {
    [company, role] = expanded;
    issues.push('Check which line is the company and which is the job title.');
  }
  if (!role && expanded.length === 1) company = expanded[0];
  if (!company) issues.push('Company not found.');
  if (!role) issues.push('Job title not found.');
  if (!e.start) issues.push('Dates not found.');
  const data: ExperienceData = {
    company,
    role,
    location,
    start: e.start,
    end: e.end,
    current: e.current,
    description: e.paragraphs.join(' '),
    bullets: e.bullets,
    achievements: [],
    technologies: [],
  };
  return candidate('experience', data, lang, e.raw.join('\n'), issues);
}

function toEducation(e: RawEntry, lang: Lang): ParsedCandidate<'education'> {
  // "MSc Computer Science, University of Lyon" → two cells
  const cells = e.headerCells.flatMap((c) => {
    const parts = c.split(/\s*,\s*/);
    if (parts.length > 1 && parts.some((p) => hasAnyWord(p, SCHOOL_WORDS)) && parts.some((p) => hasAnyWord(p, DEGREE_WORDS))) {
      return parts;
    }
    return [c];
  });
  let institution = cells.find((c) => hasAnyWord(c, SCHOOL_WORDS)) ?? '';
  let degree = cells.find((c) => c !== institution && hasAnyWord(c, DEGREE_WORDS)) ?? '';
  let location = cells.find((c) => c !== institution && c !== degree && isLocation(c)) ?? '';
  const rest = cells.filter((c) => c !== institution && c !== degree && c !== location);
  if (!degree && rest.length) degree = rest.shift()!;
  if (!institution && rest.length) institution = rest.shift()!;
  if (institution.includes(',') && !location) {
    const [first, ...others] = institution.split(',');
    if (isLocation(others.join(','))) {
      institution = first.trim();
      location = others.join(',').trim();
    }
  }
  const issues: string[] = [];
  if (!institution) issues.push('School not found.');
  if (!degree) issues.push('Degree not found.');
  const data: EducationData = {
    institution,
    degree,
    field: '',
    location,
    start: e.start,
    end: e.end,
    description: [...e.paragraphs, ...e.bullets].join(' '),
  };
  return candidate('education', data, lang, e.raw.join('\n'), issues);
}

function toProject(e: RawEntry, lang: Lang): ParsedCandidate<'project'> {
  const [name = '', role = ''] = e.headerCells;
  const data: ProjectData = {
    name,
    role,
    start: e.start,
    end: e.end,
    description: e.paragraphs.join(' '),
    bullets: e.bullets,
    technologies: [],
    url: '',
  };
  return candidate('project', data, lang, e.raw.join('\n'), name ? [] : ['Project name not found.']);
}

// ---------------------------------------------------------------------------
// Skills, languages, certifications, custom
// ---------------------------------------------------------------------------

function parseSkills(lines: string[], lang: Lang): ParsedCandidate<'skill'>[] {
  const out: ParsedCandidate<'skill'>[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = stripBullet(raw.trim());
    if (!line) continue;
    let category = '';
    let list = line;
    const m = /^([^:：]{2,40})[:：]\s*(.+)$/.exec(line);
    if (m) {
      category = m[1].trim();
      list = m[2];
    }
    const parts = list
      .split(/\s*[,;|•·]\s*|\t+|\s{3,}|\s\/\s/)
      .map((s) => s.trim().replace(/\.$/, ''))
      .filter((s) => s.length > 0 && s.length <= 50);
    for (const name of parts) {
      const key = normalizeForMatch(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const data: SkillData = { name, category, level: '' };
      out.push(candidate('skill', data, lang, raw));
    }
  }
  return out;
}

const LEVEL_WORDS = [
  'natif', 'native', 'langue maternelle', 'maternelle', 'mother tongue', 'bilingue', 'bilingual', 'courant', 'fluent', 'professionnel',
  'professional', 'intermediaire', 'intermediate', 'notions', 'basic', 'debutant', 'beginner', 'avance', 'advanced', 'lu ecrit parle',
  'a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'toeic', 'toefl', 'ielts', 'full professional proficiency', 'professional working proficiency',
  'limited working proficiency', 'elementary proficiency', 'native or bilingual proficiency',
];

function parseLanguages(lines: string[], lang: Lang): ParsedCandidate<'language'>[] {
  const out: ParsedCandidate<'language'>[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw.trim());
    if (!line) continue;
    const segments = line.split(/\s*[,;|•·]\s*|\t+|\s{3,}/).filter(Boolean);
    const joinedPairs = segments.length > 1 && segments.every((s) => /[:：(—–-]/.test(s)) ? segments : [line];
    for (const seg of joinedPairs) {
      const t = seg.trim();
      const m =
        /^([A-Za-zÀ-ÿ' ]{2,30}?)\s*\((.+)\)$/.exec(t) ?? /^([A-Za-zÀ-ÿ' ]{2,30}?)\s*(?:[:：—–-]|\s{2,}|\t)\s*(.+)$/.exec(t);
      let name = t;
      let level = '';
      if (m) {
        name = m[1].trim();
        level = m[2].trim();
      } else {
        const lvl = LEVEL_WORDS.find((w) => normalizeForMatch(seg).endsWith(` ${w}`));
        if (lvl) {
          const idx = normalizeForMatch(seg).lastIndexOf(lvl);
          name = seg.slice(0, idx).trim();
          level = seg.slice(idx).trim();
        }
      }
      if (!name || name.length > 30) continue;
      const data: LanguageData = { name, level };
      out.push(candidate('language', data, lang, raw, level ? [] : ['Level not found.']));
    }
  }
  return out;
}

function parseCertifications(lines: string[], lang: Lang): ParsedCandidate<'certification'>[] {
  return lines
    .map((l) => stripBullet(l.trim()))
    .filter(Boolean)
    .map((line) => {
      const date = findSingleDate(line);
      let rest = date ? (line.slice(0, date.index) + ' ' + line.slice(date.index + date.length)).trim() : line;
      rest = rest.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      const cells = splitCells(rest.replace(/,\s*$/, ''));
      const [name = rest, issuer = ''] = cells.length > 1 ? cells : rest.split(/\s*,\s*/);
      const data: CertificationData = { name: name.trim(), issuer: issuer.trim(), date: date?.date ?? '', url: '' };
      return candidate('certification', data, lang, line);
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseCvText(text: string, opts: { langHint?: Lang } = {}): ParsedCv {
  const lang = opts.langHint ?? detectLang(text);
  const lines = joinWrappedLines(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .split('\n'),
  );

  const sections: Array<{ kind: SectionKind | 'header'; title: string; lines: string[] }> = [
    { kind: 'header', title: '', lines: [] },
  ];
  for (const line of lines) {
    const h = detectHeading(line);
    if (h) sections.push({ kind: h.kind, title: h.title, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const candidates: ParsedCandidate[] = [];
  const unassigned: string[] = [];
  const header = parseHeader(sections[0].lines);
  const p = header.personal;
  if (p.fullName || p.email || p.phone) {
    const issues = p.fullName ? [] : ['Name not found.'];
    candidates.push(candidate('personal', p, lang, sections[0].lines.join('\n'), issues));
  }
  // Leftover header text (often a short summary without a heading).
  const leftoverParagraph = header.leftovers.filter((l) => l.length > 60).join(' ');
  if (leftoverParagraph) {
    candidates.push(candidate('profile', { title: '', text: leftoverParagraph } satisfies ProfileData, lang, leftoverParagraph));
  }
  unassigned.push(...header.leftovers.filter((l) => l.length <= 60));

  for (const section of sections.slice(1)) {
    const content = section.lines.filter((l) => l.trim());
    if (content.length === 0) continue;
    switch (section.kind) {
      case 'profile': {
        const textValue = content.map((l) => stripBullet(l)).join(' ').replace(/\s+/g, ' ').trim();
        candidates.push(candidate('profile', { title: section.title, text: textValue } satisfies ProfileData, lang, content.join('\n')));
        break;
      }
      case 'experience':
        for (const e of splitEntries(content, false)) candidates.push(toExperience(e, lang));
        break;
      case 'education':
        for (const e of splitEntries(content, true)) candidates.push(toEducation(e, lang));
        break;
      case 'projects':
        for (const e of splitEntries(content, false)) candidates.push(toProject(e, lang));
        break;
      case 'skills':
        candidates.push(...parseSkills(content, lang));
        break;
      case 'languages':
        candidates.push(...parseLanguages(content, lang));
        break;
      case 'certifications':
        candidates.push(...parseCertifications(content, lang));
        break;
      case 'custom': {
        const bullets = content.filter(isBullet).map(stripBullet);
        const textValue = content.filter((l) => !isBullet(l)).join(' ');
        const data: CustomData = { section: section.title, title: section.title, subtitle: '', date: '', text: textValue, bullets };
        candidates.push(candidate('custom', data, lang, content.join('\n')));
        break;
      }
    }
  }
  return {
    lang,
    candidates,
    unassigned,
    sections: sections.slice(1).map((s) => ({ kind: s.kind as SectionKind, title: s.title })),
  };
}
