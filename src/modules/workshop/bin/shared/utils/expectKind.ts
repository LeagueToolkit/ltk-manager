import { map, type Result } from "@/utils/result";

/** One variant of a union tagged on `kind`. */
export type KindOf<T extends { kind: string }, K extends T["kind"]> = Extract<T, { kind: K }>;

/**
 * A backend answer narrowed to the variant `kind` its request answers.
 *
 * `bin_edit` and `bin_choices` fix the variant per request (ADR-0051), so another variant is a
 * bug and throws.
 */
export function expectKind<T extends { kind: string }, K extends T["kind"]>(
  result: Result<T>,
  kind: K,
): Result<KindOf<T, K>> {
  return map(result, (answer) => {
    if (answer.kind !== kind) {
      throw new Error(`Expected a "${kind}" answer, got "${answer.kind}"`);
    }

    return answer as KindOf<T, K>;
  });
}
