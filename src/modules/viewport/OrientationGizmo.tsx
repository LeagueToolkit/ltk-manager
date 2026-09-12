import { GizmoHelper, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { CanvasTexture, type Color, DoubleSide, SRGBColorSpace } from "three";

import type { SceneColors } from "./sceneColors";

/** Where the gizmo sits, in pixels off the pane's top left corner. */
const MARGIN: [number, number] = [64, 64];

/** An arm's length in pixels, which everything else is built against. */
const SIZE = 48;

/** The HUD draws over the frame's passes, which own the loop one priority below. */
const OVER_THE_FRAME = 2;

/** An arm's thickness, as a share of its length. */
const ARM = 0.03;

/** Where a face spans between its two arms, as shares of their length: edge to edge. */
const FACE_FROM = 0;
const FACE_TO = 1;

/** How much of the axis colour fills a face, and how much once the pointer is over it. */
const FACE_FILL = 0.14;
const FACE_LIT = 0.55;

/** A face's border, in pixels at any zoom. */
const FACE_EDGE = 1;

/** Where a head sits past its arm's end, and how big it draws. */
const HEAD_AT = 1.2;
const HEAD = 0.42;
const HEAD_PX = 64;
const HEAD_FONT = `700 ${HEAD_PX * 0.7}px system-ui, sans-serif`;

type Channel = "axisX" | "axisY" | "axisZ";

/** The direction an arm or a face points, which a click stands the camera on. */
export type Look = readonly [number, number, number];

interface AxisModel {
  readonly look: Look;
  readonly label: string;
  readonly channel: Channel;
}

/** The three arms out of the corner, on the viewport's own positive axes. */
const AXES: readonly AxisModel[] = [
  { look: [1, 0, 0], label: "X", channel: "axisX" },
  { look: [0, 1, 0], label: "Y", channel: "axisY" },
  { look: [0, 0, 1], label: "Z", channel: "axisZ" },
];

interface FaceModel {
  /** The axis the face looks along, which is the one it does not span. */
  readonly normal: AxisModel;
  /** How the plane is turned to lie across its normal. */
  readonly rotation: [number, number, number];
}

/** The three faces, each between two arms and looking along the third. */
const FACES: readonly FaceModel[] = [
  { normal: AXES[2], rotation: [0, 0, 0] },
  { normal: AXES[0], rotation: [0, Math.PI / 2, 0] },
  { normal: AXES[1], rotation: [-Math.PI / 2, 0, 0] },
];

export interface OrientationGizmoProps {
  readonly colors: SceneColors;
  /** An arm's head or a face was picked, so the reader wants the camera standing on its `look`. */
  readonly onLook: (look: Look) => void;
}

/**
 * The corner of a cube in the pane's corner, turning with the camera: three arms and the
 * three faces between them, every head and face a button.
 *
 * Each arm and the face across it wear that axis's channel colour, which the curve panel
 * uses for the same axis. The gizmo reports the look it was picked on and moves nothing
 * itself, so the stand goes through the same controls a preset does and the store learns
 * which preset it is. Drawn in the viewport's own axes.
 */
export function OrientationGizmo({ colors, onLook }: OrientationGizmoProps) {
  const pick = (event: ThreeEvent<MouseEvent>, look: Look) => {
    event.stopPropagation();
    onLook(look);
  };

  return (
    <GizmoHelper alignment="top-left" margin={MARGIN} renderPriority={OVER_THE_FRAME}>
      <group scale={SIZE}>
        {/* Stood back by half a cube, so the corner turns about the cube's own middle. */}
        <group position={[-0.5, -0.5, -0.5]}>
          {AXES.map((axis) => (
            <Arm key={axis.label} axis={axis} color={colors[axis.channel]} onPick={pick} />
          ))}
          {FACES.map((face) => (
            <Face
              key={face.normal.label}
              face={face}
              color={colors[face.normal.channel]}
              onPick={pick}
            />
          ))}
        </group>
      </group>
    </GizmoHelper>
  );
}

interface PickProps {
  readonly onPick: (event: ThreeEvent<MouseEvent>, look: Look) => void;
}

interface ArmProps extends PickProps {
  readonly axis: AxisModel;
  readonly color: Color;
}

/** One arm out of the corner, and its letter past the end. */
function Arm({ axis, color, onPick }: ArmProps) {
  const { look, label } = axis;
  const texture = useMemo(() => paintHead(color, label), [color, label]);
  const [hovered, setHovered] = useState(false);

  return (
    <group>
      <mesh position={[look[0] / 2, look[1] / 2, look[2] / 2]}>
        <boxGeometry
          args={[look[0] === 0 ? ARM : 1, look[1] === 0 ? ARM : 1, look[2] === 0 ? ARM : 1]}
        />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <sprite
        position={[look[0] * HEAD_AT, look[1] * HEAD_AT, look[2] * HEAD_AT]}
        scale={HEAD * (hovered ? 1.2 : 1)}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => onPick(event, look)}
      >
        <spriteMaterial map={texture} alphaTest={0.3} toneMapped={false} />
      </sprite>
    </group>
  );
}

interface FaceProps extends PickProps {
  readonly face: FaceModel;
  readonly color: Color;
}

/** The square between two arms, filled thin in the colour of the axis it looks along. */
function Face({ face, color, onPick }: FaceProps) {
  const { normal, rotation } = face;
  const [hovered, setHovered] = useState(false);
  const span = FACE_TO - FACE_FROM;
  const middle = (FACE_FROM + FACE_TO) / 2;
  /* The square's middle lies in its plane, which is off the corner along both arms
     it spans and not at all along its normal. */
  const position: [number, number, number] = [
    normal.look[0] === 0 ? middle : 0,
    normal.look[1] === 0 ? middle : 0,
    normal.look[2] === 0 ? middle : 0,
  ];
  const half = span / 2;
  const border = useMemo<[number, number, number][]>(
    () => [
      [-half, -half, 0],
      [half, -half, 0],
      [half, half, 0],
      [-half, half, 0],
      [-half, -half, 0],
    ],
    [half],
  );

  return (
    <group position={position} rotation={rotation}>
      <mesh
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => onPick(event, normal.look)}
      >
        <planeGeometry args={[span, span]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? FACE_LIT : FACE_FILL}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Line points={border} color={color} lineWidth={FACE_EDGE} />
    </group>
  );
}

/** `label` alone in `color`, as the texture one head wears. The sprite is still the hit box. */
function paintHead(color: Color, label: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = HEAD_PX;
  canvas.height = HEAD_PX;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const middle = HEAD_PX / 2;
    context.font = HEAD_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    /* The hex is the colour in sRGB, where the channels themselves are linear. */
    context.fillStyle = `#${color.getHexString()}`;
    context.fillText(label, middle, middle + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
