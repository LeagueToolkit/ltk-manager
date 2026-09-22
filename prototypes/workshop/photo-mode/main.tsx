import "./prototype.css";

import {
  ArrowCounterClockwiseIcon,
  CameraIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  MapPinIcon,
  MountainsIcon,
  PauseIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import skinhack from "@/assets/game/skinhack.png";

/** Three photo-mode layouts on one standalone route, switchable through `?variant=`. */
type VariantKey = "a" | "b" | "c";
type Availability = "ready" | "no-game" | "missing-map";
type Theme = "dark" | "light";

interface Marker {
  readonly x: number;
  readonly y: number;
}

interface DisplayToggles {
  readonly armature: boolean;
  readonly jointNames: boolean;
  readonly ground: boolean;
  readonly emitterGizmo: boolean;
  readonly stats: boolean;
  readonly mapParticles: boolean;
  readonly mapStructures: boolean;
  readonly placementGizmo: boolean;
}

interface PrototypeState {
  readonly photo: boolean;
  readonly clean: boolean;
  readonly backdrop: BackdropId;
  readonly backdropEnabled: boolean;
  readonly marker: Marker;
  readonly availability: Availability;
  readonly notice: string | null;
  readonly flash: number;
  readonly display: DisplayToggles;
  readonly savedDisplay: DisplayToggles | null;
}

interface VariantProps {
  readonly state: PrototypeState;
  readonly setState: React.Dispatch<React.SetStateAction<PrototypeState>>;
}

const VARIANTS: readonly { key: VariantKey; name: string; short: string }[] = [
  { key: "a", name: "Canvas overlay", short: "Overlay" },
  { key: "b", name: "Photo dock", short: "Dock" },
  { key: "c", name: "Studio rail", short: "Rail" },
];

const BACKDROP_CHOICES = [
  { id: "map11/base_srx", folder: "map11", map: "Summoner's Rift", geometry: "base_srx" },
  { id: "map12/base", folder: "map12", map: "Howling Abyss", geometry: "base" },
] as const;
type BackdropId = (typeof BACKDROP_CHOICES)[number]["id"];

const DISPLAY_BEFORE_PHOTO: DisplayToggles = {
  armature: true,
  jointNames: true,
  ground: true,
  emitterGizmo: true,
  stats: true,
  mapParticles: true,
  mapStructures: true,
  placementGizmo: true,
};

const PHOTO_DISPLAY: DisplayToggles = {
  armature: false,
  jointNames: false,
  ground: false,
  emitterGizmo: false,
  stats: false,
  mapParticles: false,
  mapStructures: false,
  placementGizmo: false,
};

const OPENING_STATE: PrototypeState = {
  photo: false,
  clean: false,
  backdrop: BACKDROP_CHOICES[0].id,
  backdropEnabled: false,
  marker: { x: 57, y: 44 },
  availability: "ready",
  notice: null,
  flash: 0,
  display: DISPLAY_BEFORE_PHOTO,
  savedDisplay: null,
};

function backdropChoice(id: BackdropId) {
  return BACKDROP_CHOICES.find((choice) => choice.id === id) ?? BACKDROP_CHOICES[0];
}

function disabledReason(availability: Availability): string | null {
  if (availability === "no-game") {
    return "Set a game directory in Settings to use map backdrops.";
  }

  if (availability === "missing-map") {
    return "Summoner's Rift is missing from the selected install.";
  }

  return null;
}

function replaceVariant(next: VariantKey): void {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next);
  window.history.replaceState(null, "", url);
}

function variantFromUrl(): VariantKey {
  const requested = new URL(window.location.href).searchParams.get("variant");
  return requested === "b" || requested === "c" ? requested : "a";
}

function stateFromUrl(): PrototypeState {
  const url = new URL(window.location.href);
  const requested = url.searchParams.get("availability");
  const availability = requested === "no-game" || requested === "missing-map" ? requested : "ready";

  const photo = availability === "ready" && url.searchParams.get("photo") === "1";
  const backdropEnabled = photo && url.searchParams.get("backdrop") === "1";
  const placementGizmo = photo && url.searchParams.get("placement") === "1";

  return {
    ...OPENING_STATE,
    availability,
    photo,
    backdropEnabled,
    display: photo ? { ...PHOTO_DISPLAY, placementGizmo } : DISPLAY_BEFORE_PHOTO,
    savedDisplay: photo ? DISPLAY_BEFORE_PHOTO : null,
  };
}

function themeFromUrl(): Theme {
  return new URL(window.location.href).searchParams.get("theme") === "light" ? "light" : "dark";
}

function App() {
  const [variant, setVariant] = useState<VariantKey>(variantFromUrl);
  const [state, setState] = useState<PrototypeState>(stateFromUrl);
  const [theme, setTheme] = useState<Theme>(themeFromUrl);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const selectVariant = (next: VariantKey) => {
    replaceVariant(next);
    setVariant(next);
  };

  const cycle = (direction: -1 | 1) => {
    const at = VARIANTS.findIndex((candidate) => candidate.key === variant);
    const next = VARIANTS[(at + direction + VARIANTS.length) % VARIANTS.length].key;
    selectVariant(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") === true;
      if (editing) return;

      if (event.key === "Escape" && state.photo) {
        setState((current) => ({ ...current, photo: false, clean: false, notice: null }));
        return;
      }

      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const props = { state, setState };

  return (
    <main className="relative h-full min-h-[36rem] w-full min-w-[52rem] overflow-hidden bg-surface-950 text-surface-100 select-none">
      {variant === "a" && <VariantA {...props} />}
      {variant === "b" && <VariantB {...props} />}
      {variant === "c" && <VariantC {...props} />}
      {import.meta.env.DEV && (
        <PrototypeSwitcher
          variant={variant}
          state={state}
          theme={theme}
          onPrevious={() => cycle(-1)}
          onNext={() => cycle(1)}
          onVariant={selectVariant}
          onAvailability={(availability) =>
            setState((current) => ({
              ...current,
              availability,
              photo: availability === "ready" ? current.photo : false,
              clean: false,
              notice: null,
              display:
                availability === "ready"
                  ? current.display
                  : (current.savedDisplay ?? current.display),
              savedDisplay: availability === "ready" ? current.savedDisplay : null,
            }))
          }
          onTheme={(next) => {
            const url = new URL(window.location.href);
            url.searchParams.set("theme", next);
            window.history.replaceState(null, "", url);
            setTheme(next);
          }}
        />
      )}
    </main>
  );
}

function PrototypeSwitcher({
  variant,
  state,
  theme,
  onPrevious,
  onNext,
  onVariant,
  onAvailability,
  onTheme,
}: {
  readonly variant: VariantKey;
  readonly state: PrototypeState;
  readonly theme: Theme;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onVariant: (variant: VariantKey) => void;
  readonly onAvailability: (availability: Availability) => void;
  readonly onTheme: (theme: Theme) => void;
}) {
  const chosen = VARIANTS.find((candidate) => candidate.key === variant) ?? VARIANTS[0];

  return (
    <aside className="fixed right-4 bottom-4 left-4 z-50 mx-auto flex max-w-7xl items-center gap-2 rounded-xl border border-surface-600 bg-(--ltk-glass-panel-fill) p-2 shadow-2xl backdrop-filter-(--ltk-glass-panel-blur)">
      <span className="rounded-md bg-warning/15 px-2 py-1 text-fine font-bold tracking-wider text-warning-text uppercase">
        Prototype
      </span>
      <ToolButton label="Previous variant" onClick={onPrevious}>
        <CaretLeftIcon weight="bold" className="h-4 w-4" />
      </ToolButton>
      <div className="min-w-36 text-center text-meta">
        <span className="font-semibold text-surface-100">{variant.toUpperCase()}</span>
        <span className="text-surface-400"> · {chosen.name}</span>
      </div>
      <ToolButton label="Next variant" onClick={onNext}>
        <CaretRightIcon weight="bold" className="h-4 w-4" />
      </ToolButton>
      <div className="flex items-center gap-1 border-l border-surface-600 pl-2">
        {VARIANTS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            className={
              candidate.key === variant
                ? "rounded-md bg-accent-500 px-2.5 py-1.5 text-meta font-semibold text-brand-on"
                : "rounded-md px-2.5 py-1.5 text-meta text-surface-300 hover:bg-surface-veil"
            }
            onClick={() => onVariant(candidate.key)}
          >
            {candidate.short}
          </button>
        ))}
      </div>
      <label className="ml-auto flex items-center gap-2 border-l border-surface-600 pl-3 text-meta text-surface-300">
        Simulate
        <select
          className="h-8 rounded-md border border-surface-600 bg-surface-700 px-2 text-surface-100 outline-none focus:border-accent-500"
          value={state.availability}
          onChange={(event) => onAvailability(event.target.value as Availability)}
        >
          <option value="ready">Ready</option>
          <option value="no-game">No game directory</option>
          <option value="missing-map">Map missing</option>
        </select>
      </label>
      <button
        type="button"
        className="h-8 rounded-md border border-surface-600 bg-surface-700 px-2 text-meta text-surface-200 hover:border-accent-hover"
        onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <output className="min-w-72 text-left font-mono text-fine text-code leading-3 text-surface-400">
        <span className="block">
          photo:{String(state.photo)} controls:{state.clean ? "hidden" : "shown"} map:
          {state.backdropEnabled ? backdropChoice(state.backdrop).geometry : "off"} marker:
          {state.marker.x}/{state.marker.y}
        </span>
        <span className="block">
          display:a{Number(state.display.armature)} j{Number(state.display.jointNames)} g
          {Number(state.display.ground)} e{Number(state.display.emitterGizmo)} s
          {Number(state.display.stats)} p{Number(state.display.mapParticles)} r
          {Number(state.display.mapStructures)} move{Number(state.display.placementGizmo)} · saved:
          {state.savedDisplay === null ? "no" : "yes"} · {state.availability} ·
          {state.notice ?? "none"} · flash:{state.flash}
        </span>
      </output>
    </aside>
  );
}

export function VariantA({ state, setState }: VariantProps) {
  const reason = disabledReason(state.availability);

  return (
    <WorkshopShell photo={state.photo} title="Ahri · Spirit Blossom">
      <Viewport state={state} variant="a">
        {!state.photo && (
          <>
            <StandardChrome />
            <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
              <ActionButton
                disabled={reason !== null}
                icon={<CameraIcon weight="bold" className="h-4 w-4" />}
                onClick={() => enterPhoto(setState)}
              >
                Photo mode
              </ActionButton>
              {reason !== null && <DisabledReason text={reason} />}
            </div>
          </>
        )}
        {state.photo && !state.clean && (
          <>
            <ModeBadge onExit={() => leavePhoto(setState)} label="Photo mode · Canvas overlay" />
            <div className="absolute bottom-24 left-4 flex items-center gap-2 rounded-xl border border-surface-600 bg-(--ltk-glass-panel-fill) p-2 shadow-xl backdrop-filter-(--ltk-glass-panel-blur)">
              <ActionButton
                icon={<CopyIcon weight="bold" className="h-4 w-4" />}
                onClick={() => capture(setState)}
              >
                Capture
              </ActionButton>
              <SecondaryButton onClick={() => saveAs(setState)}>
                <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
                Save as
              </SecondaryButton>
              <ToolButton
                label="Preview clean frame"
                onClick={() => setState((current) => ({ ...current, clean: true }))}
              >
                <EyeSlashIcon weight="bold" className="h-4 w-4" />
              </ToolButton>
            </div>
            <div className="absolute right-4 bottom-24 flex items-end gap-3">
              <PhotoBackdropPanel
                state={state}
                setState={setState}
                decision="Inset replaces the placement gizmo"
              />
              {state.backdropEnabled && (
                <MapInset
                  marker={state.marker}
                  className="relative h-52 w-52"
                  onMarker={(marker) => setState((current) => ({ ...current, marker }))}
                />
              )}
            </div>
          </>
        )}
        {state.photo && state.clean && (
          <CleanFrameHandle
            label="Photo mode · Show controls"
            onClick={() => setState((current) => ({ ...current, clean: false }))}
          />
        )}
      </Viewport>
      <NoticeToast notice={state.notice} />
    </WorkshopShell>
  );
}

export function VariantB({ state, setState }: VariantProps) {
  const reason = disabledReason(state.availability);

  return (
    <WorkshopShell photo={state.photo} title="Ahri · Spirit Blossom">
      <div className="flex min-h-0 flex-1 flex-col">
        <Viewport state={state} variant="b">
          {!state.photo && <StandardChrome hideTransport />}
          {state.photo && !state.clean && (
            <>
              <div className="absolute top-3 left-3 rounded-md border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-meta font-semibold text-accent-300">
                PHOTO
              </div>
              {state.backdropEnabled && (
                <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                  <span className="rounded-md bg-scrim px-2 py-1 text-fine text-surface-200 backdrop-filter-(--ltk-glass-scrim-blur)">
                    Inset stays beside the placement gizmo
                  </span>
                  <MapInset
                    marker={state.marker}
                    className="relative h-44 w-44"
                    onMarker={(marker) => setState((current) => ({ ...current, marker }))}
                  />
                </div>
              )}
            </>
          )}
          {state.photo && state.clean && (
            <CleanFrameHandle
              label="Photo mode · Show dock"
              onClick={() => setState((current) => ({ ...current, clean: false }))}
            />
          )}
        </Viewport>
        {!state.photo && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-t border-surface-700 bg-surface-950 px-3">
            <TransportControls />
            <div className="ml-auto flex items-center gap-2">
              {reason !== null && <span className="text-meta text-warning-text">{reason}</span>}
              <ActionButton
                disabled={reason !== null}
                icon={<CameraIcon weight="bold" className="h-4 w-4" />}
                onClick={() => enterPhoto(setState)}
              >
                Open photo dock
              </ActionButton>
            </div>
          </div>
        )}
        {state.photo && !state.clean && <PhotoDock state={state} setState={setState} />}
      </div>
      <NoticeToast notice={state.notice} />
    </WorkshopShell>
  );
}

export function VariantC({ state, setState }: VariantProps) {
  const [showMenu, setShowMenu] = useState(false);
  const reason = disabledReason(state.availability);

  return (
    <WorkshopShell photo={state.photo} title="Ahri · Spirit Blossom">
      <div className="relative flex min-h-0 flex-1">
        <Viewport state={state} variant="c">
          {!state.photo && (
            <>
              <div className="absolute top-3 left-3 flex items-start gap-2">
                <div className="relative">
                  <button
                    type="button"
                    className="flex h-8 items-center gap-2 rounded-md border border-surface-600 bg-(--ltk-glass-panel-fill) px-2.5 text-meta font-medium shadow-md backdrop-filter-(--ltk-glass-panel-blur) hover:border-accent-hover"
                    onClick={() => setShowMenu((open) => !open)}
                  >
                    <EyeIcon weight="bold" className="h-4 w-4" />
                    Show
                    <CaretDownIcon weight="bold" className="h-3 w-3 text-surface-400" />
                  </button>
                  {showMenu && (
                    <div className="absolute top-10 left-0 w-64 rounded-xl border border-surface-600 bg-surface-800 p-1.5 shadow-xl">
                      <MenuRow
                        icon={<SlidersHorizontalIcon className="h-4 w-4" />}
                        label="Scene aids"
                        tick
                      />
                      <div className="h-px bg-surface-600" />
                      <button
                        type="button"
                        disabled={reason !== null}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-meta hover:bg-surface-veil disabled:text-surface-500"
                        onClick={() => {
                          setShowMenu(false);
                          enterPhoto(setState);
                        }}
                      >
                        <CameraIcon weight="bold" className="h-4 w-4" />
                        Photo mode
                      </button>
                      {reason !== null && (
                        <p className="px-2 py-1 text-fine leading-4 text-warning-text">{reason}</p>
                      )}
                    </div>
                  )}
                </div>
                <ChromePill label="Wireframe" />
                <ChromePill label="Camera" />
                <ChromePill label="Rig" />
              </div>
              <TransportBar />
            </>
          )}
          {state.photo && state.clean && (
            <button
              type="button"
              className="absolute top-1/2 right-0 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-lg border border-r-0 border-accent-500/40 bg-(--ltk-glass-panel-fill) px-2 py-4 text-fine font-bold tracking-widest text-accent-300 uppercase shadow-xl backdrop-filter-(--ltk-glass-panel-blur)"
              onClick={() => setState((current) => ({ ...current, clean: false }))}
            >
              <CameraIcon weight="bold" className="h-4 w-4" />
              <span className="[writing-mode:vertical-rl]">Photo</span>
            </button>
          )}
        </Viewport>
        {state.photo && !state.clean && <PhotoRail state={state} setState={setState} />}
      </div>
      <NoticeToast notice={state.notice} />
    </WorkshopShell>
  );
}

function WorkshopShell({
  photo,
  title,
  children,
}: {
  readonly photo: boolean;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col pb-20">
      {!photo && (
        <>
          <header className="flex h-10 shrink-0 items-center gap-3 border-b border-surface-700 bg-surface-900 px-3">
            <span className="font-display text-sm font-semibold tracking-tight">
              League Toolkit
            </span>
            <span className="h-4 w-px bg-surface-600" />
            <span className="text-meta text-surface-400">Creator Workshop</span>
            <span className="ml-auto text-meta text-surface-400">project-lillia</span>
          </header>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-surface-700 bg-surface-950 px-3 text-meta">
            <span className="text-surface-500">content / base / data / characters / ahri</span>
            <span className="ml-auto rounded-sm bg-doc-details/15 px-2 py-0.5 text-doc-details-text">
              Skin
            </span>
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-surface-700 bg-surface-900 px-3 text-row">
            <span className="h-2 w-2 rounded-full bg-accent-500" />
            <span className="font-medium">{title}</span>
            <XIcon className="ml-auto h-3.5 w-3.5 text-surface-500" />
          </div>
        </>
      )}
      <div className="flex min-h-0 flex-1">{children}</div>
    </section>
  );
}

function Viewport({
  state,
  variant,
  children,
}: {
  readonly state: PrototypeState;
  readonly variant: VariantKey;
  readonly children: ReactNode;
}) {
  const offset = `${(state.marker.x - 50) * 0.09}rem`;

  return (
    <div
      data-variant={variant}
      className="scene-sky relative min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div className="scene-horizon absolute inset-x-0 bottom-[24%] h-[44%] opacity-80" />
      <div className="scene-floor absolute inset-x-0 bottom-0 h-[58%] opacity-65" />
      {state.backdropEnabled && (
        <>
          <div className="absolute inset-x-[8%] bottom-[7%] h-[24%] rounded-[50%] border border-accent-500/20 bg-accent-800/15 blur-sm" />
          {state.display.mapStructures && (
            <>
              <div className="absolute bottom-[25%] left-[18%] h-32 w-16 -skew-x-12 rounded-lg border border-surface-500 bg-surface-700/70" />
              <div className="absolute right-[16%] bottom-[22%] h-24 w-24 rotate-12 rounded-lg border border-surface-500 bg-surface-700/70" />
            </>
          )}
          {state.display.mapParticles && (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_42%,var(--color-accent-400)_0_1px,transparent_2px),radial-gradient(circle_at_78%_35%,var(--color-accent-300)_0_1px,transparent_2px)] bg-[length:7rem_6rem] opacity-50" />
          )}
        </>
      )}
      <div className="absolute top-1/2 left-1/2 h-52 w-52 -translate-x-1/2 -translate-y-[43%] rounded-full bg-accent-500/10 blur-3xl" />
      <img
        src={skinhack}
        alt="Fake character preview"
        draggable={false}
        className="absolute bottom-[12%] left-1/2 h-[64%] max-h-[36rem] -translate-x-1/2 object-contain drop-shadow-2xl transition-transform duration-300"
        style={{ marginLeft: offset }}
      />
      {state.display.placementGizmo && <PlacementGizmo offset={offset} />}
      {!state.photo && (
        <>
          <div className="absolute bottom-[12%] left-1/2 h-3 w-56 -translate-x-1/2 rounded-full bg-surface-950/70 blur-md" />
          <div className="absolute right-4 bottom-16 grid h-20 w-20 place-items-center rounded-full border border-surface-600/60 text-fine text-surface-400">
            <span className="absolute top-1 text-channel-1-text">Y</span>
            <span className="absolute right-1 text-channel-2-text">X</span>
            <span className="absolute bottom-1 text-channel-3-text">Z</span>
            <span className="h-1.5 w-1.5 rounded-full bg-surface-200" />
          </div>
        </>
      )}
      {state.flash > 0 && (
        <div key={state.flash} className="photo-flash absolute inset-0 z-40 bg-surface-50" />
      )}
      {children}
    </div>
  );
}

function StandardChrome({ hideTransport = false }: { readonly hideTransport?: boolean }) {
  return (
    <>
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <ChromePill label="Show" />
        <ChromePill label="Wireframe" />
        <ChromePill label="Camera" />
        <ChromePill label="Rig" />
      </div>
      {!hideTransport && <TransportBar />}
    </>
  );
}

function ChromePill({ label }: { readonly label: string }) {
  return (
    <button
      type="button"
      className="h-8 rounded-md border border-surface-600 bg-(--ltk-glass-panel-fill) px-2.5 text-meta font-medium text-surface-200 shadow-md backdrop-filter-(--ltk-glass-panel-blur) hover:border-accent-hover hover:bg-surface-700/90"
    >
      {label}
    </button>
  );
}

function TransportBar() {
  return (
    <div className="absolute right-0 bottom-0 left-0 flex h-11 items-center gap-4 border-t border-surface-700 bg-(--ltk-glass-chrome-fill) px-3 backdrop-filter-(--ltk-glass-chrome-blur)">
      <TransportControls />
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-700">
        <div className="h-full w-[38%] rounded-full bg-accent-500" />
      </div>
      <span className="font-mono text-meta text-code text-surface-400">01.42 / 03.80</span>
      <span className="rounded-md border border-surface-600 bg-surface-800 px-2 py-1 font-mono text-meta text-code">
        1.00×
      </span>
    </div>
  );
}

function TransportControls() {
  return (
    <div className="flex items-center gap-1">
      <ToolButton label="Restart" onClick={() => undefined}>
        <ArrowCounterClockwiseIcon weight="bold" className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Pause" onClick={() => undefined}>
        <PauseIcon weight="bold" className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Play" onClick={() => undefined}>
        <PlayIcon weight="bold" className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}

function PhotoDock({ state, setState }: VariantProps) {
  return (
    <div className="flex h-28 shrink-0 items-center gap-4 border-t border-accent-500/30 bg-surface-900 px-4 shadow-2xl">
      <div className="flex w-40 shrink-0 items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-500/15 text-accent-300">
          <CameraIcon weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <div className="text-row font-semibold">Photo mode</div>
          <div className="text-fine text-surface-400">Esc to leave</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <SceneToggle
            active={state.backdropEnabled}
            label="Map backdrop"
            onClick={() =>
              setState((current) => ({
                ...current,
                backdropEnabled: !current.backdropEnabled,
              }))
            }
          />
          <BackdropSelect state={state} setState={setState} />
          <SceneToggle
            active={state.display.mapParticles}
            disabled={!state.backdropEnabled}
            label="Particles"
            onClick={() => toggleDisplay(setState, "mapParticles")}
          />
          <SceneToggle
            active={state.display.mapStructures}
            disabled={!state.backdropEnabled}
            label="Structures and props"
            onClick={() => toggleDisplay(setState, "mapStructures")}
          />
          <SceneToggle
            active={state.display.placementGizmo}
            label="Placement gizmo"
            onClick={() => toggleDisplay(setState, "placementGizmo")}
          />
        </div>
        <div className="flex items-center gap-2 text-fine text-surface-400">
          <span className="rounded-sm bg-accent-500/15 px-1.5 py-0.5 text-accent-300">
            Inset + placement gizmo
          </span>
          <span>Armature, joints, ground, emitter gizmo and stats restore on exit.</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ActionButton
          icon={<CopyIcon weight="bold" className="h-4 w-4" />}
          onClick={() => capture(setState)}
        >
          Capture
        </ActionButton>
        <SecondaryButton onClick={() => saveAs(setState)}>
          <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
          Save as
        </SecondaryButton>
        <ToolButton
          label="Hide photo controls"
          onClick={() => setState((current) => ({ ...current, clean: true }))}
        >
          <EyeSlashIcon weight="bold" className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Leave photo mode" onClick={() => leavePhoto(setState)}>
          <XIcon weight="bold" className="h-4 w-4" />
        </ToolButton>
      </div>
    </div>
  );
}

function PhotoRail({ state, setState }: VariantProps) {
  return (
    <aside className="z-20 flex w-80 shrink-0 flex-col gap-4 border-l border-accent-500/25 bg-surface-800 p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-500/15 text-accent-300">
          <CameraIcon weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-sm font-semibold">Photo studio</h1>
          <p className="text-fine text-surface-400">Scene aids and editor chrome are hidden.</p>
        </div>
        <ToolButton
          label="Leave photo mode"
          className="ml-auto"
          onClick={() => leavePhoto(setState)}
        >
          <XIcon weight="bold" className="h-4 w-4" />
        </ToolButton>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-accent-500/30 bg-accent-500/10 p-3">
        <p className="text-row font-semibold text-accent-300">Placement gizmo only</p>
        <p className="text-fine leading-4 text-surface-300">
          This variant drops the map inset and places the subject directly in the viewport.
        </p>
      </div>
      <PhotoBackdropPanel
        state={state}
        setState={setState}
        decision="No inset · placement gizmo remains available"
        placement="only"
      />
      <div className="flex flex-1 flex-col justify-end gap-2">
        <ActionButton
          className="justify-center"
          icon={<CopyIcon weight="bold" className="h-4 w-4" />}
          onClick={() => capture(setState)}
        >
          Capture to clipboard
        </ActionButton>
        <SecondaryButton className="justify-center" onClick={() => saveAs(setState)}>
          <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
          Save as
        </SecondaryButton>
        <button
          type="button"
          className="flex items-center justify-center gap-2 rounded-md px-3 py-2 text-meta text-surface-300 hover:bg-surface-veil"
          onClick={() => setState((current) => ({ ...current, clean: true }))}
        >
          <EyeSlashIcon weight="bold" className="h-4 w-4" />
          Hide controls
        </button>
      </div>
    </aside>
  );
}

function PhotoBackdropPanel({
  state,
  setState,
  decision,
  placement = "replace",
}: VariantProps & {
  readonly decision: string;
  readonly placement?: "replace" | "only";
}) {
  return (
    <div className="flex w-64 flex-col gap-3 rounded-xl border border-surface-600 bg-surface-800 p-3 shadow-xl">
      <div className="flex items-center gap-2">
        <MountainsIcon weight="bold" className="h-4 w-4 text-accent-300" />
        <p className="text-row font-semibold">Map backdrop</p>
        <SceneToggle
          active={state.backdropEnabled}
          label={state.backdropEnabled ? "On" : "Off"}
          onClick={() =>
            setState((current) => ({
              ...current,
              backdropEnabled: !current.backdropEnabled,
            }))
          }
        />
      </div>
      <BackdropSelect state={state} setState={setState} />
      <div className="grid grid-cols-2 gap-2">
        <SceneToggle
          active={state.display.mapParticles}
          disabled={!state.backdropEnabled}
          label="Particles"
          onClick={() => toggleDisplay(setState, "mapParticles")}
        />
        <SceneToggle
          active={state.display.mapStructures}
          disabled={!state.backdropEnabled}
          label="Structures"
          onClick={() => toggleDisplay(setState, "mapStructures")}
        />
      </div>
      {placement === "only" && (
        <SceneToggle
          active={state.display.placementGizmo}
          label="Placement gizmo"
          onClick={() => toggleDisplay(setState, "placementGizmo")}
        />
      )}
      <p className="text-fine leading-4 text-surface-400">{decision}</p>
      <DisplayRestoreStatus state={state} />
    </div>
  );
}

function BackdropSelect({ state, setState }: VariantProps) {
  return (
    <label className="flex flex-col gap-1 text-fine font-medium tracking-wide text-surface-400 uppercase">
      Installed map geometry
      <select
        disabled={!state.backdropEnabled}
        value={state.backdrop}
        onChange={(event) =>
          setState((current) => ({
            ...current,
            backdrop: event.target.value as BackdropId,
            notice: null,
          }))
        }
        className="h-9 min-w-0 rounded-md border border-surface-600 bg-surface-700 px-2 text-row font-normal text-surface-100 normal-case outline-none focus:border-accent-500 disabled:text-surface-500"
      >
        <optgroup label="Summoner's Rift · map11">
          <option value="map11/base_srx">base_srx</option>
        </optgroup>
        <optgroup label="Howling Abyss · map12">
          <option value="map12/base">base</option>
        </optgroup>
      </select>
    </label>
  );
}

function SceneToggle({
  active,
  disabled = false,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      className={
        active
          ? "h-8 rounded-md border border-accent-500/50 bg-accent-500/15 px-2 text-meta font-medium text-accent-300 disabled:opacity-40"
          : "h-8 rounded-md border border-surface-600 bg-surface-700 px-2 text-meta text-surface-300 hover:border-accent-hover disabled:opacity-40"
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function DisplayRestoreStatus({ state }: { readonly state: PrototypeState }) {
  return (
    <div className="rounded-md bg-surface-950/40 px-2 py-1.5 text-fine leading-4 text-surface-400">
      <span className="font-medium text-surface-200">
        {state.savedDisplay === null ? "Display state restored:" : "Saved for exit:"}
      </span>{" "}
      armature, joint names, ground, emitter gizmo, stats, map details and placement gizmo
    </div>
  );
}

function PlacementGizmo({ offset }: { readonly offset: string }) {
  return (
    <div
      className="absolute bottom-[15%] left-1/2 z-10 h-32 w-32 -translate-x-1/2"
      style={{ marginLeft: offset }}
      aria-label="Placement gizmo"
    >
      <div className="absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-channel-2" />
      <div className="absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 bg-channel-1" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 border-x-5 border-b-8 border-x-transparent border-b-channel-2" />
      <div className="absolute top-1/2 right-0 -translate-y-1/2 border-y-5 border-l-8 border-y-transparent border-l-channel-1" />
      <div className="absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-on bg-accent-500 shadow-lg" />
    </div>
  );
}

function MapInset({
  marker,
  className,
  onMarker,
}: {
  readonly marker: Marker;
  readonly className: string;
  readonly onMarker: (marker: Marker) => void;
}) {
  const held = useRef<number | null>(null);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - bounds.left) / bounds.width) * 100);
    const y = Math.round(((event.clientY - bounds.top) / bounds.height) * 100);
    onMarker({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  };

  return (
    <div
      role="application"
      aria-label="Map position. Drag the marker to place the subject."
      tabIndex={0}
      className={`overflow-hidden rounded-xl border border-surface-500 bg-surface-950 shadow-2xl outline-none focus:ring-2 focus:ring-accent-500 ${className}`}
      onPointerDown={(event) => {
        held.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (held.current === event.pointerId) move(event);
      }}
      onPointerUp={(event) => {
        held.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        const delta = event.shiftKey ? 10 : 2;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === "ArrowLeft") onMarker({ ...marker, x: Math.max(0, marker.x - delta) });
        if (event.key === "ArrowRight") onMarker({ ...marker, x: Math.min(100, marker.x + delta) });
        if (event.key === "ArrowUp") onMarker({ ...marker, y: Math.max(0, marker.y - delta) });
        if (event.key === "ArrowDown") onMarker({ ...marker, y: Math.min(100, marker.y + delta) });
      }}
    >
      <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <rect className="map-water" width="240" height="240" />
        <path
          className="map-land"
          d="M21 18h78l20 16 28-9 72 15-4 67-19 25 20 31-5 58-69 3-25-14-31 18-68-18 8-62-9-27 18-26z"
        />
        <path className="map-river" d="M26 190c49-31 55-73 95-83 39-10 60-45 91-71" />
        <path
          className="map-lane"
          d="M40 199 199 40M39 43c33 60 91 93 163 158M45 198c57-31 98-19 154 3"
        />
        <circle cx="44" cy="198" r="10" fill="var(--ltk-blue)" opacity="0.65" />
        <circle cx="198" cy="42" r="10" fill="var(--ltk-violet)" opacity="0.65" />
      </svg>
      <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-scrim px-2 py-1 text-fine font-medium text-surface-200 backdrop-filter-(--ltk-glass-scrim-blur)">
        <MountainsIcon weight="bold" className="h-3.5 w-3.5" />
        Drag to place
      </div>
      <div
        className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-brand-on bg-accent-500 text-brand-on shadow-xl transition-[left,top] duration-75"
        style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
      >
        <MapPinIcon weight="fill" className="h-4 w-4" />
      </div>
    </div>
  );
}

function ModeBadge({ label, onExit }: { readonly label: string; readonly onExit: () => void }) {
  return (
    <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent-500/40 bg-(--ltk-glass-panel-fill) py-1 pr-1 pl-3 text-meta font-semibold text-accent-300 shadow-xl backdrop-filter-(--ltk-glass-panel-blur)">
      <CameraIcon weight="bold" className="h-4 w-4" />
      {label}
      <ToolButton label="Leave photo mode" onClick={onExit}>
        <XIcon weight="bold" className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  );
}

function CleanFrameHandle({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-600/70 bg-scrim px-3 py-1.5 text-meta text-surface-200 opacity-45 backdrop-filter-(--ltk-glass-scrim-blur) transition-opacity hover:opacity-100 focus:opacity-100"
      onClick={onClick}
    >
      <EyeIcon weight="bold" className="h-4 w-4" />
      {label}
    </button>
  );
}

function DisabledReason({ text }: { readonly text: string }) {
  return (
    <div className="flex max-w-72 items-center gap-2 rounded-lg border border-warning/25 bg-(--ltk-glass-panel-fill) px-3 py-2 text-meta text-warning-text shadow-xl backdrop-filter-(--ltk-glass-panel-blur)">
      <WarningCircleIcon weight="bold" className="h-4 w-4 shrink-0" />
      {text}
    </div>
  );
}

function NoticeToast({ notice }: { readonly notice: string | null }) {
  if (notice === null) return null;

  return (
    <div className="absolute top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-success/30 bg-surface-800 px-4 py-3 text-row font-medium text-surface-100 shadow-2xl">
      <CheckCircleIcon weight="fill" className="h-5 w-5 text-success-text" />
      {notice}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  tick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly tick?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-meta hover:bg-surface-veil"
    >
      {icon}
      {label}
      {tick && <CheckCircleIcon className="ml-auto h-4 w-4 text-accent-300" />}
    </button>
  );
}

function ToolButton({
  label,
  className = "",
  onClick,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-surface-300 hover:bg-surface-veil hover:text-surface-100 ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ActionButton({
  disabled = false,
  className = "",
  icon,
  onClick,
  children,
}: {
  readonly disabled?: boolean;
  readonly className?: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex h-9 items-center gap-2 rounded-md bg-accent-500 px-3 text-meta font-semibold text-brand-on shadow-md transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-surface-500 disabled:text-surface-300 ${className}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function SecondaryButton({
  className = "",
  onClick,
  children,
}: {
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex h-9 items-center gap-2 rounded-md border border-surface-veil-strong bg-surface-veil-soft px-3 text-meta font-semibold text-surface-200 hover:border-accent-hover hover:bg-surface-veil ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function enterPhoto(setState: VariantProps["setState"]): void {
  setState((current) => ({
    ...current,
    photo: true,
    clean: false,
    backdropEnabled: false,
    notice: null,
    savedDisplay: current.display,
    display: PHOTO_DISPLAY,
  }));
}

function leavePhoto(setState: VariantProps["setState"]): void {
  setState((current) => ({
    ...current,
    photo: false,
    clean: false,
    backdropEnabled: false,
    notice: "Display toggles restored",
    display: current.savedDisplay ?? current.display,
    savedDisplay: null,
  }));
}

function toggleDisplay(
  setState: VariantProps["setState"],
  key: "mapParticles" | "mapStructures" | "placementGizmo",
): void {
  setState((current) => ({
    ...current,
    display: { ...current.display, [key]: !current.display[key] },
  }));
}

function capture(setState: VariantProps["setState"]): void {
  setState((current) => ({ ...current, clean: true, notice: null, flash: current.flash + 1 }));
  window.setTimeout(() => {
    setState((current) => ({
      ...current,
      clean: false,
      notice: "Capture copied to clipboard",
    }));
  }, 520);
}

function saveAs(setState: VariantProps["setState"]): void {
  setState((current) => ({ ...current, notice: "Save as opened for a PNG copy" }));
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
