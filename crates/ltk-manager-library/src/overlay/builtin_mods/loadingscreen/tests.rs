use super::*;
use ltk_meta::BinObject;

fn image_entry() -> Entry {
    Entry {
        kind: Kind::Image {
            texture_hash: 0x1234,
            texture_size: (1920, 1080),
        },
        layer: 70,
    }
}

fn video_entry() -> Entry {
    Entry {
        kind: Kind::Video { file: VIDEO_PATH },
        layer: 70,
    }
}

#[test]
fn encoded_textures_have_the_header_the_game_reads() {
    let img = RgbaImage::new(16, 8);
    let bytes = encode_tex(&img).unwrap();
    assert_eq!(&bytes[..4], b"TEX\0");
    assert_eq!(u16::from_le_bytes([bytes[4], bytes[5]]), 16);
    assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), 8);
    assert_eq!(bytes[9], TEX_FORMAT_BC3);
    assert_eq!(bytes[11], 0);
    // BC3 takes one byte a pixel.
    assert_eq!(bytes.len(), TEX_HEADER + 16 * 8);
}

#[test]
fn a_wrong_length_texture_is_refused() {
    let img = RgbaImage::new(16, 8);
    let mut bytes = encode_tex(&img).unwrap();
    bytes.pop();
    assert!(validate_tex(&bytes, 16, 8).is_err());
}

#[test]
fn media_is_told_by_extension() {
    assert_eq!(media_kind(Path::new("a.PNG")), Some(Media::Image));
    assert_eq!(media_kind(Path::new("a.webm")), Some(Media::Video));
    assert_eq!(media_kind(Path::new("a.mp4")), None);
    assert_eq!(media_kind(Path::new("a.gif")), None);
    assert_eq!(media_kind(Path::new("a.txt")), None);
}

#[test]
fn a_webm_header_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.webm");
    fs_err::write(&path, [&WEBM_MAGIC[..], b"rest"].concat()).unwrap();
    assert!(validate_webm(&path).is_ok());
}

#[test]
fn a_file_without_the_webm_header_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    fs_err::write(&path, b"not a webm").unwrap();
    assert!(validate_webm(&path).is_err());
}

#[test]
fn the_video_is_registered_as_a_copy_in_the_ui_archive() {
    let mut overrides = Overrides::default();
    register_video(&mut overrides, Path::new("/videos/clip.webm"));

    let copies: Vec<(String, PathBuf)> = overrides
        .copies()
        .map(|(path, source)| (path.to_string(), source.to_path_buf()))
        .collect();
    assert_eq!(
        copies,
        vec![(
            format!("{STOCK_ARCHIVE}/{VIDEO_PATH}"),
            PathBuf::from("/videos/clip.webm")
        )]
    );
}

fn stock_bin() -> Vec<u8> {
    let root = BinHash::hash_str(ROOT_PATH);
    let bin = Bin::new([BinObject::new(root, 0x0202_c6c9u32)], Vec::<String>::new());
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn read(bytes: &[u8]) -> Bin {
    Bin::from_reader(&mut Cursor::new(bytes)).unwrap()
}

fn property(object: &BinObject, hash: u32) -> &PropertyValueEnum {
    object
        .properties
        .get(&BinHash(hash))
        .expect("the property is set")
}

fn structure(object: &BinObject, hash: u32) -> &values::Struct {
    match property(object, hash) {
        PropertyValueEnum::Struct(value) => value,
        other => panic!("the property is not a struct: {other:?}"),
    }
}

#[test]
fn an_image_entry_parses_and_hangs_from_the_root() {
    let patched = read(&patch_bin(&stock_bin(), entry_object(&image_entry())).unwrap());
    let key = BinHash::hash_str(format!("{ROOT_PATH}/{ENTRY_NAME}"));
    let object = patched.get_object(key).expect("the entry is added");

    assert_eq!(object.class_hash, BinHash(0x1a65_e950));
    assert_eq!(
        structure(object, 0x934f_4e0a).class_hash,
        BinHash(0x4460_0fb6)
    );
    assert_eq!(
        structure(object, 0xe502_c1dc).class_hash,
        BinHash(0x719f_1a94)
    );
    assert!(patched.contains_object(BinHash::hash_str(ROOT_PATH)));
}

#[test]
fn a_video_entry_is_an_icon_playing_atlas_data_video() {
    let patched = read(&patch_bin(&stock_bin(), entry_object(&video_entry())).unwrap());
    let key = BinHash::hash_str(format!("{ROOT_PATH}/{ENTRY_NAME}"));
    let object = patched.get_object(key).expect("the entry is added");

    assert_eq!(object.class_hash, BinHash(0x1a65_e950));

    let position = structure(object, 0x934f_4e0a);
    assert_eq!(position.class_hash, BinHash(0xc931_f1b9));
    assert!(position.properties.is_empty());

    let texture = structure(object, 0xe502_c1dc);
    assert_eq!(texture.class_hash, BinHash(0x48b5_25af));
    assert!(matches!(
        texture.properties.get(&BinHash(0xaaea_5743)),
        Some(PropertyValueEnum::String(file)) if file.value == VIDEO_PATH
    ));
    assert!(matches!(
        texture.properties.get(&BinHash(0xddef_486b)),
        Some(PropertyValueEnum::Bool(flag)) if flag.value
    ));

    for animation in [0xff72_f56a, 0xa651_7bab, 0x9e17_f690, 0xee3c_0711] {
        assert!(!object.properties.contains_key(&BinHash(animation)));
    }
}

#[test]
fn patching_twice_adds_the_entry_once() {
    let object1 = entry_object(&video_entry());
    let object2 = object1.clone();
    let once = patch_bin(&stock_bin(), object1).unwrap();
    let twice = patch_bin(&once, object2).unwrap();
    assert_eq!(read(&once).len(), 2);
    assert_eq!(read(&twice).len(), 2);
    assert_eq!(once, twice);
}
