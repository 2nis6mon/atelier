import { create } from 'zustand';
import type { AiAction, AiScopeType, Tone } from '../../shared/types';

export interface SelectionSnapshot {
  path: string;
  text: string;
  fieldText: string;
}

interface AssistantState {
  action: AiAction;
  scope: AiScopeType;
  sectionId: string | null;
  tone: Tone;
  instructions: string;
  includeOffer: boolean;
  libraryRecordIds: string[];
  selection: SelectionSnapshot | null;
  panel: 'assistant' | 'job';
  focusNonce: number;
  set(patch: Partial<Omit<AssistantState, 'set' | 'focusInstructions'>>): void;
  focusInstructions(): void;
}

export const useAssistant = create<AssistantState>((set, get) => ({
  action: 'rewrite',
  scope: 'selection',
  sectionId: null,
  tone: 'concise',
  instructions: '',
  includeOffer: true,
  libraryRecordIds: [],
  selection: null,
  panel: 'assistant',
  focusNonce: 0,
  set(patch) {
    set(patch);
  },
  focusInstructions() {
    set({ focusNonce: get().focusNonce + 1, panel: 'assistant' });
  },
}));
