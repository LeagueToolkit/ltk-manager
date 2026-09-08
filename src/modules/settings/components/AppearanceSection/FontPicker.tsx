import { useEffect } from "react";

import { Select } from "@/components";
import {
  loadMonoFaces,
  loadSansFaces,
  MONO_OPTIONS,
  type MonoFont,
  monoStack,
  SANS_OPTIONS,
  type SansFont,
  sansStack,
} from "@/lib/fonts";
import { useMonoFont, useSansFont, useSetMonoFont, useSetSansFont } from "@/stores";

export function InterfaceFontPicker() {
  const sansFont = useSansFont();
  const setSansFont = useSetSansFont();

  /* Rows are drawn in the face they name, so this is the one screen that wants
     every face rather than the chosen one. */
  useEffect(() => {
    void loadSansFaces();
  }, []);

  return (
    <Select.Root
      value={sansFont}
      onValueChange={(value) => value && setSansFont(value as SansFont)}
    >
      <Select.Trigger className="w-52">
        <Select.Value>
          {(current) => SANS_OPTIONS.find((option) => option.value === current)?.label ?? ""}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            {SANS_OPTIONS.map(({ value, label }) => (
              /* The one place a family is named rather than a utility written:
                 each row is drawn in the face it names. */
              <Select.Item key={value} value={value} style={{ fontFamily: sansStack(value) }}>
                {label}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function CodeFontPicker() {
  const monoFont = useMonoFont();
  const setMonoFont = useSetMonoFont();

  useEffect(() => {
    void loadMonoFaces();
  }, []);

  return (
    <Select.Root
      value={monoFont}
      onValueChange={(value) => value && setMonoFont(value as MonoFont)}
    >
      <Select.Trigger className="w-52">
        <Select.Value>
          {(current) => MONO_OPTIONS.find((option) => option.value === current)?.label ?? ""}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            {MONO_OPTIONS.map(({ value, label }) => (
              <Select.Item key={value} value={value} style={{ fontFamily: monoStack(value) }}>
                {label}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
