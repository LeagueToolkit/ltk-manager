import { type BrokenMods, useBrokenMods } from "./useBrokenMods";

/**
 * What mod health has for the status bar to carry, or `null` with nothing to say.
 *
 * Per "The status bar item" in docs/ux/MOD_HEALTH.md. It answers to the stored
 * verdicts rather than to a sweep having just run, so a launch that checked
 * nothing still says what the library is carrying.
 */
export function useModHealthStatus(): BrokenMods | null {
  const broken = useBrokenMods();

  if (broken.repairable.length === 0 && broken.unrepairable.length === 0) return null;
  return broken;
}
