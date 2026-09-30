// Motion model of the liquid selection lens: ONE continuous shape that
// glides from the previous option to the new one, stretching into a bridge
// mid-way (squashing slightly), then settling with a small overshoot.
// With reduced motion it jumps directly (no deformation, no travel).

export interface Rect {
  x: number;
  w: number;
}

export interface LensFrame {
  left: string;
  width: string;
  transform: string;
  offset: number;
}

export const LENS_DURATION_MS = 320;
export const LENS_EASING = 'cubic-bezier(0.3, 0.75, 0.2, 1)';

export function lensKeyframes(from: Rect, to: Rect, reducedMotion: boolean): LensFrame[] {
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;
  if (reducedMotion || (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.w - to.w) < 0.5)) {
    return [
      { left: px(to.x), width: px(to.w), transform: 'scale(1, 1)', offset: 0 },
      { left: px(to.x), width: px(to.w), transform: 'scale(1, 1)', offset: 1 },
    ];
  }
  const dir = to.x > from.x ? 1 : -1;
  const spanLeft = Math.min(from.x, to.x);
  const spanRight = Math.max(from.x + from.w, to.x + to.w);
  // Bridge: the lens covers most of the distance between both options.
  const bridgeLeft = dir > 0 ? from.x + (to.x - from.x) * 0.28 : to.x + (from.x - to.x) * 0.12;
  const bridgeRight = dir > 0 ? to.x + to.w - (to.x - from.x) * 0.12 : from.x + from.w - (from.x - to.x) * 0.28;
  const bridgeW = Math.max(Math.min(bridgeRight, spanRight) - Math.max(bridgeLeft, spanLeft), Math.max(from.w, to.w));
  const overshoot = Math.min(6, Math.abs(to.x - from.x) * 0.04);
  return [
    { left: px(from.x), width: px(from.w), transform: 'scale(1, 1)', offset: 0 },
    { left: px(from.x + dir * 2), width: px(from.w + 6), transform: 'scale(1, 0.96)', offset: 0.12 },
    { left: px(Math.max(bridgeLeft, spanLeft)), width: px(bridgeW), transform: 'scale(1, 0.86)', offset: 0.5 },
    { left: px(to.x + dir * overshoot), width: px(to.w - overshoot * 0.5), transform: 'scale(1, 1.03)', offset: 0.82 },
    { left: px(to.x), width: px(to.w), transform: 'scale(1, 1)', offset: 1 },
  ];
}

/** Index of the next enabled option for arrow-key navigation (wraps around). */
export function nextIndex(current: number, count: number, key: string): number {
  if (count === 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}
