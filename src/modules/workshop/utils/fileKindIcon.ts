import { Box, File, FileCode2, FileText, Image, PersonStanding, Sun, Volume2 } from "lucide-react";
import type { ComponentType } from "react";

import { RiotClassicDuotoneIcon } from "@/components";
import type { WorkshopFileKind } from "@/lib/tauri";

export interface FileKindDescriptor {
  /** Icon component rendered in each file row - lucide or one of our own marks. */
  readonly icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  /** Human-readable name shown on hover. */
  readonly label: string;
  /** CSS custom property name used to tint the icon. */
  readonly tintToken: string;
}

const IMAGE_TINT = "--accent-400";
const STRUCTURE_TINT = "--surface-300";
const DATA_TINT = "--surface-400";
const UNKNOWN_TINT = "--surface-500";
const BIN_TINT = "--ltk-riot-red";

export const FILE_KIND_DESCRIPTORS = {
  // Texture / image
  png: { icon: Image, label: "PNG Image", tintToken: IMAGE_TINT },
  jpeg: { icon: Image, label: "JPEG Image", tintToken: IMAGE_TINT },
  tga: { icon: Image, label: "TGA Image", tintToken: IMAGE_TINT },
  svg: { icon: Image, label: "SVG Image", tintToken: IMAGE_TINT },
  texture: { icon: Image, label: "Riot Texture", tintToken: IMAGE_TINT },
  texture_dds: { icon: Image, label: "DDS Texture", tintToken: IMAGE_TINT },

  // Mesh
  simple_skin: { icon: Box, label: "Simple Skin Mesh", tintToken: STRUCTURE_TINT },
  static_mesh_ascii: { icon: Box, label: "Static Mesh (ASCII)", tintToken: STRUCTURE_TINT },
  static_mesh_binary: { icon: Box, label: "Static Mesh (Binary)", tintToken: STRUCTURE_TINT },
  map_geometry: { icon: Box, label: "Map Geometry", tintToken: STRUCTURE_TINT },
  world_geometry: { icon: Box, label: "World Geometry", tintToken: STRUCTURE_TINT },

  // Animation / rig
  animation: { icon: PersonStanding, label: "Animation", tintToken: STRUCTURE_TINT },
  skeleton: { icon: PersonStanding, label: "Skeleton", tintToken: STRUCTURE_TINT },

  // Property data
  property_bin: { icon: RiotClassicDuotoneIcon, label: "Property Bin", tintToken: BIN_TINT },
  property_bin_override: {
    icon: RiotClassicDuotoneIcon,
    label: "Property Bin Override",
    tintToken: BIN_TINT,
  },
  preload: { icon: FileCode2, label: "Preload", tintToken: DATA_TINT },

  // Text / strings
  riot_string_table: { icon: FileText, label: "Riot String Table", tintToken: DATA_TINT },
  lua_obj: { icon: FileText, label: "Compiled Lua", tintToken: DATA_TINT },

  // Audio
  wwise_bank: { icon: Volume2, label: "Wwise Bank", tintToken: STRUCTURE_TINT },
  wwise_package: { icon: Volume2, label: "Wwise Package", tintToken: STRUCTURE_TINT },

  // Light data
  light_grid: { icon: Sun, label: "Light Grid", tintToken: STRUCTURE_TINT },

  // Fallback
  unknown: { icon: File, label: "Unknown file", tintToken: UNKNOWN_TINT },
} as const satisfies Record<WorkshopFileKind, FileKindDescriptor>;

export function describeFileKind(kind: WorkshopFileKind): FileKindDescriptor {
  return FILE_KIND_DESCRIPTORS[kind];
}
