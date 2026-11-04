//! An open `.mapgeo` that the map editor edits: its meshes, the undo history and the bytes a
//! save writes. "Meshes" and "Saving geometry" in docs/ux/MAP_EDITOR.md.

use std::io::Cursor;
use std::path::Path;

use glam::Mat4;
use ltk_mapgeo::{
    BuildError, EditError, EnvironmentAsset, EnvironmentMesh, EnvironmentQuality,
    EnvironmentSubmesh, EnvironmentVisibility, FaceMask, SceneGraphSelection,
};
use ltk_mesh::mem::{IndexBuffer, VertexBuffer};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use xxhash_rust::xxh64::xxh64;

use crate::map_export::{ExportError, ExportMesh, export_meshes};
use crate::map_import::{ImportError, SourceMesh, UpAxis, lower, read_model};
use crate::preview::{PreviewError, encode_map, encode_map_meshes};
use ltk_manager_base::error::{AppError, DomainError, ErrorKind};

/// The most steps the undo history keeps.
const HISTORY_DEPTH: usize = 100;

/// Why an open `.mapgeo` refused an edit or a save.
#[derive(Debug, Error)]
pub enum MapGeometryError {
    /// The bytes are not a map `ltk_mapgeo` reads.
    #[error("Not a readable map: {0}")]
    Read(#[from] ltk_mapgeo::ParseError),

    /// The scene graphs of the map do not match its meshes.
    #[error("The scene graphs of the map could not be read or baked: {0}")]
    SceneGraph(#[from] BuildError),

    /// `ltk_mapgeo` refused the edit.
    #[error("The mesh edit was refused: {0}")]
    Edit(#[from] EditError),

    /// An edit names a mesh that the map does not hold.
    #[error("The map has no mesh {0}")]
    NoMesh(u32),

    /// An edit names a submesh that its mesh does not hold.
    #[error("Mesh {mesh} has no submesh {submesh}")]
    NoSubmesh { mesh: u32, submesh: u32 },

    /// A hash is not `0x` and eight hex digits.
    #[error("Not a path hash: {0}")]
    Hash(String),

    /// The writer refused the map.
    #[error("The map could not be written: {0}")]
    Write(#[from] ltk_mapgeo::WriteError),

    /// The viewport buffer could not be built.
    #[error(transparent)]
    Preview(#[from] PreviewError),

    /// The model file of an import could not be read.
    #[error(transparent)]
    Import(#[from] ImportError),

    /// An import names a mesh that the model file does not hold.
    #[error("The model file has no mesh {0}")]
    NoSourceMesh(u32),

    /// An import names no material for a material of the model file.
    #[error("No material was chosen for material {0} of the model file")]
    NoSourceMaterial(usize),

    /// An import adds no triangle.
    #[error("The chosen meshes of the model file hold no triangles")]
    EmptyImport,

    /// The meshes could not be exported.
    #[error(transparent)]
    Export(#[from] ExportError),
}

impl From<MapGeometryError> for AppError {
    fn from(error: MapGeometryError) -> Self {
        Self::Domain(DomainError::new(ErrorKind::Preview, error))
    }
}

/// One mesh's transform, column major with the translation last.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MeshTransform {
    pub mesh: u32,
    pub transform: [f32; 16],
}

/// One change to the meshes of an open `.mapgeo`, which is one undo step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum MapGeometryEdit {
    /// Sets the transform of each mesh and recomputes its bounding box.
    Transform { meshes: Vec<MeshTransform> },
    /// Sets the visibility controller of each mesh, `0x` and eight hex digits, or none.
    Controller {
        meshes: Vec<u32>,
        controller: Option<String>,
    },
    /// Sets the region entity of each mesh, `0x` and eight hex digits, or none, and
    /// recomputes its bounding box.
    Region {
        meshes: Vec<u32>,
        region: Option<String>,
    },
    /// Sets the material of one submesh, as the entry path of a `StaticMaterialDef`.
    Material {
        mesh: u32,
        submesh: u32,
        material: String,
    },
    /// Sets the visibility layer mask of each mesh.
    Visibility { meshes: Vec<u32>, mask: u8 },
    /// Sets the quality mask of each mesh.
    Quality { meshes: Vec<u32>, mask: u8 },
    /// Turns backface culling off or on for each mesh.
    BackfaceCulling { meshes: Vec<u32>, disabled: bool },
    /// Appends a copy of each mesh.
    Duplicate { meshes: Vec<u32> },
    /// Removes each mesh and drops the buffers that no remaining mesh uses.
    Remove { meshes: Vec<u32> },
    /// Appends the meshes `meshes` of the model file at `source`, scaled by `scale` and
    /// turned from `up` to the engine's axes, with `transform` as each mesh's transform.
    Import {
        source: String,
        meshes: Vec<u32>,
        scale: f32,
        up: UpAxis,
        /// The entry path of the `StaticMaterialDef` of each material of the file, by index.
        materials: Vec<String>,
        /// The layer mask of every new mesh.
        visibility: u8,
        /// The controller of every new mesh, `0x` and eight hex digits, or none.
        controller: Option<String>,
        /// Column major with the translation last.
        transform: [f32; 16],
    },
    /// Replaces the mesh at `mesh` with the mesh `source_mesh` of the model file at `source`,
    /// scaled by `scale` and turned from `up` to the engine's axes. The new mesh keeps the
    /// visibility, controller, region, flags, light channels and texture overrides of the old
    /// one, and draws its submesh materials in source material order. Its transform is the
    /// identity, because the importer applies the file's node transforms to the vertices.
    Reimport {
        mesh: u32,
        source: String,
        source_mesh: u32,
        scale: f32,
        up: UpAxis,
    },
}

/// What a mesh editor lists and inspects of one mesh.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapGeometryMesh {
    pub index: u32,
    /// Column major with the translation last.
    pub transform: [f32; 16],
    pub min: [f32; 3],
    pub max: [f32; 3],
    /// The layer mask, one bit per visibility layer.
    pub visibility: u8,
    /// The controller's path hash as `0x` and eight hex digits, and none for no controller.
    pub controller: Option<String>,
    /// The region entity's path hash as `0x` and eight hex digits, and none for no region.
    pub region: Option<String>,
    /// The quality mask, one bit per quality level.
    pub quality: u8,
    pub backface_culling_disabled: bool,
    pub vertex_count: u32,
    /// The material of each submesh, in submesh order.
    pub materials: Vec<String>,
}

/// One change to the meshes a viewport draws, in the order a change applies them.
///
/// The indices of each delta are the ones the meshes hold once every delta before it applied.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum MeshDelta {
    /// The mesh at `mesh` now reads as `record`. `from` is the transform it was drawn with.
    Update {
        mesh: u32,
        from: [f32; 16],
        record: Box<MapGeometryMesh>,
    },
    /// The mesh at `mesh` is gone, and the meshes after it moved down by one.
    Remove { mesh: u32 },
    /// A mesh landed at `mesh`, and the meshes from there on moved up by one. Its vertices
    /// are read with [`MapGeometryDocument::preview_meshes`].
    Insert { mesh: u32 },
}

/// One mesh taken out of the asset, with copies of the buffers it draws, so it goes back.
#[derive(Debug, Clone)]
struct Taken {
    index: usize,
    mesh: EnvironmentMesh,
    vertex_buffers: Vec<VertexBuffer>,
    index_buffer: IndexBuffer<u16>,
    mask: FaceMask,
    /// The mesh's transform, which `ltk_mapgeo` sets only on a mesh that the asset holds.
    transform: Mat4,
}

/// The properties of one mesh that an edit changes, and never its buffer ids.
///
/// A removal and an insert renumber the buffers, so a step that stored a whole mesh record
/// would put stale ids back. These are applied through the setters onto the current record.
#[derive(Debug, Clone, PartialEq)]
struct MeshProps {
    transform: Mat4,
    region: u32,
    controller: u32,
    visibility: EnvironmentVisibility,
    quality: EnvironmentQuality,
    culling_disabled: bool,
    materials: Vec<String>,
}

impl MeshProps {
    fn of(mesh: &EnvironmentMesh) -> Self {
        Self {
            transform: *mesh.transform(),
            region: mesh.region_path_hash(),
            controller: mesh.visibility_controller_path_hash(),
            visibility: mesh.visibility(),
            quality: mesh.quality(),
            culling_disabled: mesh.disable_backface_culling(),
            materials: mesh
                .submeshes()
                .iter()
                .map(|submesh| submesh.material().to_owned())
                .collect(),
        }
    }
}

/// One applied change, stated as the change that reverts it.
#[derive(Debug, Clone)]
enum Step {
    /// Puts each mesh's properties back.
    Restore(Vec<(usize, MeshProps)>),
    /// Removes the meshes at these indices, highest first.
    Remove(Vec<usize>),
    /// Inserts the taken meshes back, lowest index first.
    Insert(Vec<Taken>),
    /// Applies each step in order.
    Sequence(Vec<Step>),
}

/// An open `.mapgeo`, its scene graph selection and its undo history.
#[derive(Debug)]
pub struct MapGeometryDocument {
    asset: EnvironmentAsset,
    /// The faces of each mesh that feed a scene graph, read before any edit.
    selection: SceneGraphSelection,
    /// The xxh64 of the bytes the document was read from or last saved as.
    base: u64,
    undo: Vec<Step>,
    redo: Vec<Step>,
    /// Counts every change.
    revision: u64,
    /// The revision that the bytes at `base` hold.
    saved: u64,
}

impl MapGeometryDocument {
    /// Reads `bytes` and the scene graph selection of the map they hold.
    ///
    /// # Errors
    ///
    /// Fails if the bytes are not a map, or if its scene graphs do not match its meshes.
    pub fn parse(bytes: &[u8]) -> Result<Self, MapGeometryError> {
        let asset = EnvironmentAsset::from_reader(&mut Cursor::new(bytes))?;
        let selection = asset.scene_graph_selection()?;
        Ok(Self {
            asset,
            selection,
            base: xxh64(bytes, 0),
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            saved: 0,
        })
    }

    /// Returns the map with its edits applied.
    #[must_use]
    pub fn asset(&self) -> &EnvironmentAsset {
        &self.asset
    }

    /// The count of changes applied, undone and redone since the open.
    #[must_use]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Whether the document holds changes that no save wrote.
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        self.revision != self.saved
    }

    /// Whether `bytes` are the bytes that the document was read from or last saved as.
    #[must_use]
    pub fn is_base(&self, bytes: &[u8]) -> bool {
        xxh64(bytes, 0) == self.base
    }

    /// Lists every mesh in file order.
    #[must_use]
    pub fn meshes(&self) -> Vec<MapGeometryMesh> {
        (0..self.asset.mesh_count())
            .map(|at| self.describe(at))
            .collect()
    }

    /// Returns the name and the vertex count of the mesh at `mesh`.
    ///
    /// # Errors
    ///
    /// Fails if the map has no mesh `mesh`.
    pub fn identity(&self, mesh: u32) -> Result<(String, u32), MapGeometryError> {
        let existing = &self.asset.meshes()[self.index(mesh)?];
        Ok((existing.name().to_owned(), existing.vertex_count()))
    }

    /// Reads the meshes at `meshes` for an export. Reads every mesh if `meshes` is `None`.
    ///
    /// # Errors
    ///
    /// Fails for the reasons [`export_meshes`] documents.
    pub fn export(&self, meshes: Option<&[usize]>) -> Result<Vec<ExportMesh>, MapGeometryError> {
        let every: Vec<usize> = (0..self.asset.mesh_count()).collect();
        Ok(export_meshes(&self.asset, meshes.unwrap_or(&every))?)
    }

    /// Encodes the meshes as the buffer a viewport draws.
    ///
    /// # Errors
    ///
    /// Fails for the reasons [`encode_map`] documents.
    pub fn preview(&self) -> Result<Vec<u8>, MapGeometryError> {
        Ok(encode_map(&self.asset)?)
    }

    /// Encodes the meshes at `meshes`, in that order, as a buffer of the whole map's layout,
    /// which a viewport reads the vertices of an inserted mesh from.
    ///
    /// # Errors
    ///
    /// Fails for the reasons [`encode_map_meshes`] documents.
    pub fn preview_meshes(&self, meshes: &[usize]) -> Result<Vec<u8>, MapGeometryError> {
        Ok(encode_map_meshes(&self.asset, meshes)?)
    }

    /// Applies `edit` as one undo step and returns the changes a viewport draws.
    ///
    /// # Errors
    ///
    /// Fails if a mesh or submesh index is out of bounds, a hash is malformed or `ltk_mapgeo`
    /// refuses the change. A refused edit leaves the document unchanged.
    pub fn edit(&mut self, edit: MapGeometryEdit) -> Result<Vec<MeshDelta>, MapGeometryError> {
        let step = self.step_of(edit)?;
        let (inverse, deltas) = self.apply(step)?;
        self.undo.push(inverse);
        if self.undo.len() > HISTORY_DEPTH {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.revision += 1;
        Ok(deltas)
    }

    /// Reverts the last edit and returns the changes a viewport draws, or `None` if there is
    /// no edit to revert.
    ///
    /// # Errors
    ///
    /// Fails if `ltk_mapgeo` refuses to put a removed mesh back.
    pub fn undo(&mut self) -> Result<Option<Vec<MeshDelta>>, MapGeometryError> {
        let Some(step) = self.undo.pop() else {
            return Ok(None);
        };
        let (inverse, deltas) = self.apply(step)?;
        self.redo.push(inverse);
        self.revision += 1;
        Ok(Some(deltas))
    }

    /// Applies the last undone edit again and returns the changes a viewport draws, or `None`
    /// if there is none.
    ///
    /// # Errors
    ///
    /// As [`MapGeometryDocument::undo`].
    pub fn redo(&mut self) -> Result<Option<Vec<MeshDelta>>, MapGeometryError> {
        let Some(step) = self.redo.pop() else {
            return Ok(None);
        };
        let (inverse, deltas) = self.apply(step)?;
        self.undo.push(inverse);
        self.revision += 1;
        Ok(Some(deltas))
    }

    /// Bakes the scene graphs and writes the map as version 18.
    ///
    /// # Errors
    ///
    /// Fails if the bake or the writer refuses the map.
    pub fn to_bytes(&mut self) -> Result<Vec<u8>, MapGeometryError> {
        let graphs = self.asset.bake_scene_graphs(&self.selection)?;
        self.asset.replace_scene_graphs(graphs);

        let mut out = Vec::new();
        self.asset.to_writer(&mut out)?;
        Ok(out)
    }

    /// Records that `bytes`, from [`MapGeometryDocument::to_bytes`], are on disk.
    pub fn saved_as(&mut self, bytes: &[u8]) {
        self.base = xxh64(bytes, 0);
        self.saved = self.revision;
    }

    fn describe(&self, at: usize) -> MapGeometryMesh {
        let mesh = &self.asset.meshes()[at];
        let bounds = mesh.bounding_box();
        MapGeometryMesh {
            index: at as u32,
            transform: mesh.transform().to_cols_array(),
            min: bounds.min.to_array(),
            max: bounds.max.to_array(),
            visibility: mesh.visibility().bits(),
            controller: hash_text(mesh.visibility_controller_path_hash()),
            region: hash_text(mesh.region_path_hash()),
            quality: mesh.quality().bits(),
            backface_culling_disabled: mesh.disable_backface_culling(),
            vertex_count: mesh.vertex_count(),
            materials: mesh
                .submeshes()
                .iter()
                .map(|submesh| submesh.material().to_owned())
                .collect(),
        }
    }

    /// The index of `mesh`, checked against the meshes.
    fn index(&self, mesh: u32) -> Result<usize, MapGeometryError> {
        let at = mesh as usize;
        if at < self.asset.mesh_count() {
            Ok(at)
        } else {
            Err(MapGeometryError::NoMesh(mesh))
        }
    }

    /// States `edit` as the step that makes it, checking every index first.
    fn step_of(&self, edit: MapGeometryEdit) -> Result<Step, MapGeometryError> {
        let changed = |meshes: Vec<u32>, change: &dyn Fn(&mut MeshProps)| {
            meshes
                .into_iter()
                .map(|mesh| {
                    let at = self.index(mesh)?;
                    let mut next = MeshProps::of(&self.asset.meshes()[at]);
                    change(&mut next);
                    Ok((at, next))
                })
                .collect::<Result<Vec<_>, MapGeometryError>>()
                .map(Step::Restore)
        };

        match edit {
            MapGeometryEdit::Transform { meshes } => {
                let mut records = Vec::with_capacity(meshes.len());
                for each in meshes {
                    let at = self.index(each.mesh)?;
                    let mut next = MeshProps::of(&self.asset.meshes()[at]);
                    next.transform = Mat4::from_cols_array(&each.transform);
                    records.push((at, next));
                }
                Ok(Step::Restore(records))
            }
            MapGeometryEdit::Region { meshes, region } => {
                let hash = optional_hash(region)?;
                changed(meshes, &|props| props.region = hash)
            }
            MapGeometryEdit::Controller { meshes, controller } => {
                let hash = optional_hash(controller)?;
                changed(meshes, &|props| props.controller = hash)
            }
            MapGeometryEdit::Material {
                mesh,
                submesh,
                material,
            } => {
                let at = self.index(mesh)?;
                let mut next = MeshProps::of(&self.asset.meshes()[at]);
                *next
                    .materials
                    .get_mut(submesh as usize)
                    .ok_or(MapGeometryError::NoSubmesh { mesh, submesh })? = material;
                Ok(Step::Restore(vec![(at, next)]))
            }
            MapGeometryEdit::Visibility { meshes, mask } => changed(meshes, &|props| {
                props.visibility = EnvironmentVisibility::from_bits_retain(mask);
            }),
            MapGeometryEdit::Quality { meshes, mask } => changed(meshes, &|props| {
                props.quality = EnvironmentQuality::from_bits_retain(mask);
            }),
            MapGeometryEdit::BackfaceCulling { meshes, disabled } => {
                changed(meshes, &|props| props.culling_disabled = disabled)
            }
            MapGeometryEdit::Duplicate { meshes } => {
                let count = self.asset.mesh_count();
                let sources = meshes
                    .into_iter()
                    .map(|mesh| self.index(mesh))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Step::Insert(
                    sources
                        .into_iter()
                        .enumerate()
                        .map(|(offset, at)| self.take(at, count + offset))
                        .collect(),
                ))
            }
            MapGeometryEdit::Remove { meshes } => {
                let mut indices = meshes
                    .into_iter()
                    .map(|mesh| self.index(mesh))
                    .collect::<Result<Vec<_>, _>>()?;
                indices.sort_unstable_by(|a, b| b.cmp(a));
                indices.dedup();
                Ok(Step::Remove(indices))
            }
            MapGeometryEdit::Import {
                source,
                meshes,
                scale,
                up,
                materials,
                visibility,
                controller,
                transform,
            } => {
                let model = read_model(Path::new(&source))?;
                let controller = optional_hash(controller)?;
                let transform = Mat4::from_cols_array(&transform);
                let count = self.asset.mesh_count();

                let mut taken = Vec::new();
                for at in meshes {
                    let mesh = model
                        .meshes
                        .get(at as usize)
                        .ok_or(MapGeometryError::NoSourceMesh(at))?;
                    for lowered in lower(mesh, scale, up) {
                        let submeshes = lowered
                            .submeshes
                            .iter()
                            .map(|submesh| {
                                let material = materials
                                    .get(submesh.material)
                                    .ok_or(MapGeometryError::NoSourceMaterial(submesh.material))?;
                                Ok(EnvironmentSubmesh::new(
                                    material.clone(),
                                    submesh.start_index as i32,
                                    submesh.index_count as i32,
                                    submesh.min_vertex as i32,
                                    submesh.max_vertex as i32,
                                ))
                            })
                            .collect::<Result<Vec<_>, MapGeometryError>>()?;

                        let mut mesh = EnvironmentMesh::new(submeshes);
                        mesh.set_visibility(EnvironmentVisibility::from_bits_retain(visibility));
                        mesh.set_visibility_controller_path_hash(controller);
                        taken.push(Taken {
                            index: count + taken.len(),
                            mesh,
                            /* Every face, so the save bakes the new mesh into the ground and
                            picking scene graph of its controller and region. */
                            mask: FaceMask::all(lowered.indices.count() / 3),
                            vertex_buffers: vec![lowered.vertices],
                            index_buffer: lowered.indices,
                            transform,
                        });
                    }
                }
                if taken.is_empty() {
                    return Err(MapGeometryError::EmptyImport);
                }
                Ok(Step::Insert(taken))
            }
            MapGeometryEdit::Reimport {
                mesh,
                source,
                source_mesh,
                scale,
                up,
            } => {
                let at = self.index(mesh)?;
                let model = read_model(Path::new(&source))?;
                let replacement = model
                    .meshes
                    .get(source_mesh as usize)
                    .ok_or(MapGeometryError::NoSourceMesh(source_mesh))?;
                self.reimport_step(at, replacement, scale, up)
            }
        }
    }

    /// Returns the step that replaces the mesh at `at` with `replacement`.
    fn reimport_step(
        &self,
        at: usize,
        replacement: &SourceMesh,
        scale: f32,
        up: UpAxis,
    ) -> Result<Step, MapGeometryError> {
        let existing = &self.asset.meshes()[at];
        let materials: Vec<String> = MeshProps::of(existing).materials;
        let mut order: Vec<usize> = Vec::new();
        for part in &replacement.parts {
            if !order.contains(&part.material) {
                order.push(part.material);
            }
        }
        let material_of = |source: usize| {
            let rank = order.iter().position(|&each| each == source).unwrap_or(0);
            materials
                .get(rank)
                .or(materials.last())
                .cloned()
                .unwrap_or_default()
        };

        let mut taken = Vec::new();
        for lowered in lower(replacement, scale, up) {
            let submeshes = lowered
                .submeshes
                .iter()
                .map(|submesh| {
                    EnvironmentSubmesh::new(
                        material_of(submesh.material),
                        submesh.start_index as i32,
                        submesh.index_count as i32,
                        submesh.min_vertex as i32,
                        submesh.max_vertex as i32,
                    )
                })
                .collect();

            let mut mesh = EnvironmentMesh::new(submeshes);
            mesh.set_visibility(existing.visibility());
            mesh.set_visibility_controller_path_hash(existing.visibility_controller_path_hash());
            mesh.set_quality(existing.quality());
            mesh.set_disable_backface_culling(existing.disable_backface_culling());
            mesh.set_render_flags(existing.render_flags());
            mesh.set_layer_transition_behavior(existing.layer_transition_behavior());
            mesh.set_baked_light(existing.baked_light().clone());
            mesh.set_stationary_light(existing.stationary_light().clone());
            mesh.set_baked_paint(existing.baked_paint().clone());
            mesh.set_texture_overrides(existing.texture_overrides().to_vec());
            taken.push(Taken {
                index: at + taken.len(),
                mesh,
                mask: FaceMask::all(lowered.indices.count() / 3),
                vertex_buffers: vec![lowered.vertices],
                index_buffer: lowered.indices,
                transform: Mat4::IDENTITY,
            });
        }
        if taken.is_empty() {
            return Err(MapGeometryError::EmptyImport);
        }

        /* `ltk_mapgeo` sets a region through the asset, which recomputes the bounds, so the
        region is set after the new meshes are inserted. */
        let region = existing.region_path_hash();
        let regions: Vec<(usize, MeshProps)> = taken
            .iter()
            .map(|each| {
                let mut props = MeshProps::of(&each.mesh);
                props.region = region;
                (each.index, props)
            })
            .collect();

        let mut steps = vec![Step::Remove(vec![at]), Step::Insert(taken)];
        if region != 0 {
            steps.push(Step::Restore(regions));
        }
        Ok(Step::Sequence(steps))
    }

    /// Applies `props` to the mesh at `at` through the setters. The transform and the region
    /// recompute its bounding box from the buffers.
    fn set_props(&mut self, at: usize, props: &MeshProps) -> Result<(), EditError> {
        let current = MeshProps::of(&self.asset.meshes()[at]);
        if current.region != props.region {
            self.asset.set_mesh_region_path_hash(at, props.region)?;
        }
        if current.transform != props.transform {
            self.asset.set_mesh_transform(at, props.transform)?;
        }

        let mesh = &mut self.asset.meshes_mut()[at];
        mesh.set_visibility_controller_path_hash(props.controller);
        mesh.set_visibility(props.visibility);
        mesh.set_quality(props.quality);
        mesh.set_disable_backface_culling(props.culling_disabled);
        for (submesh, material) in mesh.submeshes_mut().iter_mut().zip(&props.materials) {
            if submesh.material() != material {
                submesh.set_material(material.clone());
            }
        }
        Ok(())
    }

    /// Copies mesh `at` with its buffers and scene graph mask, to land at `index`.
    fn take(&self, at: usize, index: usize) -> Taken {
        let mesh = &self.asset.meshes()[at];
        Taken {
            index,
            mesh: mesh.clone(),
            vertex_buffers: mesh
                .vertex_buffer_ids()
                .iter()
                .filter_map(|&id| self.asset.vertex_buffer(id).cloned())
                .collect(),
            index_buffer: self
                .asset
                .index_buffer(mesh.index_buffer_id())
                .cloned()
                .expect("a mesh names an index buffer the asset holds"),
            mask: self.selection.mesh(at).cloned().unwrap_or_default(),
            transform: *mesh.transform(),
        }
    }

    /// Applies `step` and returns the step that reverts it with the changes it made.
    fn apply(&mut self, step: Step) -> Result<(Step, Vec<MeshDelta>), MapGeometryError> {
        match step {
            Step::Restore(records) => {
                let mut previous: Vec<(usize, MeshProps)> = Vec::with_capacity(records.len());
                let mut deltas = Vec::with_capacity(records.len());
                for (at, props) in records {
                    let held = MeshProps::of(&self.asset.meshes()[at]);
                    if let Err(error) = self.set_props(at, &props) {
                        /* Put back the meshes this step set, so a refusal changes nothing. */
                        self.set_props(at, &held)?;
                        for (done, props) in previous.iter().rev() {
                            self.set_props(*done, props)?;
                        }
                        return Err(error.into());
                    }
                    deltas.push(MeshDelta::Update {
                        mesh: at as u32,
                        from: held.transform.to_cols_array(),
                        record: Box::new(self.describe(at)),
                    });
                    previous.push((at, held));
                }
                previous.reverse();
                Ok((Step::Restore(previous), deltas))
            }
            Step::Remove(indices) => {
                let mut taken = Vec::with_capacity(indices.len());
                let mut deltas = Vec::with_capacity(indices.len());
                for at in indices {
                    let copy = self.take(at, at);
                    self.asset.remove_mesh(at);
                    self.selection.remove_mesh(at);
                    taken.push(copy);
                    deltas.push(MeshDelta::Remove { mesh: at as u32 });
                }
                taken.reverse();
                Ok((Step::Insert(taken), deltas))
            }
            Step::Insert(taken) => {
                let mut indices = Vec::with_capacity(taken.len());
                for (done, each) in taken.iter().enumerate() {
                    if let Err(error) = self.asset.insert_mesh(
                        each.index,
                        each.mesh.clone(),
                        each.vertex_buffers.clone(),
                        each.index_buffer.clone(),
                    ) {
                        /* Take back the meshes this step inserted, so a refusal changes nothing. */
                        for landed in taken[..done].iter().rev() {
                            self.asset.remove_mesh(landed.index);
                            self.selection.remove_mesh(landed.index);
                        }
                        return Err(error.into());
                    }
                    if *self.asset.meshes()[each.index].transform() != each.transform {
                        self.asset
                            .set_mesh_transform(each.index, each.transform)
                            .expect("insert_mesh refuses a mesh without positions");
                    }
                    self.selection.insert_mesh(each.index, each.mask.clone());
                    indices.push(each.index);
                }
                let deltas = indices
                    .iter()
                    .map(|&at| MeshDelta::Insert { mesh: at as u32 })
                    .collect();
                indices.reverse();
                Ok((Step::Remove(indices), deltas))
            }
            Step::Sequence(steps) => {
                let mut inverses = Vec::with_capacity(steps.len());
                let mut deltas = Vec::new();
                for step in steps {
                    match self.apply(step) {
                        Ok((inverse, more)) => {
                            inverses.push(inverse);
                            deltas.extend(more);
                        }
                        Err(error) => {
                            /* Reverts the applied steps so that a failed sequence leaves the
                            map unchanged. */
                            for inverse in inverses.into_iter().rev() {
                                self.apply(inverse)?;
                            }
                            return Err(error);
                        }
                    }
                }
                inverses.reverse();
                Ok((Step::Sequence(inverses), deltas))
            }
        }
    }
}

/// `hash` as `0x` and eight hex digits, and none for zero.
fn hash_text(hash: u32) -> Option<String> {
    (hash != 0).then(|| format!("0x{hash:08x}"))
}

/// Reads `0x` and eight hex digits.
fn parse_hash(text: &str) -> Option<u32> {
    u32::from_str_radix(text.strip_prefix("0x")?, 16).ok()
}

/// Reads an optional hash, zero for none.
fn optional_hash(text: Option<String>) -> Result<u32, MapGeometryError> {
    match text {
        None => Ok(0),
        Some(text) => parse_hash(&text).ok_or(MapGeometryError::Hash(text)),
    }
}

#[cfg(test)]
mod tests;
