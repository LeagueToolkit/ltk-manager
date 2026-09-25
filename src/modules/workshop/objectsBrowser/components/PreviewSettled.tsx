import { useEffect } from "react";

import type { PreviewOutcome } from "../state/previewStills";

/** Reports a preview outcome without a still, which frees the slot for the next tile. */
export function PreviewSettled({
  outcome,
  onOutcome,
}: {
  outcome: PreviewOutcome;
  onOutcome: (outcome: PreviewOutcome) => void;
}) {
  useEffect(() => onOutcome(outcome), [outcome, onOutcome]);
  return null;
}
