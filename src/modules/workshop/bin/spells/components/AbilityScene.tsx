import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";

import { Button, Slider } from "@/components";
import { m } from "@/i18n";
import type { SkinModel } from "@/lib/tauri";
import {
  AXIS_SIGN,
  Character,
  createSceneClock,
  FitCamera,
  meshBounds,
  type MeshGeometry,
  type Pose,
  type SceneClock,
  useAssetTextures,
  useSceneColors,
  Viewport,
} from "@/modules/viewport";
import {
  usePreviewAntiAliasing,
  usePreviewCamera,
  usePreviewGround,
  usePreviewMidlane,
} from "@/stores";

import { bindingOf, textureAssets } from "../../skin/utils/skinScene";
import { Passes } from "../../vfx/rendering/components/Passes";
import { VfxSystem } from "../../vfx/rendering/components/VfxSystem";
import { useVfxMeshes } from "../../vfx/rendering/hooks/useVfxMeshes";
import { useVfxTextures } from "../../vfx/rendering/hooks/useVfxTextures";
import type { AssetLoad } from "../../vfx/rendering/utils/assetLoad";
import { drawnEmitters } from "../../vfx/rendering/utils/definitions";
import { distorts, isUndrawn } from "../../vfx/rendering/utils/drawKind";
import { fades } from "../../vfx/rendering/utils/softParticle";
import { type AbilityRecipe, arrivalOf } from "../utils/abilityRecipe";
import { abilityInstance, measureAbility, type ResolvedStep } from "../utils/abilitySequence";
import { FLIGHT_STEP } from "../utils/flight";
import { guideLines } from "../utils/guideLines";
import { AbilityGuides } from "./AbilityGuides";

const GROUND: [number, number, number] = [0, 0, 0];

export function AbilityScene({
  skin,
  mesh: geometry,
  pose,
  recipe,
  steps,
}: {
  skin: SkinModel;
  mesh: MeshGeometry;
  pose: Pose;
  recipe: AbilityRecipe;
  steps: readonly ResolvedStep[];
}) {
  const clock = useMemo(createSceneClock, []);
  const instances = useMemo(() => steps.map(abilityInstance), [steps]);
  const [showGuides, setShowGuides] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ending, setEnding] = useState<{
    steps: typeof steps;
    duration: number;
    limited: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loads, setLoads] = useState<ReadonlyMap<string, AssetLoad>>(new Map());
  const report = useCallback(
    (id: string, load: AssetLoad) => setLoads((held) => new Map(held).set(id, load)),
    [],
  );
  const assets = useMemo(() => textureAssets(skin), [skin]);
  const reportCharacter = useCallback((load: AssetLoad) => report("character", load), [report]);
  const textures = useAssetTextures(assets, { report: reportCharacter });
  const binding = useCallback(
    (submesh: string) => bindingOf(skin, textures, submesh),
    [skin, textures],
  );
  const colors = useSceneColors();
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const bounds = useMemo(() => {
    const box = meshBounds(geometry, skin.hidden, skin.scale ?? 1);
    if (box === null) return null;
    const points = [
      recipe.target,
      ...(showGuides && recipe.guides !== undefined
        ? guideLines(recipe.guides, recipe.target).flat()
        : []),
    ].map((point) => point.map((value, axis) => value * AXIS_SIGN[axis]));
    return {
      min: box.min.map((value, axis) =>
        Math.min(value, ...points.map((point) => point[axis] - 50)),
      ) as [number, number, number],
      max: box.max.map((value, axis) =>
        Math.max(value, ...points.map((point) => point[axis] + 50)),
      ) as [number, number, number],
    };
  }, [geometry, skin, recipe, showGuides]);
  const measured = ending?.steps === steps;
  const span = measured ? ending.duration : 60;
  const loading = ["character", ...steps.map((step) => step.id)].some(
    (id) => loads.get(id) === undefined || loads.get(id)!.pending > 0,
  );
  const assetFailed = [...loads.values()].some((load) => load.failed > 0);
  const ready = measured && !loading && !assetFailed && !failed;
  const allDrawn = useMemo(
    () => steps.flatMap((step) => drawnEmitters(step.system, step.id === "cast")),
    [steps],
  );
  useEffect(() => {
    const controller = new AbortController();
    clock.restart();
    setTime(0);
    setPlaying(false);
    setFailed(false);
    void measureAbility(steps, Math.max(pose.duration, arrivalOf(recipe)), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEnding({ steps, ...result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [steps, pose.duration, recipe, clock]);
  const seek = (next: number) => {
    if (!Number.isFinite(next)) return;
    clock.seek(Math.max(0, Math.min(span, next)));
    setTime(clock.time);
  };
  return (
    <div data-ui="AbilityPreview" className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-64 flex-1">
        <div className="absolute inset-0">
          <Viewport antiAliasing={antiAliasing} stage={ground} textured={midlane} camera={camera}>
            <AbilityClock
              clock={clock}
              playing={playing && ready}
              speed={speed}
              span={span}
              publish={setTime}
              stop={() => setPlaying(false)}
            />
            {showGuides && <AbilityGuides recipe={recipe} />}
            <FitCamera bounds={bounds} ground={GROUND} token={0} />
            <Passes
              warps={allDrawn.some(({ emitter }) => distorts(emitter))}
              softens={allDrawn.some(({ emitter }) => fades(emitter))}
            />
            <Character
              mesh={geometry}
              pose={pose}
              clock={clock}
              bindingOf={binding}
              colors={colors}
              hidden={skin.hidden}
              scale={skin.scale ?? 1}
            >
              {instances
                .filter((instance) => instance.step.id === "cast")
                .map((instance) => (
                  <SequenceEffect
                    key={instance.step.id}
                    instance={instance}
                    clock={clock}
                    ready={ready}
                    report={report}
                  />
                ))}
            </Character>
            {instances
              .filter((instance) => instance.step.id !== "cast")
              .map((instance) => (
                <SequenceEffect
                  key={instance.step.id}
                  instance={instance}
                  clock={clock}
                  ready={ready}
                  report={report}
                />
              ))}
            <mesh position={[recipe.target[0] * AXIS_SIGN[0], recipe.target[1], recipe.target[2]]}>
              <sphereGeometry args={[8, 12, 8]} />
              <meshBasicMaterial color={colors.gizmo} wireframe />
            </mesh>
          </Viewport>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-surface-700/50 p-3">
        {!ready && !assetFailed && !failed && (
          <p role="status" className="text-meta text-surface-400">
            {m.workshop_missile_preparing_label()}
          </p>
        )}
        {(assetFailed || failed) && (
          <p role="alert" className="text-meta text-danger-text">
            {m.workshop_bin_preview_failed_empty()}
          </p>
        )}
        {measured && ending.limited && (
          <p className="text-meta text-warning-text">{m.workshop_missile_tail_limit_hint()}</p>
        )}
        {allDrawn.some(({ emitter }) => isUndrawn(emitter)) && (
          <p className="text-meta text-warning-text">{m.workshop_missile_partial_hint()}</p>
        )}
        <Slider
          animated={false}
          aria-label={m.workshop_ability_time_label()}
          min={0}
          max={span}
          step={FLIGHT_STEP}
          value={time}
          disabled={!ready}
          onValueChange={(value) => {
            setPlaying(false);
            seek(value);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            disabled={!ready}
            onClick={() => {
              if (time >= span) seek(0);
              setPlaying(!playing);
            }}
          >
            {playing && m.workshop_missile_pause_action()}
            {!playing && m.workshop_ability_cast_action()}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!ready}
            onClick={() => {
              seek(0);
              setPlaying(true);
            }}
          >
            {m.workshop_missile_replay_action()}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSpeed(speed === 1 ? 0.25 : 1)}>
            {m.workshop_missile_speed_label({ speed })}
          </Button>
          {recipe.guides !== undefined && (
            <Button
              size="xs"
              variant="ghost"
              aria-pressed={showGuides}
              onClick={() => setShowGuides(!showGuides)}
            >
              {m.workshop_ability_guides_label()}
            </Button>
          )}
          <span className="text-meta text-surface-300 tabular-nums">
            {time.toFixed(2)} / {span.toFixed(2)} s
          </span>
        </div>
        <p className="text-meta text-surface-400">
          {m.workshop_ability_timing_label({
            release: recipe.release.toFixed(2),
            arrival: arrivalOf(recipe).toFixed(2),
          })}
        </p>
      </div>
    </div>
  );
}

function AbilityClock({
  clock,
  playing,
  speed,
  span,
  publish,
  stop,
}: {
  clock: SceneClock;
  playing: boolean;
  speed: number;
  span: number;
  publish: (time: number) => void;
  stop: () => void;
}) {
  useFrame((_state, delta) => {
    if (!playing) return;
    clock.advance(Math.min(span - clock.time, Math.min(delta, 0.1) * speed));
    publish(clock.time);
    if (clock.time >= span) stop();
  }, -2);
  return null;
}

function SequenceEffect({
  instance,
  clock,
  ready,
  report,
}: {
  instance: ReturnType<typeof abilityInstance>;
  clock: SceneClock;
  ready: boolean;
  report: (id: string, load: AssetLoad) => void;
}) {
  const drawn = useMemo(
    () => drawnEmitters(instance.step.system, instance.step.id === "cast"),
    [instance],
  );
  const [textureLoad, setTextureLoad] = useState<AssetLoad>({ pending: 1, failed: 0 });
  const [meshLoad, setMeshLoad] = useState<AssetLoad>({ pending: 1, failed: 0 });
  const textures = useVfxTextures(drawn, setTextureLoad);
  const meshes = useVfxMeshes(drawn, setMeshLoad);
  useEffect(() => {
    report(instance.step.id, {
      pending: textureLoad.pending + meshLoad.pending,
      failed: textureLoad.failed + meshLoad.failed,
    });
  }, [report, instance, textureLoad, meshLoad]);
  const group = useRef<Group>(null);
  useFrame(() => {
    if (ready) instance.sample(clock.time);
    if (group.current !== null) group.current.visible = ready && clock.time >= instance.step.start;
  }, -1);
  return (
    <group ref={group} visible={false}>
      <VfxSystem drawn={drawn} driver={instance.driver} textures={textures} meshes={meshes} />
    </group>
  );
}
