use super::*;

/// A version 3 file of `width` by `height` cells, each face a distinct colour.
fn grid_file(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    for word in [FILE_VERSION, HEADER_BYTES as u32, width, height] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    for value in [2000.0_f32, 1000.0, 0.25, 0.5] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for cell in 0..width * height {
        for face in 0..FACES as u32 {
            bytes.extend_from_slice(&[face as u8, cell as u8, 200, 7]);
        }
    }
    bytes
}

fn word(buffer: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(buffer[at..at + 4].try_into().unwrap())
}

fn float(buffer: &[u8], at: usize) -> f32 {
    f32::from_le_bytes(buffer[at..at + 4].try_into().unwrap())
}

#[test]
fn a_grid_round_trips_with_its_scale_and_colours_swizzled() {
    let buffer = render(&grid_file(3, 2)).unwrap();

    assert_eq!(word(&buffer, 0), MAGIC);
    assert_eq!(word(&buffer, 4), VERSION);
    assert_eq!((word(&buffer, 8), word(&buffer, 12)), (3, 2));
    assert_eq!((float(&buffer, 16), float(&buffer, 20)), (2000.0, 1000.0));
    assert_eq!(float(&buffer, 24), 1.0, "four times the file's 0.25");
    assert_eq!(float(&buffer, 28), 0.5);
    assert_eq!(buffer.len(), HEADER_BYTES + 3 * 2 * FACES * 4);

    let cell = 4;
    let face = 5;
    let at = HEADER_BYTES + (cell * FACES + face) * 4;
    assert_eq!(&buffer[at..at + 4], &[200, cell as u8, face as u8, 255]);
}

#[test]
fn the_cells_are_read_from_the_offset_the_header_states() {
    let mut file = grid_file(1, 1);
    file.splice(HEADER_BYTES..HEADER_BYTES, [0xEE; 8]);
    file[4..8].copy_from_slice(&(HEADER_BYTES as u32 + 8).to_le_bytes());

    let buffer = render(&file).unwrap();
    assert_eq!(&buffer[HEADER_BYTES..HEADER_BYTES + 4], &[200, 0, 0, 255]);
}

#[test]
fn a_grid_the_game_would_not_read_is_refused() {
    let mut other_version = grid_file(1, 1);
    other_version[0] = 2;
    let mut no_cells = grid_file(1, 1);
    no_cells[8..12].copy_from_slice(&0_u32.to_le_bytes());
    let mut no_ground = grid_file(1, 1);
    no_ground[16..20].copy_from_slice(&0.5_f32.to_le_bytes());
    let mut truncated = grid_file(2, 2);
    truncated.truncate(truncated.len() - 1);

    for file in [other_version, no_cells, no_ground, truncated, vec![3, 0, 0]] {
        assert!(matches!(render(&file), Err(PreviewError::LightGridRead(_))));
    }
}
