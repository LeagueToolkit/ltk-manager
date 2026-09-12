/**
 * `kAnalyticDragMotion`'s closed form, one axis at a time.
 *
 * Decision 2.39 of docs/plans/vfx-particle-renderer.md.
 */

/** Where one axis eases out to, `birthVelocity / birthDrag`, and nothing without a birth drag. */
export function analyticTerminal(velocity: number, birthDrag: number): number {
  return birthDrag > 0 ? velocity / birthDrag : 0;
}

/** What of an axis's terminal displacement is still to travel at `age` under `drag`. */
export function analyticOffset(terminal: number, drag: number, age: number): number {
  return Math.exp(-drag * age) * terminal;
}
