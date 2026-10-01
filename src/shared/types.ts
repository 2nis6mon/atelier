// Core domain types shared by the main process (storage, AI, export) and the
// renderer (UI). Everything here is plain serialisable data.

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];

/** 'YYYY' or 'YYYY-MM'. Empty string = unknown. */
export type PartialDate = string;

export interface SourceRef {
  sourceId: string;
  label: string; // original filename, e.g. CV_2024.pdf
}

/** Where a piece of content came from. */
export interface Citation {
  type: 'cv' | 'library' | 'offer' | 'source' | 'user';
  id?: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Library (reusable professional records, independent from any CV)
// ---------------------------------------------------------------------------

export type RecordKind =
  | 'personal'
  | 'profile'
  | 'experience'
  | 'project'
  | 'education'
  | 'certification'
  | 'skill'
  | 'language'
  | 'custom';

export const RECORD_KINDS: readonly RecordKind[] = [
  'experience',
  'education',
  'skill',
  'language',
  'certification',
  'project',
  'profile',
  'personal',
  'custom',
];

export interface Link {
  label: string;
  url: string;
}

export interface PersonalData {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: Link[];
}

export interface ProfileData {
  title: string;
  text: string;
}

export interface ExperienceData {
  company: string;
  role: string;
  location: string;
  start: PartialDate;
  end: PartialDate;
  current: boolean;
  description: string;
  bullets: string[];
  achievements: string[];
  technologies: string[];
}

export interface ProjectData {
  name: string;
  role: string;
  start: PartialDate;
  end: PartialDate;
  description: string;
  bullets: string[];
  technologies: string[];
  url: string;
}

export interface EducationData {
  institution: string;
  degree: string;
  field: string;
  location: string;
  start: PartialDate;
  end: PartialDate;
  description: string;
}

export interface CertificationData {
  name: string;
  issuer: string;
  date: PartialDate;
  url: string;
}

export interface SkillData {
  name: string;
  category: string;
  level: string;
}

export interface LanguageData {
  name: string;
  level: string;
}

export interface CustomData {
  section: string;
  title: string;
  subtitle: string;
  date: string;
  text: string;
  bullets: string[];
}

export interface RecordDataMap {
  personal: PersonalData;
  profile: ProfileData;
  experience: ExperienceData;
  project: ProjectData;
  education: EducationData;
  certification: CertificationData;
  skill: SkillData;
  language: LanguageData;
  custom: CustomData;
}

export interface LibraryRecord<K extends RecordKind = RecordKind> {
  id: string;
  kind: K;
  lang: Lang;
  data: RecordDataMap[K];
  /** Every original document this record was found in. */
  sources: SourceRef[];
  /** For fields chosen during conflict resolution: which source provided the value. */
  fieldSources: Record<string, SourceRef | { user: true }>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Original documents
// ---------------------------------------------------------------------------

export type SourceFormat = 'docx' | 'pdf' | 'pages' | 'txt' | 'html' | 'md' | 'rtf' | 'unknown';

export type ExtractionStatus =
  | 'extracted' // text extracted and parsed
  | 'needs-review' // extracted but conflicts/low confidence
  | 'needs-ocr' // PDF without a text layer
  | 'conversion-needed' // Pages without a usable local extraction
  | 'failed';

export interface SourceFile {
  id: string;
  filename: string;
  format: SourceFormat;
  sha256: string;
  size: number;
  importedAt: string;
  status: ExtractionStatus;
  method: string; // e.g. 'docx:mammoth', 'pdf:text', 'pdf:ocr', 'pages:preview-pdf'
  extractedText: string;
  warnings: string[];
  /** When a Pages file was converted to DOCX, links the converted file to the original. */
  convertedFromId: string | null;
  recordCount: number;
}

// ---------------------------------------------------------------------------
// CV documents (content + presentation, separated)
// ---------------------------------------------------------------------------

export type BlockType =
  | 'profile'
  | 'experience'
  | 'education'
  | 'skills'
  | 'languages'
  | 'certifications'
  | 'projects'
  | 'custom';

export type Zone = 'main' | 'side';
export type TemplateId = 'classic' | 'sidebar' | 'compact';

export interface Bullet {
  id: string;
  text: string;
}

export interface TextItem {
  id: string;
  kind: 'text';
  text: string;
  hidden?: boolean;
  recordId?: string | null;
}

export interface EntryItem {
  id: string;
  kind: 'entry';
  title: string; // role / degree / project name
  org: string; // company / institution / issuer
  location: string;
  start: PartialDate;
  end: PartialDate;
  current: boolean;
  text: string; // optional description paragraph
  bullets: Bullet[];
  hidden?: boolean;
  recordId?: string | null;
}

export interface TagsItem {
  id: string;
  kind: 'tags';
  label: string;
  tags: string[];
  hidden?: boolean;
  recordId?: string | null;
}

export interface PairItem {
  id: string;
  kind: 'pair';
  name: string;
  level: string;
  hidden?: boolean;
  recordId?: string | null;
}

export type Item = TextItem | EntryItem | TagsItem | PairItem;
export type ItemKind = Item['kind'];

export interface Block {
  id: string;
  type: BlockType;
  title: string;
  zone: Zone;
  hidden: boolean;
  items: Item[];
}

export interface CvHeader {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: Link[];
}

export interface CvStyle {
  bodyFont: FontId;
  headingFont: FontId;
  fontSize: number; // pt, body text
  lineHeight: number; // unitless
  headingColor: string;
  accentColor: string;
  textColor: string;
  marginMm: number;
  sectionSpacing: number; // multiplier 0.5..2
  sidebarWidth: number; // percent of content width, sidebar template only
}

export type FontId = 'source-serif' | 'inter' | 'lora' | 'plex-sans';

export interface CvDocument {
  schema: 1;
  lang: Lang;
  header: CvHeader;
  blocks: Block[];
  template: TemplateId;
  style: CvStyle;
  /** Explicit page breaks requested by the user: block ids that start a new page. */
  pageBreaks: string[];
}

export interface Cv {
  id: string;
  name: string;
  description: string;
  lang: Lang;
  applicationId: string | null;
  baseCvId: string | null;
  document: CvDocument;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type CvSummary = Omit<Cv, 'document'> & {
  headerName: string;
  headline: string;
  versionCount: number;
  sentCount: number;
  pendingProposals: number;
};

// ---------------------------------------------------------------------------
// Versions and sent snapshots
// ---------------------------------------------------------------------------

export type VersionKind = 'checkpoint' | 'sent';

export interface SentFile {
  id: string;
  versionId: string;
  kind: 'pdf' | 'docx';
  filename: string;
  sha256: string;
  size: number;
  createdAt: string;
}

export interface CvVersion {
  id: string;
  cvId: string;
  number: number;
  kind: VersionKind;
  label: string;
  document: CvDocument;
  docHash: string;
  locked: boolean;
  applicationId: string | null;
  createdAt: string;
  files: SentFile[];
  /** Sent versions: the application as it was at send time (later edits to the offer do not change it). */
  sentContext: SentContext | null;
}

export interface SentContext {
  company: string;
  role: string;
  offerText: string;
  offerUrl: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export type AppStatus = 'preparing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

export interface Application {
  id: string;
  company: string;
  role: string;
  location: string;
  lang: Lang;
  status: AppStatus;
  offerText: string;
  offerUrl: string;
  offerFileName: string;
  notes: string;
  cvId: string | null;
  baseCvId: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

export type AppEventType = 'created' | 'status' | 'sent' | 'note' | 'cv' | 'exported' | 'offer';

export interface AppEvent {
  id: string;
  applicationId: string;
  at: string;
  type: AppEventType;
  message: string;
  data: Record<string, unknown>;
}

export interface ApplicationSummary extends Application {
  sentCount: number;
  lastSentAt: string | null;
  lastSentFiles: Array<'pdf' | 'docx'>;
  pendingProposals: number;
  cvLang: Lang | null;
}

// ---------------------------------------------------------------------------
// AI proposals & conversations
// ---------------------------------------------------------------------------

export type ProposalKind = 'rewrite' | 'insert' | 'remove' | 'reorder' | 'library' | 'question' | 'comment';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export interface Proposal {
  id: string;
  cvId: string;
  requestId: string;
  kind: ProposalKind;
  /** Field path (see document.ts) for rewrite/remove; block id for insert/reorder/library. */
  target: string;
  /** Text at target when the request was sent. Used to detect conflicts before applying. */
  baseText: string;
  proposedText: string;
  /** For reorder: item ids in their original and proposed order. */
  baseOrder: string[];
  proposedOrder: string[];
  /** For library proposals: the record being brought in. */
  recordId: string | null;
  /** For insert: insert the new bullet/item after this id (null = end). */
  afterId: string | null;
  explanation: string;
  citations: Citation[];
  /** Terms not found in the user's documents; accepting requires explicit confirmation. */
  unverified: string[];
  confirmed: boolean;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export type AiAction =
  | 'adapt'
  | 'rewrite'
  | 'tone'
  | 'translate'
  | 'recover'
  | 'comment'
  | 'chat'
  | 'consolidate';

export type AiScopeType = 'selection' | 'section' | 'cv';

export interface AiScope {
  type: AiScopeType;
  /** For selection: field path; for section: block id. */
  target: string | null;
  /** Selected substring (selection scope). */
  selectionText: string;
}

export type Tone = 'concise' | 'professional' | 'confident' | 'warm' | 'neutral';

export interface AiRequestInput {
  action: AiAction;
  scope: AiScope;
  tone: Tone | null;
  targetLang: Lang | null;
  instructions: string;
  includeOffer: boolean;
  libraryRecordIds: string[];
}

export interface ConversationMessage {
  id: string;
  cvId: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  requestId: string | null;
  action: AiAction | null;
  providerLabel: string;
  status: 'ok' | 'error' | 'cancelled' | 'pending';
  proposalIds: string[];
  contextLabels: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Providers & settings
// ---------------------------------------------------------------------------

export type ProviderId = 'chatgpt' | 'openai' | 'anthropic' | 'compatible';

export type ProviderMode = 'plan' | 'api' | 'local';

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  mode: ProviderMode;
  billingNote: string;
  connected: boolean;
  accountLabel: string;
  model: string;
  models: string[];
  lastError: string | null;
  verified: boolean;
  limits: string;
}

export type MotionPref = 'system' | 'reduce' | 'full';
export type TransparencyPref = 'system' | 'reduce' | 'full';

export interface Settings {
  defaultProvider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
  compatibleBaseUrl: string;
  motion: MotionPref;
  transparency: TransparencyPref;
  onboardingDone: boolean;
  lastRoute: string;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultProvider: null,
  models: {},
  compatibleBaseUrl: 'http://127.0.0.1:11434/v1',
  motion: 'system',
  transparency: 'system',
  onboardingDone: false,
  lastRoute: '/library',
};
