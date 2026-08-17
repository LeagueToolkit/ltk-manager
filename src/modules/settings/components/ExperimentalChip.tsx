/** Marks a setting whose behaviour is not settled yet. */
export function ExperimentalChip() {
  return (
    <span className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-warning-text uppercase">
      Experimental
    </span>
  );
}
