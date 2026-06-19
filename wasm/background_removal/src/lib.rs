const BACKGROUND_CLUSTER_DISTANCE: f32 = 24.0;
const MATTE_ALPHA_EPSILON: f32 = 1.0 / 255.0;
const RELIABLE_FOREGROUND_ALPHA: f32 = 0.95;
const MATTE_PROJECTION_ERROR_BASE: f32 = 6.0;
const MATTE_PROJECTION_ERROR_ALPHA_SCALE: f32 = 8.0;
const LOCAL_COLOR_VARIATION_DISTANCE_SQ: i32 = 14 * 14;
const FLAT_FOREGROUND_DISTANCE_SQ: i32 = 8 * 8;

#[derive(Clone, Copy)]
struct BackgroundSample {
    r: f32,
    g: f32,
    b: f32,
    alpha: f32,
    side_mask: u8,
    corner_mask: u8,
    edge_distance: i32,
}

struct BackgroundCluster {
    r: f32,
    g: f32,
    b: f32,
    weight: f32,
    outer_weight: f32,
    side_mask: u8,
    corner_mask: u8,
}

struct MatteConfig {
    noise_alpha: f32,
    transparent_delta_e: f64,
    delta_e_alpha_check: f32,
    max_refine_distance: i16,
    foreground_search_radius: i32,
}

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(size);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    let _ = Vec::from_raw_parts(ptr, 0, size);
}

#[no_mangle]
pub unsafe extern "C" fn remove_background(
    input_ptr: *const u8,
    output_ptr: *mut u8,
    width: u32,
    height: u32,
    tolerance: u32,
    erosion: u32,
    color_source: u32,
    fill_interior: u32,
) -> i32 {
    if input_ptr.is_null() || output_ptr.is_null() || width == 0 || height == 0 {
        return -1;
    }

    let width = width as usize;
    let height = height as usize;
    let Some(byte_len) = width.checked_mul(height).and_then(|value| value.checked_mul(4)) else {
        return -2;
    };

    let input = std::slice::from_raw_parts(input_ptr, byte_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, byte_len);
    remove_background_core(
        input,
        output,
        width,
        height,
        tolerance,
        erosion,
        color_source,
        fill_interior != 0,
    );
    0
}

fn remove_background_core(
    input: &[u8],
    output: &mut [u8],
    width: usize,
    height: usize,
    tolerance: u32,
    erosion: u32,
    color_source: u32,
    fill_interior: bool,
) {
    let bg_color = detect_background_color(input, width, height, color_source);
    let config = get_matte_config(tolerance);
    let total_pixels = width * height;
    let mut alpha_estimate = vec![0.0_f32; total_pixels];
    let mut strong_background = vec![0_u8; total_pixels];

    for pixel_index in 0..total_pixels {
        let idx = pixel_index * 4;
        let source_alpha = input[idx + 3];
        if source_alpha <= 8 {
            strong_background[pixel_index] = 1;
            continue;
        }

        let rgb = pixel_rgb(input, pixel_index);
        let raw_alpha = estimate_alpha_from_background(rgb, bg_color);
        let matte_alpha = apply_alpha_noise_floor(raw_alpha, config.noise_alpha);
        alpha_estimate[pixel_index] = matte_alpha;

        if matte_alpha == 0.0 {
            strong_background[pixel_index] = 1;
        } else if matte_alpha <= config.delta_e_alpha_check {
            let color_diff = delta_e(rgb, bg_color);
            if color_diff <= config.transparent_delta_e {
                strong_background[pixel_index] = 1;
            }
        }
    }

    let (process_mask, edge_distance) = if fill_interior {
        (vec![1_u8; total_pixels], vec![-1_i16; total_pixels])
    } else {
        build_edge_connected_matte_region(
            input,
            width,
            height,
            &alpha_estimate,
            &strong_background,
            config.max_refine_distance,
        )
    };

    for pixel_index in 0..total_pixels {
        let idx = pixel_index * 4;
        let source_alpha = input[idx + 3];
        let rgb = pixel_rgb(input, pixel_index);

        if process_mask[pixel_index] == 0 {
            output[idx] = rgb[0];
            output[idx + 1] = rgb[1];
            output[idx + 2] = rgb[2];
            output[idx + 3] = source_alpha;
            continue;
        }

        let mut matte_alpha = if strong_background[pixel_index] != 0 {
            0.0
        } else {
            alpha_estimate[pixel_index]
        };
        let mut foreground_hint: Option<[u8; 3]> = None;
        let mut has_reliable_matte_projection = false;

        if !fill_interior
            && strong_background[pixel_index] == 0
            && matte_alpha > 0.0
            && matte_alpha < 1.0
        {
            let hint = find_foreground_hint(
                input,
                width,
                height,
                pixel_index,
                &edge_distance,
                &strong_background,
                &alpha_estimate,
                config.foreground_search_radius,
            );

            if let Some(hint_rgb) = hint {
                if let Some(projected) = estimate_alpha_from_foreground_projection(rgb, bg_color, hint_rgb) {
                    let max_projection_error =
                        MATTE_PROJECTION_ERROR_BASE + (1.0 - projected.0) * MATTE_PROJECTION_ERROR_ALPHA_SCALE;
                    let projects_from_different_foreground =
                        rgb_distance_squared(rgb, hint_rgb) > FLAT_FOREGROUND_DISTANCE_SQ;
                    if projects_from_different_foreground && projected.1 <= max_projection_error {
                        matte_alpha = apply_alpha_noise_floor(projected.0, config.noise_alpha);
                        foreground_hint = if matte_alpha > 0.0 { Some(hint_rgb) } else { None };
                        has_reliable_matte_projection = true;
                    }
                }
            }
        }

        if strong_background[pixel_index] == 0
            && matte_alpha > 0.0
            && matte_alpha < 1.0
            && !has_reliable_matte_projection
        {
            matte_alpha = 1.0;
            foreground_hint = None;
        }

        let output_alpha = clamp_byte((source_alpha as f32 / 255.0) * matte_alpha * 255.0);
        let recovered = recover_foreground_rgb(rgb, bg_color, matte_alpha, foreground_hint);
        output[idx] = recovered[0];
        output[idx + 1] = recovered[1];
        output[idx + 2] = recovered[2];
        output[idx + 3] = output_alpha;
    }

    if fill_interior {
        for pixel_index in 0..total_pixels {
            let idx = pixel_index * 4;
            if input[idx + 3] <= 8 || strong_background[pixel_index] == 0 {
                continue;
            }
            output[idx] = 0;
            output[idx + 1] = 0;
            output[idx + 2] = 0;
            output[idx + 3] = 0;
        }
    }

    if erosion > 0 {
        erode_edges(output, width, height, erosion);
    }
}

fn rgb_to_lab(rgb: [u8; 3]) -> [f64; 3] {
    let mut rn = rgb[0] as f64 / 255.0;
    let mut gn = rgb[1] as f64 / 255.0;
    let mut bn = rgb[2] as f64 / 255.0;

    rn = if rn > 0.04045 { ((rn + 0.055) / 1.055).powf(2.4) } else { rn / 12.92 };
    gn = if gn > 0.04045 { ((gn + 0.055) / 1.055).powf(2.4) } else { gn / 12.92 };
    bn = if bn > 0.04045 { ((bn + 0.055) / 1.055).powf(2.4) } else { bn / 12.92 };

    rn *= 100.0;
    gn *= 100.0;
    bn *= 100.0;

    let x = rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375;
    let y = rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750;
    let z = rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041;

    let mut fx = x / 95.047;
    let mut fy = y / 100.0;
    let mut fz = z / 108.883;
    let epsilon = 0.008856;
    let kappa = 903.3;

    fx = if fx > epsilon { fx.powf(1.0 / 3.0) } else { (kappa * fx + 16.0) / 116.0 };
    fy = if fy > epsilon { fy.powf(1.0 / 3.0) } else { (kappa * fy + 16.0) / 116.0 };
    fz = if fz > epsilon { fz.powf(1.0 / 3.0) } else { (kappa * fz + 16.0) / 116.0 };

    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn delta_e(a: [u8; 3], b: [u8; 3]) -> f64 {
    let lab_a = rgb_to_lab(a);
    let lab_b = rgb_to_lab(b);
    ((lab_b[0] - lab_a[0]).powi(2)
        + (lab_b[1] - lab_a[1]).powi(2)
        + (lab_b[2] - lab_a[2]).powi(2))
        .sqrt()
}

fn count_bits(value: u8) -> i32 {
    value.count_ones() as i32
}

fn get_corner_mask(x: usize, y: usize, width: usize, height: usize, radius: usize) -> u8 {
    let mut mask = 0;
    if x < radius && y < radius {
        mask |= 1;
    }
    if x >= width.saturating_sub(radius) && y < radius {
        mask |= 2;
    }
    if x < radius && y >= height.saturating_sub(radius) {
        mask |= 4;
    }
    if x >= width.saturating_sub(radius) && y >= height.saturating_sub(radius) {
        mask |= 8;
    }
    mask
}

fn get_rect_corner_mask(
    x: usize,
    y: usize,
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
    radius: usize,
) -> u8 {
    let mut mask = 0;
    if x < left + radius && y < top + radius {
        mask |= 1;
    }
    if x > right.saturating_sub(radius) && y < top + radius {
        mask |= 2;
    }
    if x < left + radius && y > bottom.saturating_sub(radius) {
        mask |= 4;
    }
    if x > right.saturating_sub(radius) && y > bottom.saturating_sub(radius) {
        mask |= 8;
    }
    mask
}

fn get_opaque_bounds(data: &[u8], width: usize, height: usize) -> Option<(usize, usize, usize, usize)> {
    let mut left = width;
    let mut top = height;
    let mut right = None;
    let mut bottom = 0;

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 4;
            if data[idx + 3] <= 8 {
                continue;
            }
            left = left.min(x);
            top = top.min(y);
            right = Some(right.map_or(x, |value: usize| value.max(x)));
            bottom = bottom.max(y);
        }
    }

    right.map(|right| (left, top, right, bottom))
}

fn collect_background_samples(data: &[u8], width: usize, height: usize) -> Vec<BackgroundSample> {
    let total_pixels = width * height;
    let mut samples_by_pixel: Vec<Option<BackgroundSample>> = vec![None; total_pixels];
    let min_dimension = width.min(height);
    let edge_depth = 1.max(6.min(min_dimension / 12));
    let corner_radius = 1.max(4.min(min_dimension / 16));

    record_rect_edges(
        data,
        width,
        height,
        &mut samples_by_pixel,
        edge_depth,
        corner_radius,
        0,
        0,
        width - 1,
        height - 1,
        false,
    );

    let sample_count = samples_by_pixel.iter().filter(|sample| sample.is_some()).count();
    if sample_count < 4.max(min_dimension) {
        if let Some((left, top, right, bottom)) = get_opaque_bounds(data, width, height) {
            if left > 0 || top > 0 || right < width - 1 || bottom < height - 1 {
                record_rect_edges(
                    data,
                    width,
                    height,
                    &mut samples_by_pixel,
                    edge_depth,
                    corner_radius,
                    left,
                    top,
                    right,
                    bottom,
                    true,
                );
            }
        }
    }

    samples_by_pixel.into_iter().flatten().collect()
}

#[allow(clippy::too_many_arguments)]
fn record_rect_edges(
    data: &[u8],
    width: usize,
    height: usize,
    samples_by_pixel: &mut [Option<BackgroundSample>],
    edge_depth: usize,
    corner_radius: usize,
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
    use_rect_corners: bool,
) {
    let rect_width = right - left + 1;
    let rect_height = bottom - top + 1;
    let max_depth = edge_depth.min(rect_width.div_ceil(2)).min(rect_height.div_ceil(2));

    for depth in 0..max_depth {
        let top_y = top + depth;
        let bottom_y = bottom - depth;
        let left_x = left + depth;
        let right_x = right - depth;
        if left_x > right_x || top_y > bottom_y {
            break;
        }

        for x in left_x..=right_x {
            let top_corner = if use_rect_corners {
                get_rect_corner_mask(x, top_y, left, top, right, bottom, corner_radius)
            } else {
                get_corner_mask(x, top_y, width, height, corner_radius)
            };
            record_sample(data, width, samples_by_pixel, x, top_y, 1, depth as i32, top_corner);

            if bottom_y != top_y {
                let bottom_corner = if use_rect_corners {
                    get_rect_corner_mask(x, bottom_y, left, top, right, bottom, corner_radius)
                } else {
                    get_corner_mask(x, bottom_y, width, height, corner_radius)
                };
                record_sample(data, width, samples_by_pixel, x, bottom_y, 4, depth as i32, bottom_corner);
            }
        }

        for y in top_y..=bottom_y {
            let left_corner = if use_rect_corners {
                get_rect_corner_mask(left_x, y, left, top, right, bottom, corner_radius)
            } else {
                get_corner_mask(left_x, y, width, height, corner_radius)
            };
            record_sample(data, width, samples_by_pixel, left_x, y, 8, depth as i32, left_corner);

            if right_x != left_x {
                let right_corner = if use_rect_corners {
                    get_rect_corner_mask(right_x, y, left, top, right, bottom, corner_radius)
                } else {
                    get_corner_mask(right_x, y, width, height, corner_radius)
                };
                record_sample(data, width, samples_by_pixel, right_x, y, 2, depth as i32, right_corner);
            }
        }
    }
}

fn record_sample(
    data: &[u8],
    width: usize,
    samples_by_pixel: &mut [Option<BackgroundSample>],
    x: usize,
    y: usize,
    side_mask: u8,
    edge_distance: i32,
    corner_mask: u8,
) {
    let pixel_key = y * width + x;
    let idx = pixel_key * 4;
    let alpha = data[idx + 3];
    if alpha <= 8 {
        return;
    }

    if let Some(existing) = samples_by_pixel[pixel_key].as_mut() {
        existing.side_mask |= side_mask;
        existing.corner_mask |= corner_mask;
        existing.edge_distance = existing.edge_distance.min(edge_distance);
        return;
    }

    samples_by_pixel[pixel_key] = Some(BackgroundSample {
        r: data[idx] as f32,
        g: data[idx + 1] as f32,
        b: data[idx + 2] as f32,
        alpha: alpha as f32,
        side_mask,
        corner_mask,
        edge_distance,
    });
}

fn find_nearest_background_cluster<'a>(
    clusters: &'a mut [BackgroundCluster],
    sample: BackgroundSample,
) -> Option<&'a mut BackgroundCluster> {
    let max_distance = BACKGROUND_CLUSTER_DISTANCE * BACKGROUND_CLUSTER_DISTANCE;
    let mut best_index = None;
    let mut best_distance = f32::INFINITY;

    for (index, cluster) in clusters.iter().enumerate() {
        let dr = sample.r - cluster.r;
        let dg = sample.g - cluster.g;
        let db = sample.b - cluster.b;
        let distance = dr * dr + dg * dg + db * db;

        if distance <= max_distance && distance < best_distance {
            best_distance = distance;
            best_index = Some(index);
        }
    }

    best_index.map(|index| &mut clusters[index])
}

fn detect_auto_background_color(data: &[u8], width: usize, height: usize) -> [u8; 3] {
    let samples = collect_background_samples(data, width, height);
    if samples.is_empty() {
        return [0, 0, 0];
    }

    let mut clusters: Vec<BackgroundCluster> = Vec::new();
    for sample in samples.iter().copied() {
        let alpha_weight = sample.alpha / 255.0;
        let edge_weight = if sample.edge_distance == 0 { 2.0 } else { 1.0 };
        let corner_weight = if sample.corner_mask == 0 { 1.0 } else { 1.5 };
        let sample_weight = alpha_weight * edge_weight * corner_weight;

        if let Some(cluster) = find_nearest_background_cluster(&mut clusters, sample) {
            let next_weight = cluster.weight + sample_weight;
            cluster.r = (cluster.r * cluster.weight + sample.r * sample_weight) / next_weight;
            cluster.g = (cluster.g * cluster.weight + sample.g * sample_weight) / next_weight;
            cluster.b = (cluster.b * cluster.weight + sample.b * sample_weight) / next_weight;
            cluster.weight = next_weight;
            if sample.edge_distance == 0 {
                cluster.outer_weight += sample_weight;
            }
            cluster.side_mask |= sample.side_mask;
            cluster.corner_mask |= sample.corner_mask;
        } else {
            clusters.push(BackgroundCluster {
                r: sample.r,
                g: sample.g,
                b: sample.b,
                weight: sample_weight,
                outer_weight: if sample.edge_distance == 0 { sample_weight } else { 0.0 },
                side_mask: sample.side_mask,
                corner_mask: sample.corner_mask,
            });
        }
    }

    let mut best_index = 0;
    let mut best_score = -1.0_f32;
    let corner_evidence_weight = 12.0_f32.max(samples.len() as f32 * 0.015);

    for (index, cluster) in clusters.iter().enumerate() {
        let side_coverage = count_bits(cluster.side_mask) as f32;
        let corner_coverage = count_bits(cluster.corner_mask) as f32;
        let score = cluster.weight * (1.0 + side_coverage * 0.2)
            + cluster.outer_weight * 0.1
            + corner_coverage * corner_evidence_weight;

        if score > best_score {
            best_score = score;
            best_index = index;
        }
    }

    let best = &clusters[best_index];
    [clamp_byte(best.r), clamp_byte(best.g), clamp_byte(best.b)]
}

fn get_corner_color(data: &[u8], width: usize, height: usize, corner: u32) -> [u8; 3] {
    let patch_size = 1.max(8.min(width.min(height) / 10));
    let x_start = if corner == 2 || corner == 4 { width - patch_size } else { 0 };
    let y_start = if corner == 3 || corner == 4 { height - patch_size } else { 0 };
    let mut rs = Vec::new();
    let mut gs = Vec::new();
    let mut bs = Vec::new();

    for y in y_start..(y_start + patch_size) {
        for x in x_start..(x_start + patch_size) {
            let idx = (y * width + x) * 4;
            if data[idx + 3] <= 8 {
                continue;
            }
            rs.push(data[idx]);
            gs.push(data[idx + 1]);
            bs.push(data[idx + 2]);
        }
    }

    if !rs.is_empty() {
        return [median_rounded(&mut rs), median_rounded(&mut gs), median_rounded(&mut bs)];
    }

    let idx = match corner {
        2 => (width - 1) * 4,
        3 => (height - 1) * width * 4,
        4 => ((height - 1) * width + width - 1) * 4,
        _ => 0,
    };
    [data[idx], data[idx + 1], data[idx + 2]]
}

fn median_rounded(values: &mut [u8]) -> u8 {
    values.sort_unstable();
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (((values[middle - 1] as u16 + values[middle] as u16) + 1) / 2) as u8
    } else {
        values[middle]
    }
}

fn detect_background_color(data: &[u8], width: usize, height: usize, color_source: u32) -> [u8; 3] {
    if color_source != 0 {
        return get_corner_color(data, width, height, color_source);
    }
    detect_auto_background_color(data, width, height)
}

fn get_matte_config(tolerance: u32) -> MatteConfig {
    let normalized = tolerance.min(255) as f32;
    MatteConfig {
        noise_alpha: normalized / 255.0,
        transparent_delta_e: (normalized as f64 / 255.0) * 100.0,
        delta_e_alpha_check: ((normalized / 255.0) * 2.0 + 0.02).min(1.0),
        max_refine_distance: 2.max(6.min((normalized / 48.0).ceil() as i16 + 2)),
        foreground_search_radius: 3.max(8.min((normalized / 32.0).ceil() as i32 + 3)),
    }
}

fn estimate_alpha_from_background(rgb: [u8; 3], bg_color: [u8; 3]) -> f32 {
    let mut alpha = 0.0_f32;
    for channel in 0..3 {
        let background = bg_color[channel] as f32;
        let value = rgb[channel] as f32;
        let difference = value - background;
        if difference == 0.0 {
            continue;
        }

        let denominator = if difference > 0.0 { 255.0 - background } else { background };
        if denominator <= 0.0 {
            alpha = 1.0;
        } else {
            alpha = alpha.max(difference.abs() / denominator);
        }
    }
    alpha.clamp(0.0, 1.0)
}

fn apply_alpha_noise_floor(alpha: f32, noise_alpha: f32) -> f32 {
    if alpha <= noise_alpha {
        0.0
    } else if alpha >= 1.0 - MATTE_ALPHA_EPSILON {
        1.0
    } else {
        alpha
    }
}

fn recover_foreground_rgb(
    rgb: [u8; 3],
    bg_color: [u8; 3],
    alpha: f32,
    foreground_hint: Option<[u8; 3]>,
) -> [u8; 3] {
    if alpha <= MATTE_ALPHA_EPSILON {
        return [0, 0, 0];
    }
    if let Some(hint) = foreground_hint {
        if alpha < 1.0 - MATTE_ALPHA_EPSILON {
            return hint;
        }
    }
    if alpha >= 1.0 - MATTE_ALPHA_EPSILON {
        return rgb;
    }

    let inverse_alpha = 1.0 - alpha;
    [
        clamp_byte((rgb[0] as f32 - inverse_alpha * bg_color[0] as f32) / alpha),
        clamp_byte((rgb[1] as f32 - inverse_alpha * bg_color[1] as f32) / alpha),
        clamp_byte((rgb[2] as f32 - inverse_alpha * bg_color[2] as f32) / alpha),
    ]
}

fn pixel_rgb(data: &[u8], pixel_index: usize) -> [u8; 3] {
    let idx = pixel_index * 4;
    [data[idx], data[idx + 1], data[idx + 2]]
}

fn rgb_distance_squared(a: [u8; 3], b: [u8; 3]) -> i32 {
    let dr = a[0] as i32 - b[0] as i32;
    let dg = a[1] as i32 - b[1] as i32;
    let db = a[2] as i32 - b[2] as i32;
    dr * dr + dg * dg + db * db
}

fn clamp_byte(value: f32) -> u8 {
    value.clamp(0.0, 255.0).round() as u8
}

fn has_local_color_variation(
    data: &[u8],
    width: usize,
    height: usize,
    pixel_index: usize,
    strong_background: &[u8],
) -> bool {
    let x = pixel_index % width;
    let y = pixel_index / width;
    let current = pixel_rgb(data, pixel_index);

    for dy in -1_i32..=1 {
        for dx in -1_i32..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx < 0 || nx >= width as i32 || ny < 0 || ny >= height as i32 {
                continue;
            }

            let neighbor_pixel = ny as usize * width + nx as usize;
            let neighbor_idx = neighbor_pixel * 4;
            if data[neighbor_idx + 3] <= 8 || strong_background[neighbor_pixel] != 0 {
                return true;
            }

            if rgb_distance_squared(current, pixel_rgb(data, neighbor_pixel))
                > LOCAL_COLOR_VARIATION_DISTANCE_SQ
            {
                return true;
            }
        }
    }

    false
}

fn find_foreground_hint(
    data: &[u8],
    width: usize,
    height: usize,
    pixel_index: usize,
    edge_distance: &[i16],
    strong_background: &[u8],
    alpha_estimate: &[f32],
    search_radius: i32,
) -> Option<[u8; 3]> {
    let current_distance = edge_distance[pixel_index].max(0);
    let current_alpha = alpha_estimate[pixel_index];
    let current_rgb = pixel_rgb(data, pixel_index);
    let x = pixel_index % width;
    let y = pixel_index / width;
    let mut best_pixel = None;
    let mut best_score = f32::INFINITY;

    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            if dx == 0 && dy == 0 {
                continue;
            }
            let distance_squared = dx * dx + dy * dy;
            if distance_squared > search_radius * search_radius {
                continue;
            }

            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx < 0 || nx >= width as i32 || ny < 0 || ny >= height as i32 {
                continue;
            }

            let neighbor_pixel = ny as usize * width + nx as usize;
            let neighbor_idx = neighbor_pixel * 4;
            let neighbor_distance = edge_distance[neighbor_pixel];
            if data[neighbor_idx + 3] <= 8 || strong_background[neighbor_pixel] != 0 {
                continue;
            }
            if alpha_estimate[neighbor_pixel] < RELIABLE_FOREGROUND_ALPHA {
                continue;
            }
            if neighbor_distance != -1 && neighbor_distance <= current_distance {
                continue;
            }

            let neighbor_rgb = pixel_rgb(data, neighbor_pixel);
            if alpha_estimate[neighbor_pixel] <= current_alpha + 0.05
                && rgb_distance_squared(current_rgb, neighbor_rgb) <= FLAT_FOREGROUND_DISTANCE_SQ
            {
                continue;
            }

            let alpha_penalty = (1.0 - alpha_estimate[neighbor_pixel]) * 1000.0;
            let score = alpha_penalty
                + distance_squared as f32
                + if neighbor_distance == -1 { 0.0 } else { 100.0 };
            if score < best_score {
                best_score = score;
                best_pixel = Some(neighbor_pixel);
            }
        }
    }

    best_pixel.map(|pixel| pixel_rgb(data, pixel))
}

fn estimate_alpha_from_foreground_projection(
    rgb: [u8; 3],
    bg_color: [u8; 3],
    foreground: [u8; 3],
) -> Option<(f32, f32)> {
    let vr = foreground[0] as f32 - bg_color[0] as f32;
    let vg = foreground[1] as f32 - bg_color[1] as f32;
    let vb = foreground[2] as f32 - bg_color[2] as f32;
    let denominator = vr * vr + vg * vg + vb * vb;
    if denominator < 1.0 {
        return None;
    }

    let wr = rgb[0] as f32 - bg_color[0] as f32;
    let wg = rgb[1] as f32 - bg_color[1] as f32;
    let wb = rgb[2] as f32 - bg_color[2] as f32;
    let alpha = ((wr * vr + wg * vg + wb * vb) / denominator).clamp(0.0, 1.0);
    let rr = bg_color[0] as f32 + alpha * vr;
    let rg = bg_color[1] as f32 + alpha * vg;
    let rb = bg_color[2] as f32 + alpha * vb;
    let error = (((rgb[0] as f32 - rr).powi(2)
        + (rgb[1] as f32 - rg).powi(2)
        + (rgb[2] as f32 - rb).powi(2))
        / 3.0)
        .sqrt();

    Some((alpha, error))
}

fn build_edge_connected_matte_region(
    data: &[u8],
    width: usize,
    height: usize,
    alpha_estimate: &[f32],
    strong_background: &[u8],
    max_refine_distance: i16,
) -> (Vec<u8>, Vec<i16>) {
    let total_pixels = width * height;
    let mut process_mask = vec![0_u8; total_pixels];
    let mut edge_distance = vec![-1_i16; total_pixels];
    let mut queue = Vec::with_capacity(total_pixels);
    let mut head = 0;

    for x in 0..width {
        enqueue_background(x, &mut process_mask, &mut edge_distance, &mut queue, strong_background);
        enqueue_background(
            (height - 1) * width + x,
            &mut process_mask,
            &mut edge_distance,
            &mut queue,
            strong_background,
        );
    }
    for y in 0..height {
        enqueue_background(y * width, &mut process_mask, &mut edge_distance, &mut queue, strong_background);
        enqueue_background(
            y * width + width - 1,
            &mut process_mask,
            &mut edge_distance,
            &mut queue,
            strong_background,
        );
    }

    while head < queue.len() {
        let pixel_index = queue[head];
        head += 1;
        let distance = edge_distance[pixel_index];
        let is_current_background = strong_background[pixel_index] != 0;
        let x = pixel_index % width;
        let y = pixel_index / width;

        for dy in -1_i32..=1 {
            for dx in -1_i32..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx < 0 || nx >= width as i32 || ny < 0 || ny >= height as i32 {
                    continue;
                }

                let neighbor_pixel = ny as usize * width + nx as usize;
                if edge_distance[neighbor_pixel] != -1 {
                    continue;
                }

                if strong_background[neighbor_pixel] != 0 {
                    process_mask[neighbor_pixel] = 1;
                    edge_distance[neighbor_pixel] = 0;
                    queue.push(neighbor_pixel);
                    continue;
                }

                let next_distance = if is_current_background { 1 } else { distance + 1 };
                if next_distance > max_refine_distance {
                    continue;
                }
                if alpha_estimate[neighbor_pixel] >= 1.0 - MATTE_ALPHA_EPSILON {
                    continue;
                }

                let follows_current_matte_band = !is_current_background
                    && alpha_estimate[neighbor_pixel] <= alpha_estimate[pixel_index] + 0.08
                    && rgb_distance_squared(pixel_rgb(data, pixel_index), pixel_rgb(data, neighbor_pixel))
                        <= FLAT_FOREGROUND_DISTANCE_SQ;
                if !follows_current_matte_band
                    && !has_local_color_variation(data, width, height, neighbor_pixel, strong_background)
                {
                    continue;
                }

                process_mask[neighbor_pixel] = 1;
                edge_distance[neighbor_pixel] = next_distance;
                queue.push(neighbor_pixel);
            }
        }
    }

    (process_mask, edge_distance)
}

fn enqueue_background(
    pixel_index: usize,
    process_mask: &mut [u8],
    edge_distance: &mut [i16],
    queue: &mut Vec<usize>,
    strong_background: &[u8],
) {
    if strong_background[pixel_index] == 0 || process_mask[pixel_index] != 0 {
        return;
    }
    process_mask[pixel_index] = 1;
    edge_distance[pixel_index] = 0;
    queue.push(pixel_index);
}

fn erode_edges(buffer: &mut [u8], width: usize, height: usize, iterations: u32) {
    let mut current = buffer.to_vec();

    for _ in 0..iterations {
        let mut next = current.clone();

        for y in 0..height {
            for x in 0..width {
                let idx = (y * width + x) * 4;
                if current[idx + 3] == 0 {
                    continue;
                }

                let mut has_transparent_neighbor = false;
                for dy in -1_i32..=1 {
                    for dx in -1_i32..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let nx = x as i32 + dx;
                        let ny = y as i32 + dy;

                        if nx < 0 || nx >= width as i32 || ny < 0 || ny >= height as i32 {
                            has_transparent_neighbor = true;
                            break;
                        }

                        let neighbor_idx = (ny as usize * width + nx as usize) * 4;
                        if current[neighbor_idx + 3] == 0 {
                            has_transparent_neighbor = true;
                            break;
                        }
                    }
                    if has_transparent_neighbor {
                        break;
                    }
                }

                if has_transparent_neighbor {
                    next[idx + 3] = 0;
                }
            }
        }

        current = next;
    }

    buffer.copy_from_slice(&current);
}
