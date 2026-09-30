import type { AppStatus } from './types';

export const STATUSES: readonly AppStatus[] = ['preparing', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];

export const STATUS_LABEL: Record<AppStatus, string> = {
  preparing: 'Preparing',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const STATUS_HINT: Record<AppStatus, string> = {
  preparing: 'Draft in progress, not sent yet',
  applied: 'Application sent',
  interview: 'Interview process ongoing',
  offer: 'Offer received',
  rejected: 'Closed by the company',
  withdrawn: 'Closed by you',
};

/** Allowed status changes. Backward steps are allowed as corrections. */
const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  preparing: ['applied', 'withdrawn'],
  applied: ['interview', 'offer', 'rejected', 'withdrawn', 'preparing'],
  interview: ['offer', 'rejected', 'withdrawn', 'applied'],
  offer: ['rejected', 'withdrawn', 'interview'],
  rejected: ['preparing', 'applied', 'interview'],
  withdrawn: ['preparing', 'applied'],
};

export function allowedTransitions(from: AppStatus): AppStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: AppStatus, to: AppStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isClosed(status: AppStatus): boolean {
  return status === 'rejected' || status === 'withdrawn';
}

/** Whether a new version can be recorded as sent for an application in this status. */
export function canRecordSend(status: AppStatus): boolean {
  return !isClosed(status);
}

/** Status after recording a sent version: first send moves Preparing → Applied, later stages are kept. */
export function statusAfterSend(status: AppStatus): AppStatus {
  return status === 'preparing' ? 'applied' : status;
}

export function transitionMessage(from: AppStatus, to: AppStatus): string {
  return `Status changed from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}`;
}
