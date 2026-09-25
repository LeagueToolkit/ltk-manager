import { SegmentedControl } from "@/components";
import { m } from "@/i18n";
import type { MapDecorationMode, Settings } from "@/lib/tauri";

import { useMapDecorations } from "../api";
import {
  type DecorationChoice,
  decorationLabel,
  decorationOptions,
  withDecoration,
} from "../builtinMods";
import { MapTags } from "./MapTags";

interface MapDecorationsControlProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

/**
 * One line per map decoration the install's mutators switch, each with a Game, Hidden or
 * Always picker.
 *
 * The list is read from the install, so a decoration a new patch adds appears without a
 * release, under its mutator's name until it has a label of its own.
 */
export function MapDecorationsControl({ settings, onSave }: MapDecorationsControlProps) {
  const { data: decorations, isPending } = useMapDecorations(settings.leaguePath);
  const modes = settings.builtinMods.mapDecorations;

  if (!settings.leaguePath) {
    return <Notice text={m.settings_builtins_map_decorations_no_path()} />;
  }

  if (isPending) {
    return <Notice text={m.settings_builtins_map_decorations_loading()} />;
  }

  if (!decorations || decorations.length === 0) {
    return <Notice text={m.settings_builtins_map_decorations_empty()} />;
  }

  const save = (mutator: string, choice: DecorationChoice) =>
    onSave({
      ...settings,
      builtinMods: {
        ...settings.builtinMods,
        mapDecorations: withDecoration(withoutOtherSpellings(modes, mutator), mutator, choice),
      },
    });

  return (
    <div className="flex flex-col gap-2" data-ui="MapDecorationsControl">
      {decorations.map(({ mutator, maps }) => (
        <div key={mutator} className="flex items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2 text-sm text-surface-200">
            <span className="truncate">{decorationLabel(mutator)}</span>
            <MapTags maps={maps} />
          </span>
          <SegmentedControl
            size="xs"
            aria-label={decorationLabel(mutator)}
            options={decorationOptions()}
            value={modeOf(modes, mutator)}
            onChange={(choice) => save(mutator, choice)}
          />
        </div>
      ))}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <span className="text-sm text-surface-400">{text}</span>;
}

type Modes = Partial<Record<string, MapDecorationMode>>;

/** The mode set for `mutator`, matched without case as the game matches a mutator key. */
function modeOf(modes: Modes, mutator: string): DecorationChoice {
  const key = Object.keys(modes).find((name) => name.toLowerCase() === mutator.toLowerCase());
  return (key && modes[key]) || "game";
}

/** `modes` without any other spelling of `mutator`, so one mutator keeps one entry. */
function withoutOtherSpellings(modes: Modes, mutator: string): Modes {
  return Object.fromEntries(
    Object.entries(modes).filter(
      ([name]) => name === mutator || name.toLowerCase() !== mutator.toLowerCase(),
    ),
  );
}
