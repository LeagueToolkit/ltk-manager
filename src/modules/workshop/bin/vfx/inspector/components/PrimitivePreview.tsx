import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/hooks";
import { m } from "@/i18n";

import type { MeshModel } from "../../engine/model/model";
import { loadMeshGeometry } from "../../rendering/hooks/useVfxMeshes";
import {
  drawSketch,
  fitMesh,
  type Sketch,
  SKETCH_VIEW,
  type SketchKind,
  type SketchMesh,
} from "../utils/primitiveSketch";

/** Where the camera starts, a quarter turn off the front so depth reads at once. */
const START_YAW = 0.6;
/** Radians per millisecond, one turn in about twenty seconds. */
const TURN_RATE = (2 * Math.PI) / 20_000;
/** Radians per pixel of a drag across the sketch. */
const DRAG_RATE = 0.02;
const DOT_RADIUS = 1.6;
/** The stroke that closes the hairline between two triangles of one mesh. */
const SEAM = 0.35;

/** The token colours the canvas paints with, in the order the probes under it list them. */
const TONES = [
  "text-surface-800",
  "text-accent-500",
  "text-accent-400",
  "text-surface-700",
  "text-surface-400",
  "text-surface-200",
] as const;

interface Tones {
  readonly base: string;
  readonly fill: string;
  readonly edge: string;
  readonly ground: string;
  readonly guide: string;
  readonly dot: string;
}

/**
 * A sketch of what a primitive draws, the camera turning slowly about the particles.
 *
 * A mesh kind draws the emitter's own mesh once it loads. A drag turns the sketch by hand
 * and it carries on from there, and reduced motion holds it still.
 */
export function PrimitivePreview({
  kind,
  name,
  mesh: model,
}: {
  kind: SketchKind;
  name: string;
  /** The mesh the emitter names, which only a mesh kind reads. */
  mesh: MeshModel | null;
}) {
  const reduced = useReducedMotion();
  const mesh = useSketchMesh(kind === "mesh" || kind === "attachedMesh" ? model : null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probes = useRef<HTMLSpanElement>(null);
  const yaw = useRef(START_YAW);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const repaint = useRef<() => void>(() => {});

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d") ?? null;
    if (element === null || context === null) {
      return;
    }

    const scale = window.devicePixelRatio || 1;
    element.width = Math.round(element.clientWidth * scale);
    element.height = Math.round(element.clientHeight * scale);
    repaint.current = () =>
      paint(context, drawSketch(kind, yaw.current, mesh), tonesOf(probes.current));
    repaint.current();
    if (reduced) {
      return;
    }

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (drag.current === null) {
        yaw.current += (now - last) * TURN_RATE;
      }

      last = now;
      repaint.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [kind, mesh, reduced]);

  const release = () => {
    drag.current = null;
  };

  return (
    <span data-ui="PrimitivePreview" className="relative flex shrink-0">
      <canvas
        ref={canvas}
        role="img"
        aria-label={m.workshop_bin_vfx_primitive_sketch_label({ primitive: name })}
        /* DS-GROUND, DS-VEIL, DS-RADIUS */
        className="h-24 w-44 cursor-grab touch-none rounded-sm border border-surface-veil bg-surface-950/40 active:cursor-grabbing"
        onPointerDown={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, yaw: yaw.current };
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const from = drag.current;
          if (from === null) {
            return;
          }

          yaw.current = from.yaw + (event.clientX - from.x) * DRAG_RATE;
          repaint.current();
        }}
        onPointerUp={release}
        onPointerCancel={release}
      />
      <span ref={probes} hidden>
        {TONES.map((tone) => (
          <span key={tone} className={tone} />
        ))}
      </span>
    </span>
  );
}

/** The mesh a model names, fitted to the sketch, and null until it loads or where it cannot. */
function useSketchMesh(model: MeshModel | null): SketchMesh | null {
  const [loaded, setLoaded] = useState<{ signature: string; mesh: SketchMesh | null } | null>(null);
  const signature =
    model === null ? null : JSON.stringify([model.asset, model.submeshes, model.submeshesAlways]);
  const latest = useRef(model);
  latest.current = model;

  useEffect(() => {
    const held = latest.current;
    if (signature === null || held === null) {
      return;
    }

    let live = true;
    void loadMeshGeometry(held)
      .then((geometry) => {
        const index = geometry.getIndex();
        const mesh =
          index === null ? null : fitMesh(geometry.getAttribute("position").array, index.array);
        geometry.dispose();
        if (live) {
          setLoaded({ signature, mesh });
        }
      })
      .catch(() => {
        if (live) {
          setLoaded({ signature, mesh: null });
        }
      });

    return () => {
      live = false;
    };
  }, [signature]);

  return loaded?.signature === signature ? loaded.mesh : null;
}

/** The probes' resolved colours, which follow the theme and the reader's accent. */
function tonesOf(probes: HTMLSpanElement | null): Tones {
  const colour = (at: number) => {
    const probe = probes?.children[at];
    return probe === undefined ? "" : getComputedStyle(probe).color;
  };

  return {
    base: colour(0),
    fill: colour(1),
    edge: colour(2),
    ground: colour(3),
    guide: colour(4),
    dot: colour(5),
  };
}

/** One frame of `sketch` onto `context`, the view box fitted into its canvas. */
function paint(context: CanvasRenderingContext2D, sketch: Sketch, tones: Tones): void {
  const { width, height } = context.canvas;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const fit = Math.min(width / SKETCH_VIEW.width, height / SKETCH_VIEW.height);
  context.setTransform(
    fit,
    0,
    0,
    fit,
    (width - SKETCH_VIEW.width * fit) / 2,
    (height - SKETCH_VIEW.height * fit) / 2,
  );
  context.lineJoin = "round";
  context.globalAlpha = 1;

  context.strokeStyle = tones.ground;
  context.lineWidth = 0.5;
  context.beginPath();
  for (const [from, to] of sketch.ground) {
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
  }
  context.stroke();

  for (const shape of sketch.shapes) {
    context.beginPath();
    for (const [at, [x, y]] of shape.points.entries()) {
      if (at === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();

    if (shape.solid) {
      context.lineWidth = SEAM;
      context.globalAlpha = 1;
      context.fillStyle = context.strokeStyle = tones.base;
      context.fill();
      context.stroke();
      context.globalAlpha = 0.15 + 0.75 * shape.shade;
      context.fillStyle = context.strokeStyle = tones.fill;
      context.fill();
      context.stroke();
      continue;
    }

    context.globalAlpha = 0.15 + 0.45 * shape.shade;
    context.fillStyle = tones.fill;
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 0.75;
    context.strokeStyle = tones.edge;
    context.stroke();
  }
  context.globalAlpha = 1;

  context.strokeStyle = tones.guide;
  context.lineWidth = 0.5;
  context.setLineDash([2, 2]);
  context.beginPath();
  for (const [from, to] of sketch.guides) {
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
  }
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = tones.dot;
  for (const [x, y] of sketch.dots) {
    context.beginPath();
    context.arc(x, y, DOT_RADIUS, 0, 2 * Math.PI);
    context.fill();
  }
}
