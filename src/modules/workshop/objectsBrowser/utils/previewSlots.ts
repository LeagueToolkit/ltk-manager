/** One preview a slot renders, under the still key it saves to. */
export interface PreviewJob<N = unknown> {
  readonly key: string;
  readonly node: N;
}

/**
 * The job each slot runs next.
 *
 * `live` goes first, then `stills` in order. A slot keeps its current job while that job is
 * still due, so a render in progress is not moved. While `admit` is off, as during a scroll,
 * a free slot takes only the live job.
 */
export function assignSlots<J extends PreviewJob>(
  current: readonly (J | null)[],
  live: J | null,
  stills: readonly J[],
  admit: boolean,
): (J | null)[] {
  const assigned = (job: J) => current.some((slot) => slot?.key === job.key);
  const order = live === null ? stills : [live, ...stills.filter((job) => job.key !== live.key)];
  const due = (admit ? order : order.filter((job) => job === live || assigned(job))).slice(
    0,
    current.length,
  );

  const next = current.map((slot) =>
    slot === null ? null : (due.find((job) => job.key === slot.key) ?? null),
  );
  for (const job of due) {
    if (next.some((slot) => slot?.key === job.key)) continue;
    next[next.indexOf(null)] = job;
  }

  return next;
}

/** Whether two assignments run the same jobs in the same slots. */
export function slotsEquals(a: readonly (PreviewJob | null)[], b: readonly (PreviewJob | null)[]) {
  return a.length === b.length && a.every((job, index) => job?.key === b[index]?.key);
}
