import type { ContentTree } from "@/lib/tauri";

/** The names a layer's declarations manifest takes at the layer's root, as league-mod reads them. */
const MANIFEST_NAMES: readonly string[] = [
  "game_data.yaml",
  "game_data.yml",
  "game_data.toml",
  "game_data.json",
];

/** Whether any layer of the project holds a declarations manifest. */
export function holdsDeclarations(tree: ContentTree): boolean {
  return tree.layers.some((layer) =>
    layer.entries.some((entry) => MANIFEST_NAMES.includes(entry.relativePath)),
  );
}

/**
 * The project's "Use game data declarations": the reader's choice, else whether a layer
 * already declares. Null while neither is known.
 */
export function declarationsOn(
  choice: boolean | undefined,
  tree: ContentTree | undefined,
): boolean | null {
  if (choice !== undefined) return choice;
  if (tree === undefined) return null;

  return holdsDeclarations(tree);
}
