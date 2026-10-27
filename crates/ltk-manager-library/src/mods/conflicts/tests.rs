use super::*;

fn file(path: &str, content: u64) -> ScannedFile {
    ScannedFile {
        hash: ltk_overlay::utils::resolve_chunk_hash(Utf8Path::new(path), &[])
            .unwrap()
            .0,
        content,
        path: path.to_string(),
    }
}

fn named(id: &str) -> ConflictMod {
    ConflictMod {
        id: id.to_string(),
        name: id.to_string(),
    }
}

const ICON: &str = "assets/characters/zed/hud/icons2d/zed_q.dds";
const SKIN: &str = "data/characters/zed/skins/skin0.bin";

#[test]
fn shared_files_group_by_kind_and_champion() {
    let mods = vec![
        (named("skin"), vec![file(ICON, 1), file(SKIN, 1)]),
        (named("icons"), vec![file(ICON, 2)]),
    ];
    let groups = group(&mods);
    assert_eq!(groups.len(), 1);
    let (key, label, idxs, hashes) = &groups[0];
    assert_eq!(label, "Zed · Ability icons");
    assert_eq!(key, "Zed · Ability icons|icons,skin");
    assert_eq!(idxs, &vec![0, 1]);
    assert_eq!(hashes.len(), 1);
}

#[test]
fn identical_copies_are_not_a_conflict() {
    let mods = vec![
        (named("a"), vec![file(ICON, 7)]),
        (named("b"), vec![file(ICON, 7)]),
    ];
    assert!(group(&mods).is_empty());
}

#[test]
fn asset_kinds_follow_the_path() {
    assert_eq!(asset_kind(ICON), "Ability icons");
    assert_eq!(
        asset_kind("assets/characters/zed/skins/base/zed.skn"),
        "Model & textures"
    );
    assert_eq!(
        asset_kind("assets/characters/zed/skins/skin01/particles/q.dds"),
        "VFX"
    );
    assert_eq!(asset_kind("assets/sounds/wwise2016/vo/zed.wpk"), "Sounds");
    assert_eq!(asset_kind(SKIN), "Skin data");
    assert_eq!(asset_kind("data/characters/zed/zed.bin"), "Skin data");
}

/// A provider holding fixed raw overrides.
struct Fixed(Vec<(&'static str, Vec<u8>)>);

impl ModContentProvider for Fixed {
    fn mod_project(&mut self) -> ltk_overlay::Result<ModProject> {
        Ok(ltk_manager_assets::test_util::mod_project_named("fixed"))
    }
    fn list_layer_wads(&mut self, _: &str) -> ltk_overlay::Result<Vec<String>> {
        Ok(Vec::new())
    }
    fn read_wad_overrides(
        &mut self,
        _: &str,
        _: &str,
    ) -> ltk_overlay::Result<Vec<(Utf8PathBuf, Vec<u8>)>> {
        Ok(Vec::new())
    }
    fn read_raw_overrides(&mut self) -> ltk_overlay::Result<Vec<(Utf8PathBuf, Vec<u8>)>> {
        Ok(self
            .0
            .iter()
            .map(|(p, b)| (Utf8PathBuf::from(*p), b.clone()))
            .collect())
    }
    fn content_fingerprint(&self) -> ltk_overlay::Result<Option<u64>> {
        Ok(Some(42))
    }
    fn read_wad_override_file(
        &mut self,
        _: &str,
        _: &str,
        _: &Utf8Path,
    ) -> ltk_overlay::Result<Vec<u8>> {
        unreachable!()
    }
    fn read_raw_override_file(&mut self, _: &Utf8Path) -> ltk_overlay::Result<Vec<u8>> {
        unreachable!()
    }
}

#[test]
fn a_lost_file_never_reaches_the_build() {
    let icon = ltk_overlay::utils::resolve_chunk_hash(Utf8Path::new(ICON), &[])
        .unwrap()
        .0;
    let mut content = WithoutFiles {
        inner: Box::new(Fixed(vec![(ICON, vec![1]), (SKIN, vec![2])])),
        dropped: HashSet::from([icon]),
    };

    let mut seen = Vec::new();
    content
        .visit_raw_override(&mut |r, _| {
            seen.push(r.into_string());
            Ok(())
        })
        .unwrap();
    assert_eq!(seen, vec![SKIN.to_string()]);
    assert_ne!(content.content_fingerprint().unwrap(), Some(42));
}
