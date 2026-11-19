use std::path::Path;
use image::imageops::FilterType;
use image::GenericImageView;

pub const PHASH_SAMPLE_SIZE: usize = 32;
pub const PHASH_LOW_FREQ_SIZE: usize = 8;

pub fn is_phash_supported_filename(filename: &str) -> bool {
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp")
}

pub fn dct_phash_from_gray_pixels(
    gray: &[f64],
    size: usize,
    low_freq: usize,
) -> Result<u64, String> {
    let n = size;
    if gray.len() < n * n {
        return Err(format!(
            "Pixel grayscale insufficienti: servono {}, trovati {}",
            n * n,
            gray.len()
        ));
    }

    let mut cos_t = Vec::with_capacity(n);
    let pi = std::f64::consts::PI;
    for u in 0..n {
        let mut row = Vec::with_capacity(n);
        for x in 0..n {
            row.push((((2 * x + 1) * u) as f64 * pi / (2 * n) as f64).cos());
        }
        cos_t.push(row);
    }

    let mut row_dct = vec![0.0f64; n * n];
    for v in 0..n {
        for u in 0..n {
            let mut sum = 0.0;
            let row_base = v * n;
            let cos_u = &cos_t[u];
            for x in 0..n {
                sum += gray[row_base + x] * cos_u[x];
            }
            row_dct[v * n + u] = sum;
        }
    }

    let mut dct = vec![0.0f64; n * n];
    for u in 0..n {
        for v in 0..n {
            let mut sum = 0.0;
            let cos_v = &cos_t[v];
            for y in 0..n {
                sum += row_dct[y * n + u] * cos_v[y];
            }
            dct[v * n + u] = sum;
        }
    }

    let mut coeffs = Vec::with_capacity(low_freq * low_freq - 1);
    for v in 0..low_freq {
        for u in 0..low_freq {
            if u == 0 && v == 0 {
                continue;
            }
            coeffs.push(dct[v * n + u]);
        }
    }

    let mut sorted = coeffs.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    let median = if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    };

    let mut hash = 0u64;
    for v in 0..low_freq {
        for u in 0..low_freq {
            if u == 0 && v == 0 {
                continue;
            }
            let val = dct[v * n + u];
            if val > median {
                let bit_idx = (v * low_freq + u) as u64;
                hash |= 1u64 << bit_idx;
            }
        }
    }

    Ok(hash)
}

pub fn hamming_distance_hex(a: &str, b: &str) -> Result<u32, String> {
    let ha = u64::from_str_radix(a.trim(), 16).map_err(|e| e.to_string())?;
    let hb = u64::from_str_radix(b.trim(), 16).map_err(|e| e.to_string())?;
    Ok((ha ^ hb).count_ones())
}

pub fn compute_phash_hex(image_bytes: &[u8]) -> Result<String, String> {
    let img = image::load_from_memory(image_bytes).map_err(|e| e.to_string())?;
    let gray_img = img
        .grayscale()
        .resize_exact(PHASH_SAMPLE_SIZE as u32, PHASH_SAMPLE_SIZE as u32, FilterType::Triangle);

    let mut gray_pixels = Vec::with_capacity(PHASH_SAMPLE_SIZE * PHASH_SAMPLE_SIZE);
    for y in 0..PHASH_SAMPLE_SIZE as u32 {
        for x in 0..PHASH_SAMPLE_SIZE as u32 {
            let pixel = gray_img.get_pixel(x, y);
            gray_pixels.push(pixel[0] as f64);
        }
    }

    let hash = dct_phash_from_gray_pixels(&gray_pixels, PHASH_SAMPLE_SIZE, PHASH_LOW_FREQ_SIZE)?;
    Ok(format!("{hash:016x}"))
}

pub fn group_similar_by_hash(
    items: &[(String, String)],
    threshold: u32,
) -> Vec<Vec<String>> {
    let n = items.len();
    if n == 0 {
        return Vec::new();
    }

    let mut parent: Vec<usize> = (0..n).collect();

    fn find(parent: &mut [usize], i: usize) -> usize {
        if parent[i] == i {
            i
        } else {
            let p = parent[i];
            parent[i] = find(parent, p);
            parent[i]
        }
    }

    fn union(parent: &mut [usize], i: usize, j: usize) {
        let root_i = find(parent, i);
        let root_j = find(parent, j);
        if root_i != root_j {
            parent[root_i] = root_j;
        }
    }

    for i in 0..n {
        for j in (i + 1)..n {
            if let Ok(dist) = hamming_distance_hex(&items[i].1, &items[j].1) {
                if dist <= threshold {
                    union(&mut parent, i, j);
                }
            }
        }
    }

    let mut groups: std::collections::HashMap<usize, Vec<String>> = std::collections::HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(items[i].0.clone());
    }

    groups
        .into_values()
        .filter(|g| g.len() > 1)
        .collect()
}
