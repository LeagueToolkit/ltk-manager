import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";

import { Button, Slider } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";
import { AXIS_SIGN, useFitCamera, Viewport } from "@/modules/viewport";
import { usePreviewAntiAliasing, usePreviewCamera } from "@/stores";

import type { SystemModel } from "../../vfx/engine/model/model";
import { createDriver } from "../../vfx/engine/simulation/driver";
import { useVfxSystem } from "../../vfx/hooks/useVfxSystem";
import { Notice } from "../../vfx/preview/components/Notice";
import { Passes } from "../../vfx/rendering/components/Passes";
import { VfxSystem } from "../../vfx/rendering/components/VfxSystem";
import { useVfxMeshes } from "../../vfx/rendering/hooks/useVfxMeshes";
import { useVfxTextures } from "../../vfx/rendering/hooks/useVfxTextures";
import type { AssetLoad } from "../../vfx/rendering/utils/assetLoad";
import { drawnEmitters } from "../../vfx/rendering/utils/definitions";
import { distorts, drawsTheAttachment, isUndrawn } from "../../vfx/rendering/utils/drawKind";
import { fades } from "../../vfx/rendering/utils/softParticle";
import { definitionBounds, rigGround } from "../../vfx/rendering/utils/systemBounds";
import {
  type Flight,
  FLIGHT_STEP,
  FLIGHT_SEED,
  flightSampler,
  measureFlight,
} from "../utils/flight";

/** One flight effect at explicit launch and target points. */
export default function MissileViewport({
  document,
  entry,
  flight,
}: {
  document: BinDocumentId;
  entry: string;
  flight: Flight;
}) {
  const read = useVfxSystem(document, entry);
  if (read.error !== null) return <Notice text={m.workshop_bin_preview_failed_empty()} />;
  if (read.system === null) return <Notice text={m.workshop_spells_loading_label()} />;
  if (read.system.emitters.length === 0)
    return <Notice text={m.workshop_bin_preview_emitters_empty()} />;
  return <LoadedMissile system={read.system} flight={flight} />;
}

function LoadedMissile({ system, flight }: { system: SystemModel; flight: Flight }) {
  const drawn = useMemo(() => drawnEmitters(system), [system]);
  const [textureLoad, setTextureLoad] = useState<{ drawn: typeof drawn; load: AssetLoad } | null>(
    null,
  );
  const [meshLoad, setMeshLoad] = useState<{ drawn: typeof drawn; load: AssetLoad } | null>(null);
  const reportTextures = useCallback((load: AssetLoad) => setTextureLoad({ drawn, load }), [drawn]);
  const reportMeshes = useCallback((load: AssetLoad) => setMeshLoad({ drawn, load }), [drawn]);
  const textures = useVfxTextures(drawn, reportTextures);
  const meshes = useVfxMeshes(drawn, reportMeshes);
  const assetsReady =
    textureLoad?.drawn === drawn &&
    meshLoad?.drawn === drawn &&
    textureLoad.load.pending === 0 &&
    meshLoad.load.pending === 0;
  const failed = (textureLoad?.load.failed ?? 0) + (meshLoad?.load.failed ?? 0);
  const driver = useMemo(() => {
    const driver = createDriver(FLIGHT_SEED);
    driver.swap(system);
    driver.steer(flight.rig);
    return driver;
  }, [system, flight]);
  const [ending, setEnding] = useState<{
    system: SystemModel;
    flight: Flight;
    duration: number;
    limited: boolean;
  } | null>(null);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const measured = ending?.system === system && ending.flight === flight;
  const ready = assetsReady && measured;
  const span = measured ? ending.duration : 60;
  const [time, publishTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const sample = useMemo(() => flightSampler(driver), [driver]);
  const clock = useRef(0);
  const setTime = useCallback((next: number) => {
    clock.current = next;
    publishTime(next);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPrepareFailed(false);
    void measureFlight(system, flight, controller.signal)
      .then((end) => {
        if (!controller.signal.aborted) setEnding({ system, flight, ...end });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPrepareFailed(true);
      });
    return () => controller.abort();
  }, [system, flight]);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [driver, setTime]);
  useEffect(() => {
    if (!playing || !ready || failed > 0) return;
    let last: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      if (last !== null) {
        const next = Math.min(span, clock.current + Math.min((now - last) / 1000, 0.1) * speed);
        setTime(next);
        if (next >= span) {
          setPlaying(false);
          return;
        }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready, failed, speed, span, setTime]);

  return (
    <div data-ui="MissileViewport" className="flex min-h-96 flex-1 shrink-0 flex-col gap-2">
      {drawn.some(({ emitter }) => isUndrawn(emitter) || drawsTheAttachment(emitter)) && (
        <p className="text-meta text-warning-text">{m.workshop_missile_partial_hint()}</p>
      )}
      {!assetsReady && (
        <p className="text-meta text-surface-400">{m.workshop_missile_assets_loading_label()}</p>
      )}
      {failed > 0 && (
        <p className="text-meta text-danger-text">
          {m.workshop_missile_assets_failed_hint({ count: failed })}
        </p>
      )}
      {prepareFailed && <Notice text={m.workshop_bin_preview_failed_empty()} />}
      {assetsReady && !measured && !prepareFailed && (
        <p className="text-meta text-surface-400">{m.workshop_missile_preparing_label()}</p>
      )}
      {measured && ending.limited && (
        <p className="text-meta text-warning-text">{m.workshop_missile_tail_limit_hint()}</p>
      )}
      <div className="relative min-h-64 flex-1">
        <div className="absolute inset-0">
          <Viewport antiAliasing={antiAliasing} stage textured={false} camera={camera}>
            <Passes
              warps={drawn.some(({ emitter }) => distorts(emitter))}
              softens={drawn.some(({ emitter }) => fades(emitter))}
            />
            <Fit system={system} flight={flight} />
            <FlightEffect
              time={time}
              delay={flight.delay}
              ready={ready && failed === 0}
              sample={sample}
            >
              <VfxSystem drawn={drawn} driver={driver} textures={textures} meshes={meshes} />
            </FlightEffect>
            <Anchors flight={flight} />
          </Viewport>
        </div>
      </div>
      <Slider
        animated={false}
        aria-label={m.workshop_missile_time_label()}
        value={time}
        min={0}
        max={span}
        step={FLIGHT_STEP}
        disabled={!ready || failed > 0}
        onValueChange={(value) => {
          setPlaying(false);
          setTime(value);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          disabled={!ready || failed > 0}
          onClick={() => {
            if (time >= span) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing && m.workshop_missile_pause_action()}
          {!playing && m.workshop_missile_play_action()}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!ready || failed > 0}
          onClick={() => {
            driver.restart();
            sample(0);
            setTime(0);
            setPlaying(true);
          }}
        >
          {m.workshop_missile_replay_action()}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setSpeed(speed === 1 ? 0.25 : 1)}>
          {m.workshop_missile_speed_label({ speed })}
        </Button>
        <span className="text-meta text-surface-400">
          {m.workshop_missile_timing_label({
            time: time.toFixed(2),
            launch: flight.delay.toFixed(2),
            arrival: (flight.delay + flight.duration).toFixed(2),
          })}
        </span>
      </div>
    </div>
  );
}

function FlightEffect({
  time,
  delay,
  ready,
  sample,
  children,
}: {
  time: number;
  delay: number;
  ready: boolean;
  sample: (time: number) => void;
  children: React.ReactNode;
}) {
  const group = useRef<Group>(null);
  useFrame(() => {
    if (ready) sample(Math.max(0, time - delay));
    if (group.current !== null) group.current.visible = ready && time >= delay;
  }, -1);
  return (
    <group ref={group} visible={false}>
      {children}
    </group>
  );
}

function Fit({ system, flight }: { system: SystemModel; flight: Flight }) {
  const fit = useFitCamera();
  const drawn = useMemo(() => drawnEmitters(system), [system]);
  useEffect(() => {
    fit(definitionBounds(system, drawn, flight.rig), rigGround(system, flight.rig));
  }, [fit, system, drawn, flight]);
  return null;
}

function Anchors({ flight }: { flight: Flight }) {
  const motion = flight.rig.motion;
  if (motion.kind !== "path") return null;
  return (
    <>
      {[motion.from, motion.to].map((point, index) => (
        <mesh key={index} position={[point[0] * AXIS_SIGN[0], point[1], point[2]]}>
          <sphereGeometry args={[10, 12, 8]} />
          <meshNormalMaterial wireframe />
        </mesh>
      ))}
    </>
  );
}
