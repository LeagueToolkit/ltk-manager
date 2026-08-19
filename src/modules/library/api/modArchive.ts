/**
 * Archive extensions the library can install, without a leading dot.
 *
 * A fantome archive is a zip and mods are distributed under either extension, so the
 * backend resolves `.zip` to the fantome format.
 */
export const MOD_ARCHIVE_EXTENSIONS = ["modpkg", "fantome", "zip"] as const;

/** True when a path ends in an extension the library can install. */
export function isModArchive(path: string): boolean {
  const lower = path.toLowerCase();
  return MOD_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}
