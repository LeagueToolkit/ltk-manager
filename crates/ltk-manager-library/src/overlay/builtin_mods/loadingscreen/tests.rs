use super::*;
use ltk_meta::BinObject;

fn anim() -> Anim {
    Anim {
        frames: 30,
        cols: 6,
        frame_w: 64,
        frame_h: 36,
        fps: 30,
    }
}

#[test]
fn round4_never_goes_below_a_block() {
    assert_eq!(round4(0), 4);
    assert_eq!(round4(7), 4);
    assert_eq!(round4(641), 640);
}

#[test]
fn near_square_holds_every_frame() {
    let layout = near_square(120, 640, 360);
    assert!(layout.cols * layout.rows >= 120);
    assert!(layout.cols * layout.rows < 120 + layout.cols);
    assert_eq!(layout.sheet_w() % 4, 0);
    assert_eq!(layout.sheet_h() % 4, 0);
}

#[test]
fn fit_layout_keeps_small_sheets_as_asked() {
    let layout = fit_layout(120, 640, 360).unwrap();
    assert_eq!((layout.frame_w, layout.frame_h), (640, 360));
    assert!(layout.fits());
}

#[test]
fn fit_layout_shrinks_oversize_sheets() {
    let layout = fit_layout(210, 1280, 720).unwrap();
    assert!(layout.fits());
    assert!(layout.frame_w < 1280);
}

#[test]
fn fit_layout_gives_up_when_nothing_fits() {
    assert_eq!(fit_layout(2_000_000, 640, 360), None);
}

#[test]
fn sheet_places_frames_row_major_and_pads_the_end() {
    let plan = Layout {
        frames: 5,
        cols: 2,
        rows: 3,
        frame_w: 4,
        frame_h: 4,
    };
    let mut raw = Vec::new();
    for shade in 1..=5u8 {
        raw.extend(std::iter::repeat_n([shade, 0, 0, 255], 16).flatten());
    }
    let (sheet, layout) = build_sheet(&raw, plan).unwrap();
    assert_eq!((layout.frames, layout.rows), (5, 3));
    assert_eq!(sheet.dimensions(), (8, 12));
    assert_eq!(sheet.get_pixel(0, 0).0, [1, 0, 0, 255]);
    assert_eq!(sheet.get_pixel(4, 0).0, [2, 0, 0, 255]);
    assert_eq!(sheet.get_pixel(0, 4).0, [3, 0, 0, 255]);
    assert_eq!(sheet.get_pixel(0, 8).0, [5, 0, 0, 255]);
    assert_eq!(sheet.get_pixel(4, 8).0, [0, 0, 0, 0]);
}

#[test]
fn an_empty_video_is_refused() {
    let plan = near_square(4, 4, 4);
    assert!(build_sheet(&[], plan).is_err());
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
    assert_eq!(media_kind(Path::new("a.mp4")), Some(Media::Video));
    assert_eq!(media_kind(Path::new("a.txt")), None);
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

#[test]
fn an_image_entry_parses_and_hangs_from_the_root() {
    let object = entry_object(&Entry {
        texture_hash: 0x1234,
        texture_size: (1920, 1080),
        anim: None,
        layer: 70,
    });
    let patched = read(&patch_bin(&stock_bin(), object).unwrap());
    let key = BinHash::hash_str(format!("{ROOT_PATH}/{ENTRY_NAME}"));
    let object = patched.get_object(key).expect("the entry is added");
    assert_eq!(object.class_hash, BinHash(0x1a65_e950));
    assert!(patched.contains_object(BinHash::hash_str(ROOT_PATH)));
}

#[test]
fn a_video_entry_is_the_animated_class() {
    let object = entry_object(&Entry {
        texture_hash: 0x1234,
        texture_size: (384, 216),
        anim: Some(anim()),
        layer: 70,
    });
    let patched = read(&patch_bin(&stock_bin(), object).unwrap());
    let key = BinHash::hash_str(format!("{ROOT_PATH}/{ENTRY_NAME}"));
    assert_eq!(
        patched.get_object(key).unwrap().class_hash,
        BinHash(0xa742_684a)
    );
}

#[test]
fn patching_twice_adds_the_entry_once() {
    let object1 = entry_object(&Entry {
        texture_hash: 0x1234,
        texture_size: (384, 216),
        anim: Some(anim()),
        layer: 70,
    });
    let object2 = object1.clone();
    let once = patch_bin(&stock_bin(), object1).unwrap();
    let twice = patch_bin(&once, object2).unwrap();
    assert_eq!(read(&once).len(), 2);
    assert_eq!(read(&twice).len(), 2);
    assert_eq!(once, twice);
}
