import { CaretDownIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { HoverCard, LeagueIcon, Menu } from "@/components";
import { m, readOnlyDescription } from "@/i18n";
import {
  api,
  type AssetRef,
  type BinDocumentHandle,
  type DeclaredState,
  type ObjectDeclaration,
  type SandboxRef,
} from "@/lib/tauri";

import {
  type ContentDocumentOf,
  inSandbox,
  layerTitle,
  objectDocument,
  previewDocument,
} from "../../../documents/utils/contentDocument";
import { LayerGlyph } from "../../../layers/components/LayerGlyph";
import { assetKey } from "../../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { sandboxKeys } from "../../../sandbox/api/keys";
import { useRouteSandbox } from "../../../sandbox/state/SandboxContext";
import {
  GAME_SANDBOX,
  inBuildOrder,
  sameSandbox,
  withLayerChosen,
} from "../../../sandbox/utils/sandboxRef";
import {
  useEditorDocument,
  useReplaceDocument,
  useSelectedLayerName,
  useSelectedModule,
} from "../../../state";
import { entryChunkPath } from "../../links/hooks/useLinkTargets";
import { useDeclareInto, useDeclaredState } from "../hooks/useDeclared";
import type { ProjectSwitch } from "../state/projectSwitch";
import { choiceLabel } from "../utils/declaredModule";
import { ChoiceSubmenu, DeclaredChoices } from "./DeclaredChoices";
import { SandboxFiles, useDeclaringFiles } from "./SandboxFiles";
import { SandboxRadioItem } from "./SandboxRadioItem";

/** An asset tab, the kind of tab that can switch sandboxes. */
type AssetTab = ContentDocumentOf<"preview"> | ContentDocumentOf<"object">;

interface SandboxOptionsProps {
  /** The editor's id for the tab, which a switch replaces. */
  documentId: string;
  handle: BinDocumentHandle;
}

/* The crumb segment's box, so the options line up with the crumb after them. DS-VEIL */
const TRIGGER =
  "flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-surface-400 transition-colors hover:bg-surface-veil hover:text-surface-100 data-[popup-open]:bg-surface-veil";

const PROJECT = "project";
const GAME = "game";

/** Where the next edit of a tab lands: a layer, and the module its new keys join. */
interface WriteTarget {
  readonly layer: string;
  /** The layer as the project titles it. */
  readonly title: string;
  /** The chosen module, null where the choice is Automatic or the tab saves a layer file. */
  readonly module: string | null;
}

/**
 * The `Sandbox (<name>)` button that leads a bin tab's header, and its options. ADR-0056.
 *
 * - The button names the sandbox, then the layer and module the next edit lands in.
 * - Read from: the project and the game. Picking one switches the tab in place, an object tab
 *   to the file that sandbox resolves its object to. The game is disabled for a file or an
 *   object the install has no copy of.
 * - Layers: which layers of the project the tab stacks, which the viewport draws.
 * - For an object several files declare, the files, which switch the tab in place.
 * - For a declared document, the layer edits write to and the module their new keys join,
 *   disabled with the reason above them while the document takes no edit.
 *
 * "The sandbox" in docs/ux/BIN_EDITOR.md.
 */
export function SandboxOptions({ documentId, handle }: SandboxOptionsProps) {
  /* The sandbox the document is held in, which is the game's for a loose file. */
  const { sandbox } = handle;
  const project = useOptionalProjectContext();
  const declared = useDeclaredState(handle.document);
  const name = sandboxName(sandbox, project);
  const target = writeTarget(handle, declared, project);

  return (
    <span className="flex shrink-0 items-center">
      {declared !== null && <DeclareIntoChoice document={handle.document} declared={declared} />}
      <Menu.Root>
        <HoverCard
          label={m.workshop_bin_sandbox_label()}
          className="w-72"
          content={<SandboxCard handle={handle} declared={declared} />}
        >
          <Menu.Trigger className={TRIGGER} aria-label={triggerLabel(name, target)}>
            <LeadGlyph handle={handle} />
            <span className="min-w-0 truncate">
              {m.workshop_bin_sandbox_current_label({ name })}
            </span>
            {target !== null && <TargetSegment target={target} />}
            <CaretDownIcon weight="bold" className="size-3 shrink-0" />
          </Menu.Trigger>
        </HoverCard>
        <Menu.Content
          align="start"
          sideOffset={4}
          data-ui="SandboxOptions"
          className="max-h-[28rem] w-72 overflow-y-auto scrollbar-md"
        >
          <SandboxChoice documentId={documentId} handle={handle} />
          {declared !== null && <DeclaredChoices handle={handle} declared={declared} />}
        </Menu.Content>
      </Menu.Root>
    </span>
  );
}

/** The name the button shows: the game, the project, or the project and its chosen layers. */
function sandboxName(
  sandbox: SandboxRef,
  project: ReturnType<typeof useOptionalProjectContext>,
): string {
  if (sandbox.kind === "game" || project === null) return m.workshop_bin_sandbox_game_label();
  if (sandbox.kind === "project") return project.displayName;

  return m.workshop_bin_sandbox_layers_name_label({
    name: project.displayName,
    shown: sandbox.layers.length,
    total: project.layers.length,
  });
}

/** Where the next edit of the tab lands, or null for a tab that takes no edit. */
function writeTarget(
  handle: BinDocumentHandle,
  declared: DeclaredState | null,
  project: ReturnType<typeof useOptionalProjectContext>,
): WriteTarget | null {
  if (handle.readOnly !== null) return null;

  const title = (layer: string) => (project === null ? layer : layerTitle(project, layer));
  if (declared !== null) {
    const module =
      declared.module.kind === "auto" ? null : choiceLabel(declared.module, declared.modules);
    return { layer: declared.layer, title: title(declared.layer), module };
  }
  if (handle.asset.kind === "layer") {
    return { layer: handle.asset.layer, title: title(handle.asset.layer), module: null };
  }
  return null;
}

/** The button's accessible name, which carries the write target its segment draws. */
function triggerLabel(name: string, target: WriteTarget | null): string {
  if (target === null) return m.workshop_bin_sandbox_current_label({ name });

  const where =
    target.module === null
      ? target.title
      : m.workshop_bin_sandbox_target_label({ layer: target.title, module: target.module });
  return m.workshop_bin_sandbox_trigger_label({ name, target: where });
}

/** The write target on the button: the layer's glyph and title, and the chosen module. */
function TargetSegment({ target }: { target: WriteTarget }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 border-l border-surface-600 pl-2">
      {/* DS-KIND-HUE */}
      <LayerGlyph layerName={target.layer} />
      <span className="min-w-0 truncate">{target.title}</span>
      {target.module !== null && (
        <>
          <span aria-hidden className="text-surface-500">
            ·
          </span>
          <span className="min-w-0 truncate">{target.module}</span>
        </>
      )}
    </span>
  );
}

/** Sends the project's selected layer and module to the backend while the tab is open. */
function DeclareIntoChoice({
  document,
  declared,
}: {
  document: BinDocumentHandle["document"];
  declared: DeclaredState;
}) {
  useDeclareInto(document, declared, useSelectedLayerName(), useSelectedModule());
  return null;
}

/** A lock when the tab takes no edit, else the League icon in the game sandbox. */
function LeadGlyph({ handle }: { handle: BinDocumentHandle }) {
  if (handle.readOnly !== null) return <LockSimpleIcon className="size-3.5 shrink-0" />;
  if (handle.sandbox.kind === "game") return <LeagueIcon className="size-3.5 shrink-0" />;
  return null;
}

/** The hover card text: what a sandbox is, and where this tab's edits go. */
function SandboxCard({
  handle,
  declared,
}: {
  handle: BinDocumentHandle;
  declared: DeclaredState | null;
}) {
  const project = useOptionalProjectContext();
  const title = (layer: string) => (project === null ? layer : layerTitle(project, layer));

  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-medium text-surface-100">{m.workshop_bin_sandbox_label()}</span>
      <span>{m.workshop_bin_sandbox_description()}</span>
      {handle.readOnly !== null && <span>{readOnlyDescription(handle.readOnly)}</span>}
      {handle.readOnly === null && declared !== null && (
        <span>
          {m.workshop_bin_sandbox_declares_hint({
            layer: title(declared.layer),
            module: choiceLabel(declared.module, declared.modules),
          })}
        </span>
      )}
      {handle.readOnly === null && declared === null && handle.asset.kind === "layer" && (
        <span>{m.workshop_bin_sandbox_writes_hint({ layer: title(handle.asset.layer) })}</span>
      )}
    </span>
  );
}

/** The project and game options, which switch the tab in place. */
function SandboxChoice({ documentId, handle }: { documentId: string; handle: BinDocumentHandle }) {
  const { sandbox } = handle;
  const route = useRouteSandbox();
  const project = useOptionalProjectContext();
  const tab = useEditorDocument(documentId);
  const replace = useReplaceDocument();
  const asset = tab !== null && isAssetTab(tab) ? tab : null;
  const copy = useGameCopy(asset?.asset.kind === "gameChunk" ? asset.asset : handle.asset);
  const object = asset?.kind === "object" ? asset : null;
  const files = useDeclaringFiles(object?.objectHash ?? null, route);
  const inGame = sandbox.kind === "game";
  const gameless = copy.asset === null && files.inGame.length === 0;

  function switchTo(target: SandboxRef) {
    if (asset === null) return;

    /* The game keeps the tab on its own file where the install declares the object there. */
    const own = assetKey(asset.asset);
    const declared =
      target.kind === "game"
        ? (files.inGame.find((file) => assetKey(file.asset) === own) ?? files.inGame[0])
        : files.inRoute[0];
    const next = switched(asset, target, route, copy, declared);
    if (next !== null) replace(documentId, next);
  }

  return (
    <>
      <Menu.Group>
        <Menu.GroupLabel>{m.workshop_bin_sandbox_read_label()}</Menu.GroupLabel>
        <Menu.RadioGroup
          value={inGame ? GAME : PROJECT}
          onValueChange={(value: string) => switchTo(value === GAME ? GAME_SANDBOX : route)}
        >
          {project !== null && (
            <SandboxRadioItem value={PROJECT} disabled={asset === null}>
              {project.displayName}
            </SandboxRadioItem>
          )}
          <SandboxRadioItem
            value={GAME}
            disabled={asset === null || gameless}
            note={gameless ? m.workshop_bin_sandbox_game_missing_hint() : undefined}
          >
            {m.workshop_bin_sandbox_game_label()}
          </SandboxRadioItem>
        </Menu.RadioGroup>
      </Menu.Group>
      {asset !== null && !inGame && <SandboxLayers documentId={documentId} tab={asset} />}
      {object !== null && (
        <SandboxFiles
          files={inGame ? files.inGame : files.inRoute}
          current={handle.asset}
          unindexed={files.unindexed}
          onPick={(file) => replace(documentId, declaredTab(object, file, object.sandbox))}
        />
      )}
    </>
  );
}

/**
 * The project's layers as switches that choose what the tab stacks over the game. The layer of
 * the tab's file and the last chosen layer are disabled. Left out for a project of one layer.
 */
function SandboxLayers({ documentId, tab }: { documentId: string; tab: AssetTab }) {
  const route = useRouteSandbox();
  const project = useOptionalProjectContext();
  const replace = useReplaceDocument();
  const layers = useMemo(() => inBuildOrder(project?.layers ?? []), [project]);

  if (project === null || layers.length < 2) return null;

  const all = layers.map((layer) => layer.name);
  const sandbox = tab.sandbox ?? route;
  const chosen = sandbox.kind === "layers" ? sandbox.layers : all;
  const ownLayer = tab.asset.kind === "layer" ? tab.asset.layer : null;

  return (
    <ChoiceSubmenu
      label={m.workshop_bin_sandbox_layers_label()}
      value={m.workshop_bin_sandbox_marks_count_label({ shown: chosen.length, total: all.length })}
    >
      {layers.map((layer) => {
        const on = chosen.includes(layer.name);

        return (
          <Menu.CheckboxItem
            key={layer.name}
            checked={on}
            disabled={layer.name === ownLayer || (on && chosen.length === 1)}
            onCheckedChange={(checked) => {
              const next = withLayerChosen(sandbox, project.path, all, layer.name, checked);
              replace(documentId, inSandbox(tab, next, route));
            }}
          >
            {layerTitle(project, layer.name)}
          </Menu.CheckboxItem>
        );
      })}
    </ChoiceSubmenu>
  );
}

/**
 * Moving the tab `documentId` from the game sandbox into the open project, the switch the
 * sandbox options make. Null where no project is open or the tab is not in the game sandbox.
 */
export function useProjectSwitch(
  documentId: string,
  handle: BinDocumentHandle,
): ProjectSwitch | null {
  const route = useRouteSandbox();
  const project = useOptionalProjectContext();
  const tab = useEditorDocument(documentId);
  const replace = useReplaceDocument();
  const asset = tab !== null && isAssetTab(tab) ? tab : null;
  const copy = useGameCopy(asset?.asset.kind === "gameChunk" ? asset.asset : handle.asset);
  const name = project?.displayName ?? null;
  const inGame = handle.sandbox.kind === "game";
  const objectHash = asset?.kind === "object" && inGame ? asset.objectHash : null;
  const declared = useDeclaringFiles(objectHash, route).inRoute[0];

  return useMemo(() => {
    if (name === null || asset === null || !inGame || route.kind === "game") return null;

    return {
      project: name,
      open: () => {
        const next = switched(asset, route, route, copy, declared);
        if (next !== null) replace(documentId, next);
      },
    };
  }, [name, asset, inGame, route, copy, declared, replace, documentId]);
}

function isAssetTab(document: { kind: string }): document is AssetTab {
  return document.kind === "preview" || document.kind === "object";
}

/** The install's copy of the file a tab reads. */
interface GameCopy {
  readonly asset: AssetRef | null;
  /** The copy's chunk path, the title of a tab switched to it. Null for a game chunk. */
  readonly path: string | null;
}

/** The install's file at the chunk path `path`, or null when the install has none. */
const gameCopyQuery = (path: string | null) =>
  queryOptions({
    queryKey: sandboxKeys.gameCopy(path),
    queryFn:
      path === null
        ? skipToken
        : async () => {
            const answer = await api.objects.locateGameFiles([path]);
            if (!answer.ok) throw answer.error;
            return answer.value[path] ?? null;
          },
    staleTime: Infinity,
    retry: false,
  });

/**
 * The install's copy of `asset`. A game chunk is its own copy. For a layer file, it is the
 * install's chunk at the file's path inside the archive directory, if the install has one.
 */
function useGameCopy(asset: AssetRef): GameCopy {
  const path = asset.kind === "layer" ? (entryChunkPath(asset.path)?.toLowerCase() ?? null) : null;
  const located = useQuery(gameCopyQuery(path)).data;

  if (asset.kind === "gameChunk") return { asset, path: null };
  if (located == null) return { asset: null, path };

  return {
    asset: { kind: "gameChunk", wad: located.wad, pathHash: located.pathHash },
    path,
  };
}

/** The object tab of `tab`'s object as `file` declares it, held in `sandbox`. */
function declaredTab(
  tab: ContentDocumentOf<"object">,
  file: ObjectDeclaration,
  sandbox: SandboxRef | undefined,
): AssetTab {
  return objectDocument(file.asset, tab.objectHash, tab.objectPath, file.file, file.class, sandbox);
}

/**
 * The tab `tab` becomes in `target`, or null when it cannot switch.
 *
 * An object tab becomes `declared`, the file `target` resolves its object to, which may sit
 * at another path than the file the tab reads. Without one, and for a file tab, a game chunk
 * keeps its asset, and a layer file switched to the game becomes the install's copy of its
 * path.
 */
function switched(
  tab: AssetTab,
  target: SandboxRef,
  route: SandboxRef,
  copy: GameCopy,
  declared?: ObjectDeclaration,
): AssetTab | null {
  if (tab.kind === "object" && declared !== undefined) {
    return declaredTab(tab, declared, sameSandbox(target, route) ? undefined : target);
  }

  if (target.kind !== "game" || tab.asset.kind === "gameChunk") {
    return inSandbox(tab, target, route);
  }
  if (copy.asset === null) return null;

  if (tab.kind === "object") {
    return objectDocument(
      copy.asset,
      tab.objectHash,
      tab.objectPath,
      copy.path ?? tab.file,
      tab.objectClass ?? null,
      target,
    );
  }
  return previewDocument(copy.asset, copy.path ?? undefined, target);
}
