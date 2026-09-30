import type { ParsedCandidate } from './cvparse';
import type { GroupResolution, MergeGroup } from './dedupe';
import type { ExtractionStatus, Lang, SourceFormat } from './types';

export interface ImportFileView {
  sourceId: string | null;
  filename: string;
  format: SourceFormat;
  status: ExtractionStatus | 'duplicate' | 'unsupported';
  method: string;
  warnings: string[];
  text: string;
  lang: Lang;
  candidates: ParsedCandidate[];
  duplicateOf: string | null;
}

export interface ImportBatchView {
  id: string;
  createdAt: string;
  files: ImportFileView[];
  groups: MergeGroup[];
}

export type GroupDecisionInput = GroupResolution & { skip?: boolean };
