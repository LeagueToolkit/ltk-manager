import { useToast } from "@/components";

/** Longest value a toast shows whole. */
const VALUE_LIMIT = 72;

/**
 * Drops the middle out of an over-long value, keeping both ends.
 *
 * The tail of a path or a hash is the part that identifies it, so a plain
 * trailing cut would throw away the half worth reading.
 */
function elide(value: string): string {
  if (value.length <= VALUE_LIMIT) return value;

  const head = Math.ceil((VALUE_LIMIT - 1) / 2);
  const tail = VALUE_LIMIT - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * Copy text to the clipboard, and report either way.
 *
 * A copy leaves nothing on screen, so the toast is the whole of its feedback
 * and a failure has to be as visible as a success. `label` names what was
 * copied and reads inside "Copied {label}", while the value itself is the
 * toast's description, so the row confirms what actually landed on the
 * clipboard.
 *
 * Not memoized, because `useToast` builds its handle per render and nothing
 * downstream could hold a stable identity anyway.
 */
export function useCopyToClipboard(): (text: string, label: string) => Promise<void> {
  const { toast } = useToast();

  return async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: `Copied ${label}`,
        description: elide(text),
        type: "success",
        timeout: 2500,
      });
    } catch {
      toast({
        title: `Couldn't copy ${label} to clipboard`,
        description: elide(text),
        type: "error",
        timeout: 3500,
      });
    }
  };
}
