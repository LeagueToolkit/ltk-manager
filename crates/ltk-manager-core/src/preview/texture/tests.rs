use std::num::NonZeroU32;

use image::RgbaImage;
use image_dds::ddsfile::{
    AlphaMode, Caps2, D3D10ResourceDimension, D3DFormat, DxgiFormat, NewD3dParams, NewDxgiParams,
};
use ltk_texture::Tex;
use ltk_texture::tex::{EncodeFormat, EncodeOptions};

use super::*;

/// A DDS of `faces` square faces `size` wide, face `n` a flat grey of `n * 40`.
fn dds_bytes(size: u32, faces: u8) -> Vec<u8> {
    let cube = faces == 6;
    let mut dds = Dds::new_dxgi(NewDxgiParams {
        height: size,
        width: size,
        depth: None,
        format: DxgiFormat::R8G8B8A8_UNorm,
        mipmap_levels: None,
        array_layers: cube.then_some(6),
        caps2: cube.then_some(Caps2::CUBEMAP | Caps2::CUBEMAP_ALLFACES),
        is_cubemap: cube,
        resource_dimension: D3D10ResourceDimension::Texture2D,
        alpha_mode: AlphaMode::Straight,
    })
    .unwrap();
    let face = (size * size * 4) as usize;
    dds.data = (0..faces).flat_map(|n| vec![n * 40; face]).collect();

    let mut bytes = Vec::new();
    dds.write(&mut bytes).unwrap();
    bytes
}

#[test]
fn a_cube_renders_its_six_faces_top_to_bottom_in_file_order() {
    let preview = render_cube(&dds_bytes(4, 6)).unwrap();

    let decoded = image::load_from_memory(&preview.bytes).unwrap().to_rgba8();
    assert_eq!((decoded.width(), decoded.height()), (4, 24));
    for face in 0..6u8 {
        let texel = decoded.get_pixel(1, u32::from(face) * 4 + 1);
        assert_eq!(texel[0], face * 40, "face {face} sits at row {}", face * 4);
    }
}

/// The shipped maps are block-compressed and written with the legacy header.
#[test]
fn a_legacy_block_compressed_cube_renders_its_six_faces() {
    let mut dds = Dds::new_d3d(NewD3dParams {
        height: 4,
        width: 4,
        depth: None,
        format: D3DFormat::DXT1,
        mipmap_levels: None,
        caps2: Some(Caps2::CUBEMAP | Caps2::CUBEMAP_ALLFACES),
    })
    .unwrap();
    dds.data = vec![0; 6 * 8];
    let mut bytes = Vec::new();
    dds.write(&mut bytes).unwrap();

    let decoded = image::load_from_memory(&render_cube(&bytes).unwrap().bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (4, 24));
}

#[test]
fn a_flat_dds_is_no_cube() {
    let err = render_cube(&dds_bytes(4, 1)).unwrap_err();
    assert!(
        matches!(err, PreviewError::NotCube),
        "unexpected error: {err}"
    );
}

#[test]
fn bytes_that_are_not_a_dds_report_a_read_error_for_a_cube() {
    let err = render_cube(b"not a texture at all").unwrap_err();
    assert!(
        matches!(err, PreviewError::Read(_)),
        "unexpected error: {err}"
    );
}

/// A `w` of `width`.
fn wide(width: u32) -> Option<NonZeroU32> {
    NonZeroU32::new(width)
}

/// A `.tex` of `width` by `height`, encoded the way the game ships one.
fn tex_bytes(width: u32, height: u32, mipmaps: bool) -> Vec<u8> {
    let mut image = RgbaImage::new(width, height);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        *pixel = image::Rgba([x as u8, y as u8, 0x40, 0xFF]);
    }

    let options = EncodeOptions::new(EncodeFormat::Bc3 {
        weigh_colour_by_alpha: false,
    });
    let options = if mipmaps {
        options.with_mipmaps()
    } else {
        options
    };
    let tex = Tex::encode_rgba_image(&image, options).unwrap();

    let mut bytes = Vec::new();
    tex.write(&mut bytes).unwrap();
    bytes
}

#[test]
fn renders_a_tex_at_its_full_resolution() {
    let bytes = tex_bytes(64, 32, true);

    let preview = render(&bytes, None).unwrap();

    assert_eq!(preview.mime, "image/png");
    let decoded = image::load_from_memory(&preview.bytes).unwrap();
    assert_eq!(
        (decoded.width(), decoded.height()),
        (64, 32),
        "the largest mipmap is the one that renders"
    );
}

#[test]
fn reports_what_a_tex_declares() {
    let info = info(&tex_bytes(64, 32, true)).unwrap();

    assert_eq!(info.width, 64);
    assert_eq!(info.height, 32);
    assert_eq!(info.container, TextureContainer::Tex);
    assert_eq!(info.format.as_deref(), Some("BC3"));
    assert!(info.mip_count > 1, "a mipmapped tex declares its chain");
}

#[test]
fn a_tex_without_mipmaps_still_renders() {
    let bytes = tex_bytes(16, 16, false);

    let decoded = image::load_from_memory(&render(&bytes, None).unwrap().bytes).unwrap();

    assert_eq!((decoded.width(), decoded.height()), (16, 16));
}

#[test]
fn a_width_renders_the_smallest_mipmap_that_covers_it() {
    let bytes = tex_bytes(64, 32, true);

    let decoded = image::load_from_memory(&render(&bytes, wide(16)).unwrap().bytes).unwrap();

    assert_eq!((decoded.width(), decoded.height()), (16, 8));
}

/// The swatch's own case: a small mipmap is a fraction of the block data.
#[test]
fn a_smaller_mipmap_decodes_fewer_bytes_than_level_0() {
    let bytes = tex_bytes(64, 32, true);
    let texture = Texture::from_reader(&mut Cursor::new(&bytes)).unwrap();
    let level = level_for(texture.width(), texture.mip_count(), wide(16));

    let full = decoded_len(&decode_mipmap(&texture, 0).unwrap());
    let small = decoded_len(&decode_mipmap(&texture, level).unwrap());

    assert_eq!(level, 2);
    assert!(
        small <= full / 16,
        "{small} bytes at level {level} against {full} at level 0"
    );
}

#[test]
fn a_width_past_the_texture_renders_level_0() {
    let bytes = tex_bytes(64, 32, true);

    let decoded = image::load_from_memory(&render(&bytes, wide(1024)).unwrap().bytes).unwrap();

    assert_eq!((decoded.width(), decoded.height()), (64, 32));
}

#[test]
fn a_tex_without_a_chain_renders_level_0_at_any_width() {
    let bytes = tex_bytes(16, 16, false);

    let decoded = image::load_from_memory(&render(&bytes, wide(4)).unwrap().bytes).unwrap();

    assert_eq!((decoded.width(), decoded.height()), (16, 16));
}

#[test]
fn the_level_is_the_smallest_mipmap_at_least_the_width() {
    assert_eq!(level_for(64, 7, None), 0);
    assert_eq!(level_for(64, 7, wide(64)), 0);
    assert_eq!(level_for(64, 7, wide(16)), 2);
    assert_eq!(level_for(64, 7, wide(9)), 2);
    assert_eq!(level_for(64, 7, wide(1)), 6);
    assert_eq!(level_for(64, 1, wide(1)), 0);
    assert_eq!(level_for(64, 7, wide(4096)), 0);
}

/// A header may claim more levels than the width halves into.
#[test]
fn a_level_count_past_the_shift_width_does_not_panic() {
    assert_eq!(level_for(64, 40, wide(1)), 39);
}

#[test]
fn bytes_that_are_not_a_texture_report_a_read_error() {
    let err = render(b"not a texture at all", None).unwrap_err();
    assert!(matches!(err, PreviewError::Read(_)));
}

#[test]
fn a_truncated_tex_reports_rather_than_panicking() {
    let bytes = tex_bytes(64, 32, true);

    let err = render(&bytes[..bytes.len() / 2], None).unwrap_err();

    assert!(matches!(err, PreviewError::Truncated));
}

fn decoded_len(surface: &Surface<'_>) -> usize {
    match surface {
        Surface::Tex(tex) => tex.data.len(),
        Surface::DdsRgba8(dds) => dds.data.len(),
    }
}
