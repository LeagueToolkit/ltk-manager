import { z } from "zod";

/**
 * What a project's slug may be, which is what its directory is named.
 *
 * The rule lives here rather than in either dialog, so creating a project and
 * renaming one cannot come to disagree about what a valid name is.
 */
export const projectSlugSchema = z
  .string()
  .min(1, "Project name is required")
  .regex(/^[a-z0-9-]+$/, "Must be lowercase letters, numbers, and hyphens only")
  .refine((val) => !val.startsWith("-") && !val.endsWith("-"), "Cannot start or end with a hyphen");

/** The reason a slug is refused, or `null` where it is fine. */
export function projectSlugError(value: string): string | null {
  const result = projectSlugSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid project name");
}
