import { Combobox, useComboboxFilter } from "@/components";
import { m } from "@/i18n";
import type { ForcibleMapSkin } from "@/lib/tauri";

import { mapLabel } from "../builtinMods";
import { MapTags } from "./MapTags";

interface ForcedMapSkinPickerProps {
  skins: ForcibleMapSkin[];
  /** The chosen skin's `name`, empty for none. A name the install lacks still shows. */
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

/**
 * A searchable list of the map skins the install can show, each tagged with the maps holding it.
 *
 * A skin's `name` is an ID the game matches byte for byte, so it is drawn in mono and never
 * reworded. The search matches the name and the map names.
 */
export function ForcedMapSkinPicker({
  skins,
  value,
  onChange,
  disabled,
}: ForcedMapSkinPickerProps) {
  const filter = useComboboxFilter();
  const selected = skins.find((skin) => skin.name === value) ?? unlisted(value);

  return (
    <Combobox.Root<ForcibleMapSkin>
      items={skins}
      value={selected}
      onValueChange={(skin) => skin && onChange(skin.name)}
      disabled={disabled}
      itemToStringLabel={(skin) => skin.name}
      itemToStringValue={(skin) => skin.name}
      isItemEqualToValue={(skin, chosen) => skin.name === chosen.name}
      filter={(skin, query) =>
        filter.contains(skin, query, (item) => [item.name, ...item.maps.map(mapLabel)].join(" "))
      }
    >
      <div className="relative w-64" data-ui="ForcedMapSkinPicker">
        <Combobox.Input
          aria-label={m.settings_builtins_forced_map_skin_title()}
          placeholder={m.settings_builtins_forced_map_skin_placeholder()}
          className="pr-8 font-mono text-mono-row"
        />
        <Combobox.Trigger className="absolute top-0 right-0 flex h-full items-center pr-3">
          <Combobox.Icon />
        </Combobox.Trigger>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner className="min-w-(--anchor-width)">
          <Combobox.Popup className="max-h-72">
            <Combobox.List>
              {(skin: ForcibleMapSkin) => (
                <Combobox.Item key={skin.name} value={skin} className="gap-2 pr-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-mono-row">
                    {skin.name}
                  </span>
                  <MapTags maps={skin.maps} />
                </Combobox.Item>
              )}
            </Combobox.List>
            <Combobox.Empty>{m.settings_builtins_forced_map_skin_empty()}</Combobox.Empty>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** A remembered choice the install no longer lists, or none when nothing is chosen. */
function unlisted(name: string): ForcibleMapSkin | null {
  if (name === "") {
    return null;
  }

  return { name, maps: [] };
}
