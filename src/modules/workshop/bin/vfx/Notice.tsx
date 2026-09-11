/** What the pane says in place of a viewport: one line, centred, on no surface. */
export function Notice({ text }: { text: string }) {
  return (
    <span
      data-ui="Notice"
      className="flex min-h-0 flex-1 items-center justify-center px-2 text-center text-meta text-surface-400 select-none"
    >
      {text}
    </span>
  );
}
