//! The `Ground off navgrid` check: the walkable cells of a navigation grid whose height the
//! map's ground does not match. docs/plans/navgrid-guides.md, section 3.8.

use std::collections::HashMap;
use std::io::Cursor;

use glam::Vec3;
use ltk_manager_assets::preview::{PreviewError, for_each_mesh_triangle, is_region_anchored};
use ltk_manager_base::error::{AppError, AppResult};
use ltk_manager_base::hashing::HexBinHash;
use ltk_mapgeo::EnvironmentAsset;
use ltk_navgrid::{CellFlags, NavGrid};
use serde::{Deserialize, Serialize};

/// The least `y` of a unit normal that makes a triangle ground. A steeper triangle is a wall
/// or a cliff.
const UPWARD: f32 = 0.7;

/// The layer mask of a mesh that every visibility flag shows.
const EVERY_LAYER: u8 = 0xFF;

/// The most pairs of a ground triangle and a cell that the check indexes. 16,777,216 pairs of
/// `u32` triangle indices are 64 MiB.
const MAX_BUCKET_ENTRIES: usize = 1 << 24;

/// The meshes that a viewport draws: the visibility flags it shows and the state of each
/// visibility controller that it computed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ShownMeshes {
    /// The visibility layer mask.
    pub flags: u8,
    /// The visibility of each controller, by path hash. A mesh whose controller has no entry
    /// is shown by its layer mask.
    pub controllers: HashMap<HexBinHash, bool>,
}

impl ShownMeshes {
    /// Returns `true` if a mesh with the layer mask `mask` and the controller `controller` is
    /// drawn. `controller` is 0 for a mesh without a controller.
    #[must_use]
    pub fn shows(&self, mask: u8, controller: u32) -> bool {
        let state = (controller != 0)
            .then(|| {
                self.controllers
                    .get(&HexBinHash::from(ltk_hash::BinHash(controller)))
            })
            .flatten();

        state
            .copied()
            .unwrap_or(mask == EVERY_LAYER || mask & self.flags != 0)
    }
}

/// Why a cell fails the check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ConformanceKind {
    /// The ground nearest to the navigation grid differs from it by more than the threshold.
    OffGround,
    /// No ground triangle covers the cell center.
    Uncovered,
}

/// A 4-connected area of cells that fail the check for the same reason.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ConformanceArea {
    /// The reason that every cell of the area fails.
    pub kind: ConformanceKind,
    /// The number of cells.
    pub cells: u32,
    /// The ground height minus the navigation grid height with the largest magnitude, in world
    /// units. 0 for an [`ConformanceKind::Uncovered`] area.
    pub max_delta: f32,
    /// The mean world `x` and `z` of the cell centers.
    pub center: [f32; 2],
}

/// One ground triangle, with the denominator of its barycentric coordinates on `x` and `z`.
#[derive(Debug, Clone, Copy)]
struct Triangle {
    corners: [Vec3; 3],
    denominator: f32,
}

/// The ground triangles of a map: the triangles whose normal points up.
#[derive(Debug, Clone, Default)]
pub struct Ground {
    triangles: Vec<Triangle>,
}

impl Ground {
    /// Returns the ground of `triangles`, each with a vector that points to its front side,
    /// such as the sum of its vertex normals. Skips a triangle that is not ground.
    #[must_use]
    pub fn from_triangles(triangles: impl IntoIterator<Item = ([Vec3; 3], Vec3)>) -> Self {
        let mut ground = Self::default();
        for (corners, front) in triangles {
            ground.push(corners, front);
        }

        ground
    }

    /// Returns the ground of the meshes of `asset` that `shown` draws, in world space.
    ///
    /// Skips a region-anchored mesh, because the game places it through a map region and its
    /// own transform does not put it where it lands.
    ///
    /// # Errors
    ///
    /// Fails if a mesh that `shown` draws has no positions, or if one of its submeshes names
    /// indices or vertices that `asset` does not hold.
    pub fn from_map(asset: &EnvironmentAsset, shown: &ShownMeshes) -> AppResult<Self> {
        let mut ground = Self::default();

        for mesh in asset.meshes() {
            let drawn = shown.shows(
                mesh.visibility().bits(),
                mesh.visibility_controller_path_hash(),
            );
            if is_region_anchored(mesh) || !drawn {
                continue;
            }

            for_each_mesh_triangle(asset, mesh, |corners, [a, b, c]| {
                ground.push(corners, a + b + c);
            })?;
        }

        Ok(ground)
    }

    /// Reads the `.mapgeo` `bytes` and returns the ground of the meshes that `shown` draws.
    ///
    /// # Errors
    ///
    /// Fails if `bytes` is not a `.mapgeo` that `ltk_mapgeo` reads, and for the reasons that
    /// [`Ground::from_map`] documents.
    pub fn read(bytes: &[u8], shown: &ShownMeshes) -> AppResult<Self> {
        let asset =
            EnvironmentAsset::from_reader(&mut Cursor::new(bytes)).map_err(PreviewError::from)?;

        Self::from_map(&asset, shown)
    }

    /// Returns the number of ground triangles.
    #[must_use]
    pub fn len(&self) -> usize {
        self.triangles.len()
    }

    /// Returns `true` if the ground has no triangle.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.triangles.is_empty()
    }

    fn push(&mut self, corners: [Vec3; 3], front: Vec3) {
        let [a, b, c] = corners;
        let mut normal = (b - a).cross(c - a);
        let length = normal.length();
        if !(length > 0.0 && length.is_finite()) {
            return;
        }

        normal /= length;
        if front.length_squared() > 0.0 {
            if normal.dot(front) < 0.0 {
                normal = -normal;
            }
        } else {
            normal.y = normal.y.abs();
        }
        if normal.y < UPWARD {
            return;
        }

        self.triangles.push(Triangle {
            corners,
            denominator: (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z),
        });
    }
}

impl Triangle {
    /// Returns the height of the triangle at world `x` and `z`. Returns `None` if the point is
    /// outside the triangle.
    fn height_at(&self, x: f32, z: f32) -> Option<f32> {
        /* Points on a shared edge count for both triangles, so a seam leaves no gap. */
        const EDGE: f32 = -1e-5;

        let [a, b, c] = self.corners;
        let first = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / self.denominator;
        let second = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / self.denominator;
        let third = 1.0 - first - second;

        (first >= EDGE && second >= EDGE && third >= EDGE)
            .then_some(first * a.y + second * b.y + third * c.y)
    }
}

/// Returns the areas of walkable cells of `grid` whose ground differs from the grid height by
/// more than `threshold`, or that no ground triangle covers, largest first.
///
/// A cell is walkable if it has no `WALL` bit. The grid height of a cell is
/// [`NavGrid::sampled_height_at`] at its center. A cell outside the samples is skipped. The
/// ground height is the height of the ground triangle at the cell center nearest to the grid
/// height. `threshold` is finite and not negative, and the caller validates it.
///
/// # Errors
///
/// Fails if the ground triangles and the cells whose centers their bounds contain make more
/// than 16,777,216 pairs, or if the ground has more than `u32::MAX` triangles.
pub fn conformance_areas(
    grid: &NavGrid,
    ground: &Ground,
    threshold: f32,
) -> AppResult<Vec<ConformanceArea>> {
    let buckets = Buckets::of(grid, ground)?;
    let failures: Vec<Option<(ConformanceKind, f32)>> = grid
        .cells()
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            if cell.flags.contains(CellFlags::WALL) {
                return None;
            }

            let (x, z) = cell_center(grid, index)?;
            let expected = grid.sampled_height_at(Vec3::new(x, 0.0, z))?;
            let nearest = buckets
                .triangles(index)
                .filter_map(|triangle| ground.triangles[triangle].height_at(x, z))
                .map(|height| height - expected)
                .min_by(|a, b| a.abs().total_cmp(&b.abs()));

            match nearest {
                None => Some((ConformanceKind::Uncovered, 0.0)),
                Some(delta) if delta.abs() > threshold => Some((ConformanceKind::OffGround, delta)),
                Some(_) => None,
            }
        })
        .collect();

    let mut areas = areas(grid, &failures);
    areas.sort_by_key(|area| std::cmp::Reverse(area.cells));
    Ok(areas)
}

/// Returns the world `x` and `z` of the center of the cell at `index`.
fn cell_center(grid: &NavGrid, index: usize) -> Option<(f32, f32)> {
    let (x, y) = grid.cell_coords(index)?;
    let center = grid.cell_center(x, y)?;

    Some((center.x, center.z))
}

/// Groups the failing cells of `failures` into 4-connected areas of one kind.
fn areas(grid: &NavGrid, failures: &[Option<(ConformanceKind, f32)>]) -> Vec<ConformanceArea> {
    let width = grid.x_cell_count() as usize;
    let mut visited = vec![false; failures.len()];
    let mut areas = Vec::new();
    let mut stack = Vec::new();

    for (start, failure) in failures.iter().enumerate() {
        let Some((kind, _)) = *failure else {
            continue;
        };
        if visited[start] {
            continue;
        }

        visited[start] = true;
        stack.push(start);
        let mut cells = 0u32;
        let mut max_delta = 0.0f32;
        let mut sum = [0.0f64; 2];

        while let Some(index) = stack.pop() {
            let delta = failures[index].map_or(0.0, |(_, delta)| delta);
            cells += 1;
            if delta.abs() > max_delta.abs() {
                max_delta = delta;
            }
            if let Some((x, z)) = cell_center(grid, index) {
                sum[0] += f64::from(x);
                sum[1] += f64::from(z);
            }

            let column = index % width;
            let neighbors = [
                (column > 0).then(|| index - 1),
                (column + 1 < width).then(|| index + 1),
                index.checked_sub(width),
                Some(index + width).filter(|next| *next < failures.len()),
            ];
            for next in neighbors.into_iter().flatten() {
                if !visited[next] && failures[next].is_some_and(|(other, _)| other == kind) {
                    visited[next] = true;
                    stack.push(next);
                }
            }
        }

        let count = f64::from(cells);
        areas.push(ConformanceArea {
            kind,
            cells,
            max_delta,
            center: [(sum[0] / count) as f32, (sum[1] / count) as f32],
        });
    }

    areas
}

/// The ground triangles whose `x` and `z` bounds contain each cell center, by cell index.
struct Buckets {
    /// The first entry of each cell in `triangles`, and the end of the last cell.
    starts: Vec<usize>,
    triangles: Vec<u32>,
}

impl Buckets {
    /// Returns the buckets of the triangles of `ground` over the cells of `grid`.
    ///
    /// # Errors
    ///
    /// Fails if the buckets hold more than `MAX_BUCKET_ENTRIES` entries, or if a triangle
    /// index does not fit a `u32`.
    fn of(grid: &NavGrid, ground: &Ground) -> AppResult<Self> {
        let cells = grid.cells().len();
        let triangle_count = u32::try_from(ground.triangles.len()).map_err(|_| {
            AppError::ValidationFailed(format!(
                "The map has {} ground triangles, more than the conformance check reads. Hide \
                 meshes and run the check again.",
                ground.triangles.len()
            ))
        })?;
        let ranges: Vec<Option<CellRange>> = ground
            .triangles
            .iter()
            .map(|triangle| CellRange::of(grid, triangle))
            .collect();

        let total = ranges
            .iter()
            .flatten()
            .try_fold(0usize, |total, range| total.checked_add(range.len()?));
        let total = match total {
            Some(total) if total <= MAX_BUCKET_ENTRIES => total,
            _ => {
                return Err(AppError::ValidationFailed(format!(
                    "The ground of the map makes more than {MAX_BUCKET_ENTRIES} pairs of a \
                     triangle and a cell, so the conformance check did not run. Hide meshes and \
                     run the check again."
                )));
            }
        };

        let mut starts = vec![0usize; cells + 1];
        for range in ranges.iter().flatten() {
            range.for_each(grid, |cell| starts[cell + 1] += 1);
        }
        for cell in 0..cells {
            starts[cell + 1] += starts[cell];
        }

        let mut next = starts.clone();
        let mut triangles = vec![0u32; total];
        for (triangle, range) in (0..triangle_count).zip(&ranges) {
            let Some(range) = range else {
                continue;
            };
            range.for_each(grid, |cell| {
                triangles[next[cell]] = triangle;
                next[cell] += 1;
            });
        }

        Ok(Self { starts, triangles })
    }

    fn triangles(&self, cell: usize) -> impl Iterator<Item = usize> + '_ {
        self.triangles[self.starts[cell]..self.starts[cell + 1]]
            .iter()
            .map(|&triangle| triangle as usize)
    }
}

/// The cells whose centers a triangle's `x` and `z` bounds contain.
#[derive(Debug, Clone, Copy)]
struct CellRange {
    x: (u32, u32),
    y: (u32, u32),
}

impl CellRange {
    /// Returns the cells of `grid` whose centers the bounds of `triangle` contain. Returns
    /// `None` if they contain no cell center.
    fn of(grid: &NavGrid, triangle: &Triangle) -> Option<Self> {
        let min = grid.min_position();
        let size = grid.cell_size();
        let [a, b, c] = triangle.corners;

        /* Cell `i` has its center at `min + (i + 0.5) * size`. */
        let span = |low: f32, high: f32, origin: f32, count: u32| {
            let first = ((low - origin) / size - 0.5).ceil().max(0.0);
            let last = ((high - origin) / size - 0.5)
                .floor()
                .min(count as f32 - 1.0);
            (first <= last).then_some((first as u32, last as u32))
        };

        Some(Self {
            x: span(
                a.x.min(b.x).min(c.x),
                a.x.max(b.x).max(c.x),
                min.x,
                grid.x_cell_count(),
            )?,
            y: span(
                a.z.min(b.z).min(c.z),
                a.z.max(b.z).max(c.z),
                min.z,
                grid.y_cell_count(),
            )?,
        })
    }

    /// Returns the number of cells. Returns `None` if the number does not fit a `usize`.
    fn len(&self) -> Option<usize> {
        let span = |(first, last): (u32, u32)| usize::try_from(u64::from(last - first) + 1).ok();

        span(self.x)?.checked_mul(span(self.y)?)
    }

    fn for_each(&self, grid: &NavGrid, mut visit: impl FnMut(usize)) {
        let width = grid.x_cell_count() as usize;
        for y in self.y.0..=self.y.1 {
            for x in self.x.0..=self.x.1 {
                visit(x as usize + y as usize * width);
            }
        }
    }
}

#[cfg(test)]
mod tests;
