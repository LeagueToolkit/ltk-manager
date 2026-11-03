import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";

import { Disclosure, Select } from "@/components";
import { m } from "@/i18n";
import type { CharacterInking } from "@/lib/tauri";
import { championQueries } from "@/modules/champions";

import { useInkingOutline, useInkingPreview, useLoadedSettings } from "../api";

/* The viewer pulls in the whole workshop module, so the settings page loads it only once the
   preview opens. */
const InkingPreviewViewer = lazy(() =>
  import("@/modules/workshop").then((module) => ({ default: module.InkingPreviewViewer })),
);

interface CharacterInkingPreviewProps {
  inking: CharacterInking;
}

/**
 * A folded preview of one champion's base skin with the outline the settings write.
 *
 * The backend writes the declarations the overlay build writes for that champion into a preview
 * project once, and the shipped skin viewer reads it, so the outline is the skin editor's: its
 * categories, its masks and its translated shaders. The outline values come from the backend's
 * `inking_outline` on every change and are patched into the drawn outline, so a slider moves
 * the outline without a reload. Nothing loads while the preview is closed.
 */
export function CharacterInkingPreview({ inking }: CharacterInkingPreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <Disclosure.Root open={open} onOpenChange={setOpen} className="ml-4 flex flex-col gap-3">
      <Disclosure.Trigger className="flex items-center gap-1.5 text-sm font-medium text-surface-300">
        <Disclosure.Caret />
        {m.settings_builtins_inking_preview_title()}
      </Disclosure.Trigger>
      <Disclosure.Panel>{open && <PreviewBody inking={inking} />}</Disclosure.Panel>
    </Disclosure.Root>
  );
}

function PreviewBody({ inking }: CharacterInkingPreviewProps) {
  const leaguePath = useLoadedSettings().leaguePath;
  const { data } = useQuery(championQueries.roster(leaguePath));
  const champions = data ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  if (!leaguePath) return <Notice text={m.settings_builtins_inking_preview_no_path()} />;

  const champion =
    picked ??
    champions.find((entry) => inking.chosenChampions.includes(entry.id.toLowerCase()))?.id ??
    champions[0]?.id;
  if (champion === undefined) return <Notice text={m.settings_builtins_inking_preview_empty()} />;

  const items = champions.map((entry) => ({ value: entry.id, label: entry.name ?? entry.id }));

  return (
    <div className="flex flex-col gap-2" data-ui="CharacterInkingPreview">
      <Select.Root
        items={items}
        value={champion}
        onValueChange={(next) => {
          if (next !== null) setPicked(next);
        }}
      >
        <Select.Trigger
          aria-label={m.settings_builtins_inking_preview_champion_label()}
          size="sm"
          className="w-48"
        >
          <Select.Value />
          <Select.Icon />
        </Select.Trigger>
        <Select.Content>
          {items.map((item) => (
            <Select.Item key={item.value} value={item.value}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <div className="flex aspect-4/3 w-full overflow-hidden rounded-lg border border-surface-700">
        <PreviewStage inking={inking} champion={champion} />
      </div>
    </div>
  );
}

function PreviewStage({ inking, champion }: CharacterInkingPreviewProps & { champion: string }) {
  const preview = useInkingPreview(champion);
  const outline = useInkingOutline(inking, "ally").data;

  if (preview.error !== null) {
    return <Notice text={m.settings_builtins_inking_preview_failed()} />;
  }
  if (preview.data === undefined) {
    return <Notice text={m.settings_builtins_inking_preview_loading()} />;
  }

  return (
    <Suspense fallback={<Notice text={m.settings_builtins_inking_preview_loading()} />}>
      <InkingPreviewViewer preview={preview.data} outline={outline} />
    </Suspense>
  );
}
function Notice({ text }: { text: string }) {
  return <span className="m-auto text-sm text-surface-400">{text}</span>;
}
