import type { AudioSettings, BuiltinModSettings, CharacterInking, Settings } from "@/lib/tauri";
import type { AppearanceKey, LayoutSettingKey } from "@/stores";

/** A setting the backend stores, or one a frontend store owns. */
export type SettingKey =
  | keyof Settings
  | `builtinMods.${Exclude<keyof BuiltinModSettings, "characterInking">}`
  | `${typeof INKING_PREFIX}${keyof CharacterInking}`
  | `audio.${keyof AudioSettings}`
  | `display.${AppearanceKey}`
  | `layout.${LayoutSettingKey}`;

/** The prefix of a key that names one field of the character inking group. */
export const INKING_PREFIX = "builtinMods.characterInking.";

/** The character inking field `key` names, or `undefined` if it names none. */
export function inkingField(key: SettingKey): keyof CharacterInking | undefined {
  return key.startsWith(INKING_PREFIX)
    ? (key.slice(INKING_PREFIX.length) as keyof CharacterInking)
    : undefined;
}
