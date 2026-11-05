import { useQuery } from "@tanstack/react-query";

import type { MaterialWarning, ShaderSchema } from "@/lib/tauri";

import type { ViewContext } from "../../classes/components/ClassCells";
import { materialQueries } from "../api/materialQueries";
import { warningText } from "../utils/materialWarnings";
import { mergedSchema } from "../utils/passSchemas";

/** The warnings the program read raises about one texture, which mark its row. */
const TEXTURE_WARNINGS: ReadonlySet<MaterialWarning["kind"]> = new Set([
  "stringTexturePath",
  "textureNotFound",
  "noTexturePath",
]);

/** The program read of the view's material, null until it answers. */
export function useProgram(view: ViewContext) {
  return useQuery(materialQueries.program(view.document, view.entry || null)).data ?? null;
}

/** The declarations of every pass shader, merged, once the program read answers them. */
export function useSchema(view: ViewContext): ShaderSchema | null {
  return mergedSchema(useProgram(view)?.passes.map((each) => each.pass.schema) ?? []);
}

/** Every name the shader declares, which the tables' one name column is measured over. */
export function useDeclaredNames(view: ViewContext): string[] {
  const schema = useSchema(view);
  if (schema === null) return [];
  return [...schema.textures, ...schema.params, ...schema.switches].map((each) => each.name);
}

/** What the program read warns about each texture, by its name. */
export function useTextureWarnings(view: ViewContext): ReadonlyMap<string, string> {
  const warnings = useProgram(view)?.warnings ?? [];
  const byName = new Map<string, string>();
  for (const warning of warnings) {
    if (TEXTURE_WARNINGS.has(warning.kind) && "name" in warning) {
      byName.set(warning.name, warningText(warning));
    }
  }
  return byName;
}
