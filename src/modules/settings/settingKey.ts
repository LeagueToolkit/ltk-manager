import type {
  AudioSettings,
  BuiltinModSettings,
  CharacterInking,
  LoadingScreenSettings,
  Settings,
} from "@/lib/tauri";
import type { AppearanceKey, LayoutSettingKey } from "@/stores";

/** A setting the backend stores, or one a frontend store owns. */
export type SettingKey =
  | keyof Settings
  | `builtinMods.${Exclude<keyof BuiltinModSettings, "characterInking" | "loadingScreen">}`
  | `${typeof INKING_PREFIX}${keyof CharacterInking}`
  | `${typeof LOADING_SCREEN_PREFIX}${keyof LoadingScreenSettings}`
  | `audio.${keyof AudioSettings}`
  | `display.${AppearanceKey}`
  | `layout.${LayoutSettingKey}`;

/** The prefix of a key that names one field of the character inking group. */
export const INKING_PREFIX = "builtinMods.characterInking.";

/** The prefix of a key that names one field of the loading screen group. */
export const LOADING_SCREEN_PREFIX = "builtinMods.loadingScreen.";

/** The character inking field `key` names, or `undefined` if it names none. */
export function inkingField(key: SettingKey): keyof CharacterInking | undefined {
  return key.startsWith(INKING_PREFIX)
    ? (key.slice(INKING_PREFIX.length) as keyof CharacterInking)
    : undefined;
}

/** The loading screen field `key` names, or `undefined` if it names none. */
export function loadingScreenField(key: SettingKey): keyof LoadingScreenSettings | undefined {
  return key.startsWith(LOADING_SCREEN_PREFIX)
    ? (key.slice(LOADING_SCREEN_PREFIX.length) as keyof LoadingScreenSettings)
    : undefined;
}
