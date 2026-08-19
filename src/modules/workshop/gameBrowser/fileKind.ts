import type { WorkshopFileKind } from "@/lib/tauri";

/* A game archive stores no kind of its own, so the extension of the resolved
   path is all there is to go on. */
const KIND_BY_EXTENSION: Readonly<Record<string, WorkshopFileKind>> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  tga: "tga",
  svg: "svg",
  tex: "texture",
  dds: "texture_dds",
  skn: "simple_skin",
  sco: "static_mesh_ascii",
  scb: "static_mesh_binary",
  mapgeo: "map_geometry",
  wgeo: "world_geometry",
  anm: "animation",
  skl: "skeleton",
  bin: "property_bin",
  preload: "preload",
  stringtable: "riot_string_table",
  luaobj: "lua_obj",
  bnk: "wwise_bank",
  wpk: "wwise_package",
};

/** The file kind a path's extension names, for the shared kind icons. */
export function fileKindFromPath(path: string): WorkshopFileKind {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "unknown";
  return KIND_BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? "unknown";
}
