import { describe, expect, it } from 'vitest';
import { STATUSES, STATUS_HINT, STATUS_LABEL, allowedTransitions, canRecordSend, canTransition, isClosed, statusAfterSend, transitionMessage } from '../../src/shared/status';

describe('application statuses', () => {
  it('has consistent labels for every status', () => {
    expect(STATUSES).toEqual(['preparing', 'applied', 'interview', 'offer', 'rejected', 'withdrawn']);
    for (const s of STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_HINT[s]).toBeTruthy();
      expect(allowedTransitions(s)).not.toContain(s);
    }
  });

  it('allows forward moves, closing and corrections but not nonsense', () => {
    expect(canTransition('preparing', 'applied')).toBe(true);
    expect(canTransition('preparing', 'interview')).toBe(false);
    expect(canTransition('applied', 'interview')).toBe(true);
    expect(canTransition('interview', 'offer')).toBe(true);
    expect(canTransition('offer', 'preparing')).toBe(false);
    expect(canTransition('rejected', 'preparing')).toBe(true);
    expect(canTransition('withdrawn', 'applied')).toBe(true);
  });

  it('moves only the first send from Preparing to Applied and blocks sends when closed', () => {
    expect(statusAfterSend('preparing')).toBe('applied');
    expect(statusAfterSend('interview')).toBe('interview');
    expect(canRecordSend('withdrawn')).toBe(false);
    expect(canRecordSend('applied')).toBe(true);
    expect(isClosed('rejected')).toBe(true);
    expect(transitionMessage('applied', 'interview')).toBe('Status changed from Applied to Interview');
  });
});
