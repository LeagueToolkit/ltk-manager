//! Written missile inputs for an isolated spell preview.

use ltk_hash::{BinHash, Hash as _};
use ltk_meta::{PropertyValueEnum, walk::Leaf};
use serde::Serialize;

use ltk_manager_core::bin_document::{
    BinDocument, BinDocumentError, Fields, fields_of, hex, leaf, object_at,
};
use ltk_manager_core::hashing::named;

mod catalog;

pub use catalog::{CharacterSpell, SpellCatalog, character_spells};

/// A field the isolated preview cannot evaluate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SpellIssue {
    /// The named property path within the spell object.
    pub path: String,
    /// Whether the field is malformed or needs an unimplemented behavior.
    pub kind: SpellIssueKind,
}

/// Why a missile field could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SpellIssueKind {
    /// A written value has the wrong type or is not finite.
    Invalid,
    /// The isolated preview does not evaluate this field.
    Unsupported,
}

/// The movement class and its written speed or duration.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MissileMovement {
    /// Constant speed in engine units per second.
    FixedSpeed { speed: Option<f32> },
    /// A fixed travel duration in seconds.
    FixedTime { duration: Option<f32> },
    /// A class whose trajectory is not implemented.
    Unsupported { class_hash: String },
    /// No movement component was written.
    Missing,
}

/// A missile's written placement inputs, with omitted values kept absent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MissileSpec {
    /// The movement component.
    pub movement: MissileMovement,
    /// The written launch delay, without the spell's cast timing added.
    pub start_delay: Option<f32>,
    /// The requested launch bone, which an isolated preview replaces with a point.
    pub start_bone: Option<String>,
    /// The requested target bone, which an isolated preview replaces with a point.
    pub target_bone: Option<String>,
    /// The target's height adjustment.
    pub target_height: Option<f32>,
    /// The initial target-height offset.
    pub initial_target_height: Option<f32>,
}

/// The spell's missile and flight-effect references before skin resolution.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SpellPreview {
    /// The written `spellCastTime`, in seconds.
    pub spell_cast_time: Option<f32>,
    /// The written `mCastTime`, kept separate from `spellCastTime`.
    pub cast_time: Option<f32>,
    /// Whether the spell explicitly enables its hit effect.
    pub have_hit_effect: Option<bool>,
    /// The hit effect's skin resolver key.
    pub hit_effect_key: Option<String>,
    /// The hit effect's written fallback name.
    pub hit_effect_name: Option<String>,
    /// The seven written display ranges, including rank zero.
    pub cast_range_display: Option<Vec<f32>>,
    /// The seven legacy cast ranges, including rank zero.
    pub cast_range: Option<Vec<f32>>,
    /// The seven ranges in `castRangeValues.values`.
    pub cast_range_values: Option<Vec<f32>>,
    /// The seven primary area radii.
    pub cast_radius: Option<Vec<f32>>,
    /// The seven secondary area radii.
    pub cast_radius_secondary: Option<Vec<f32>>,
    /// The written cone angle in degrees.
    pub cast_cone_angle: Option<f32>,
    /// The written cone distance in engine units.
    pub cast_cone_distance: Option<f32>,
    /// The written animation-graph clip name, absent when the spell omits it.
    pub animation_name: Option<String>,
    /// The missile specification, absent for spells without one.
    pub missile: Option<MissileSpec>,
    /// A resource key, never a system-object identity.
    pub effect_key: Option<String>,
    /// The written fallback effect name, retained for inspection.
    pub effect_name: Option<String>,
    /// Fields requiring correction or an explicit preview approximation.
    pub issues: Vec<SpellIssue>,
}

/// The `SpellObject` field embedding the spell's `SpellDataResource`.
const SPELL_DATA: BinHash = named("mSpell");

/// The `SpellDataResource` the fields of a `SpellObject` embed, where they embed one.
#[must_use]
pub fn spell_data(object: &Fields) -> Option<&Fields> {
    fields_of(object.get(&SPELL_DATA))
}

/// The selected spell's missile inputs, without schema defaults or script execution.
///
/// # Errors
///
/// Fails when `entry` is not an object of `document`.
pub fn read_spell(
    document: &BinDocument,
    entry: BinHash,
) -> Result<SpellPreview, BinDocumentError> {
    let object = object_at(document, entry)?;
    let mut read = Read { issues: Vec::new() };
    let mut preview = SpellPreview::default();
    if object.class_hash != h("SpellObject") {
        read.issue("", SpellIssueKind::Invalid);
    } else if let Some((_, spell)) = read.pointer(
        &object.properties,
        "mSpell",
        "mSpell",
        Some("SpellDataResource"),
    ) {
        preview.spell_cast_time = read.number(spell, "spellCastTime", "mSpell");
        preview.cast_time = read.number(spell, "mCastTime", "mSpell");
        preview.have_hit_effect = read.boolean(spell, "bHaveHitEffect", "mSpell");
        preview.hit_effect_key = read.hash(spell, "mHitEffectKey", "mSpell");
        preview.hit_effect_name = read.string(spell, "mHitEffectName", "mSpell");
        preview.cast_range_display = read.ranks(spell, "castRangeDisplayOverride", "mSpell");
        preview.cast_range = read.ranks(spell, "castRange", "mSpell");
        preview.cast_radius = read.ranks(spell, "castRadius", "mSpell");
        preview.cast_radius_secondary = read.ranks(spell, "castRadiusSecondary", "mSpell");
        preview.cast_cone_angle = read.number(spell, "castConeAngle", "mSpell");
        preview.cast_cone_distance = read.number(spell, "castConeDistance", "mSpell");
        if let Some(value) = spell.get(&h("castRangeValues")) {
            // The unnamed rank-value class declared by castRangeValues in the meta schema.
            if let PropertyValueEnum::Embedded(inner) = value
                && inner.0.class_hash == BinHash(0x0a0e_ddc9)
            {
                preview.cast_range_values =
                    read.ranks(&inner.0.properties, "values", "mSpell.castRangeValues");
            } else {
                read.issue("mSpell.castRangeValues", SpellIssueKind::Invalid);
            }
        }
        preview.animation_name = read.string(spell, "mAnimationName", "mSpell");
        preview.effect_key = match spell.get(&h("mMissileEffectKey")) {
            None => None,
            Some(value) => match leaf(Some(value)) {
                Some(Leaf::Hash(key)) if key.0 != 0 => Some(hex(key)),
                Some(Leaf::Hash(_)) => None,
                _ => {
                    read.issue("mSpell.mMissileEffectKey", SpellIssueKind::Invalid);
                    None
                }
            },
        };
        preview.effect_name = read.string(spell, "mMissileEffectName", "mSpell");
        if let Some((_, missile)) = read.pointer(
            spell,
            "mMissileSpec",
            "mSpell.mMissileSpec",
            Some("MissileSpecification"),
        ) {
            preview.missile = Some(read.missile(missile));
        }
        read.unhandled(
            spell,
            "mSpell",
            &[
                "mResourceResolvers",
                "mMissileEffectPlayerKey",
                "mMissileEffectEnemyKey",
                "mMissileEffectPlayerName",
                "mMissileEffectEnemyName",
                "mParticleStartOffset",
            ],
        );
    }
    preview.issues = read.issues;
    Ok(preview)
}

fn h(name: &str) -> BinHash {
    BinHash::hash_str(name)
}

struct Read {
    issues: Vec<SpellIssue>,
}

impl Read {
    fn boolean(&mut self, fields: &Fields, name: &str, parent: &str) -> Option<bool> {
        let value = fields.get(&h(name))?;
        if let Some(Leaf::Bool(value)) = leaf(Some(value)) {
            Some(value)
        } else {
            self.issue(&format!("{parent}.{name}"), SpellIssueKind::Invalid);
            None
        }
    }

    fn hash(&mut self, fields: &Fields, name: &str, parent: &str) -> Option<String> {
        let value = fields.get(&h(name))?;
        match leaf(Some(value)) {
            Some(Leaf::Hash(key)) if key.0 != 0 => Some(hex(key)),
            Some(Leaf::Hash(_)) => None,
            _ => {
                self.issue(&format!("{parent}.{name}"), SpellIssueKind::Invalid);
                None
            }
        }
    }

    fn ranks(&mut self, fields: &Fields, name: &str, parent: &str) -> Option<Vec<f32>> {
        let value = fields.get(&h(name))?;
        if let PropertyValueEnum::Container(container) = value
            && container.items().len() == 7
        {
            let values: Option<Vec<f32>> = container
                .items()
                .iter()
                .map(|value| match leaf(Some(value)) {
                    Some(Leaf::F32(value)) if value.is_finite() => Some(value),
                    _ => None,
                })
                .collect();
            if values.is_some() {
                return values;
            }
        }
        self.issue(&format!("{parent}.{name}"), SpellIssueKind::Invalid);
        None
    }

    fn issue(&mut self, path: &str, kind: SpellIssueKind) {
        self.issues.push(SpellIssue {
            path: path.to_owned(),
            kind,
        });
    }

    fn pointer<'a>(
        &mut self,
        fields: &'a Fields,
        name: &str,
        path: &str,
        expected: Option<&str>,
    ) -> Option<(BinHash, &'a Fields)> {
        match fields.get(&h(name)) {
            None => None,
            Some(PropertyValueEnum::Struct(inner)) if inner.class_hash.0 == 0 => None,
            Some(PropertyValueEnum::Struct(inner))
                if expected.is_none_or(|name| inner.class_hash == h(name)) =>
            {
                Some((inner.class_hash, &inner.properties))
            }
            _ => {
                self.issue(path, SpellIssueKind::Invalid);
                None
            }
        }
    }

    fn number(&mut self, fields: &Fields, name: &str, parent: &str) -> Option<f32> {
        match fields.get(&h(name)) {
            None => None,
            Some(value) => match leaf(Some(value)) {
                Some(Leaf::F32(value)) if value.is_finite() => Some(value),
                _ => {
                    self.issue(&format!("{parent}.{name}"), SpellIssueKind::Invalid);
                    None
                }
            },
        }
    }

    fn string(&mut self, fields: &Fields, name: &str, parent: &str) -> Option<String> {
        match fields.get(&h(name)) {
            None => None,
            Some(value) => match leaf(Some(value)) {
                Some(Leaf::String(value)) => Some(value.to_owned()),
                _ => {
                    self.issue(&format!("{parent}.{name}"), SpellIssueKind::Invalid);
                    None
                }
            },
        }
    }

    fn unhandled(&mut self, fields: &Fields, parent: &str, names: &[&str]) {
        for name in names {
            if fields.contains_key(&h(name)) {
                self.issue(&format!("{parent}.{name}"), SpellIssueKind::Unsupported);
            }
        }
    }

    fn missile(&mut self, fields: &Fields) -> MissileSpec {
        const ROOT: &str = "mSpell.mMissileSpec";
        const MOVEMENT: &str = "mSpell.mMissileSpec.movementComponent";
        self.unhandled(
            fields,
            ROOT,
            &[
                "heightSolver",
                "verticalFacing",
                "behaviors",
                "missileGroupSpawners",
                "visibilityComponent",
                "MissileForce",
            ],
        );
        let movement = self.pointer(fields, "movementComponent", MOVEMENT, None);
        let mut spec = MissileSpec {
            movement: MissileMovement::Missing,
            start_delay: None,
            start_bone: None,
            target_bone: None,
            target_height: None,
            initial_target_height: None,
        };
        if let Some((class, fields)) = movement {
            spec.movement = if class == h("FixedSpeedMovement") {
                MissileMovement::FixedSpeed {
                    speed: self.number(fields, "mSpeed", MOVEMENT),
                }
            } else if class == h("FixedTimeMovement") {
                MissileMovement::FixedTime {
                    duration: self.number(fields, "mTravelTime", MOVEMENT),
                }
            } else {
                MissileMovement::Unsupported {
                    class_hash: hex(class),
                }
            };
            spec.start_delay = self.number(fields, "mStartDelay", MOVEMENT);
            spec.start_bone = self.string(fields, "mStartBoneName", MOVEMENT);
            spec.target_bone = self.string(fields, "mTargetBoneName", MOVEMENT);
            spec.target_height = self.number(fields, "mTargetHeightAugment", MOVEMENT);
            spec.initial_target_height =
                self.number(fields, "mOffsetInitialTargetHeight", MOVEMENT);
            self.unhandled(
                fields,
                MOVEMENT,
                &[
                    "mStartBoneSkinOverrides",
                    "mTracksTarget",
                    "mUseHeightOffsetAtEnd",
                    "mVisualsTrackHiddenTargets",
                    "AddBonusAttackRangeToCastRange",
                    "mInferDirectionFromFacingIfNeeded",
                    "mProjectTargetToCastRange",
                    "mUseGroundHeightAtTarget",
                ],
            );
        }
        spec
    }
}

#[cfg(test)]
mod tests;
