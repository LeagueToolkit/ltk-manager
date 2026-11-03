import { KeyboardIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, ButtonGroup, IconButton, SectionCard, useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, isErr } from "@/lib/tauri";
import { chordLabel, chordOfAccelerator, commandTakenBy } from "@/modules/keys";

import { useLoadedSettings, useUpdateSettings } from "../api";
import type { IndexedSettingKey } from "../settingsIndex";
import { SettingRow } from "./SettingRow";
import { SettingRows } from "./SettingRows";
import { SettingSwitch } from "./SettingSwitch";

export function HotkeySection() {
  const settings = useLoadedSettings();
  const update = useUpdateSettings();
  return (
    <SectionCard
      title="Hotkeys"
      icon={<KeyboardIcon className="size-5" />}
      description="System-wide keyboard shortcuts that work even when the app is not focused. Useful for quickly reloading mods while testing in-game."
    >
      <SettingRows>
        <HotkeyRow
          setting="reloadModsHotkey"
          description="Stop patcher, kill League, rebuild overlay, and restart the patcher with fresh mod files."
          value={settings.reloadModsHotkey ?? null}
          onSet={async (accelerator) => {
            const result = await api.setHotkey("reloadMods", accelerator);
            if (isErr(result)) throw new Error(errorSummary(result.error));
            update({ reloadModsHotkey: accelerator });
          }}
        />

        <HotkeyRow
          setting="killLeagueHotkey"
          description="Force-close the League of Legends process."
          value={settings.killLeagueHotkey ?? null}
          onSet={async (accelerator) => {
            const result = await api.setHotkey("killLeague", accelerator);
            if (isErr(result)) throw new Error(errorSummary(result.error));
            update({ killLeagueHotkey: accelerator });
          }}
        />

        <SettingRow
          setting="killLeagueStopsPatcher"
          description="When the Kill League hotkey is pressed, also stop the patcher."
          control={<SettingSwitch setting="killLeagueStopsPatcher" />}
        />
      </SettingRows>
    </SectionCard>
  );
}

interface HotkeyRowProps {
  setting: IndexedSettingKey;
  description: string;
  value: string | null;
  onSet: (accelerator: string | null) => Promise<void>;
}

function HotkeyRow({ setting, description, value, onSet }: HotkeyRowProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const toast = useToast();

  async function startCapture() {
    await api.pauseHotkeys();
    setIsCapturing(true);
  }

  async function stopCapture() {
    setIsCapturing(false);
    await api.resumeHotkeys();
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (!isCapturing) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      await stopCapture();
      return;
    }

    const keys: string[] = [];
    if (e.ctrlKey) keys.push("Ctrl");
    if (e.altKey) keys.push("Alt");
    if (e.shiftKey) keys.push("Shift");
    if (e.metaKey) keys.push("Super");

    const mainKey = e.key;
    // Ignore standalone modifier keys
    if (["Control", "Alt", "Shift", "Meta"].includes(mainKey)) return;

    // Require at least one modifier
    if (keys.length === 0) {
      toast.warning("Hotkey must include a modifier", "Use Ctrl, Alt, Shift, or Super with a key.");
      return;
    }

    const keyName = mainKey.length === 1 ? mainKey.toUpperCase() : mainKey;
    keys.push(keyName);

    const accelerator = keys.join("+");

    /* An OS-global hotkey takes its chord from the whole system, which would shadow an in-app
       command while the app has focus. */
    const taken = commandTakenBy(accelerator);
    if (taken !== null) {
      toast.warning(
        m.keys_hotkey_taken_title(),
        m.keys_hotkey_taken_description({
          chord: chordLabel(chordOfAccelerator(accelerator) ?? accelerator),
          command: taken.title(),
        }),
      );
      return;
    }

    setIsCapturing(false);
    setIsPending(true);

    try {
      await onSet(accelerator);
      toast.success("Hotkey set", `Hotkey set to ${accelerator}`);
    } catch (err) {
      toast.error("Failed to set hotkey", err instanceof Error ? err.message : String(err));
    } finally {
      await api.resumeHotkeys();
      setIsPending(false);
    }
  }

  async function handleClear() {
    setIsPending(true);
    try {
      await onSet(null);
      toast.success("Hotkey cleared");
    } catch (err) {
      toast.error("Failed to clear hotkey", err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <SettingRow
      kind="action"
      setting={setting}
      description={description}
      control={
        <ButtonGroup className="shrink-0">
          {isCapturing ? (
            <div
              className="flex h-8 min-w-[140px] animate-pulse items-center justify-center rounded-md border-2 border-accent-500 bg-accent-500/10 px-3 text-sm font-medium text-accent-300 outline-none"
              tabIndex={0}
              ref={(el: HTMLDivElement | null) => el?.focus()}
              onKeyDown={handleKeyDown}
              onBlur={() => stopCapture()}
            >
              Press a key combo...
            </div>
          ) : (
            <Button
              variant="outline"
              left={<KeyboardIcon className="size-3.5" />}
              onClick={() => startCapture()}
              loading={isPending}
            >
              {value ?? "Not set"}
            </Button>
          )}

          {value && !isCapturing && (
            <IconButton
              variant="outline"
              size="md"
              icon={<XIcon />}
              onClick={handleClear}
              loading={isPending}
            />
          )}
        </ButtonGroup>
      }
    />
  );
}
