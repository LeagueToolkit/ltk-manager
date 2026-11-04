import type { ShaderSchema } from "@/lib/tauri";

/**
 * Merges the declarations of every pass's shader into one schema, in pass order.
 *
 * Every pass reads the material's entries by name, so a name any pass declares is declared. The
 * first pass that declares a name gives its row. Returns null if no pass has a schema.
 */
export function mergedSchema(schemas: readonly (ShaderSchema | null)[]): ShaderSchema | null {
  const present = schemas.filter((schema): schema is ShaderSchema => schema !== null);
  if (present.length === 0) return null;

  const firstOf = <T extends { readonly name: string }>(rows: readonly T[]): T[] => {
    const byName = new Map<string, T>();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, row);
    }
    return [...byName.values()];
  };

  return {
    params: firstOf(present.flatMap((schema) => schema.params)),
    textures: firstOf(present.flatMap((schema) => schema.textures)),
    switches: firstOf(present.flatMap((schema) => schema.switches)),
  };
}
