# Research: Image Processing, Thumbnails and Perceptual Hashing (pHash)

## Sources
- Rust `image` crate (v0.25): `DynamicImage`, `imageops::resize`, `FilterType::Lanczos3` / `FilterType::Triangle`.
- PhotoCloud source: `src/lib/phash.ts`, `src/lib/thumbCache.ts`, `src/lib/exif.ts`.
- Standard pHash DCT-II specification.

## Core Components

### 1. pHash (Perceptual Hash) Algorithm
The PhotoCloud implementation uses a 2D separable Discrete Cosine Transform (DCT-II):
1. Downscale input image to a 32x32 grayscale matrix (`N = 32`).
2. Precompute cosine table:
   `cos_table[u][x] = cos(((2*x + 1) * u * PI) / (2 * N))`
3. Perform 2D DCT (separable: rows then columns):
   - Row transform: `row_dct[v*N + u] = sum_x(gray[v*N + x] * cos_table[u][x])`
   - Column transform: `dct[v*N + u] = sum_y(row_dct[y*N + u] * cos_table[v][y])`
4. Extract 8x8 low-frequency block (`64` coefficients), discarding the DC component at `(0, 0)` leaving 63 AC coefficients.
5. Compute the median of the 63 coefficients.
6. Generate 64-bit unsigned integer (`u64`):
   - For each coefficient in row-major order: if `u == 0 && v == 0`, bit is 0. Else if `coeff > median`, bit `(v * 8 + u)` is 1, else 0.
7. Format as 16-character lowercase hex string (`format!("{:016x}", hash)`).

### 2. Thumbnail Generation
- `src/lib/thumbCache.ts` generates thumbnail previews in JPEG / WebP formats.
- In Rust, `image::DynamicImage` provides high-performance SIMD-accelerated resampling via `imageops::resize`.
- Format variants:
  - Small thumb: 256x256 max bounding box (preserving aspect ratio).
  - Medium / Preview: 1024x1024 max bounding box.
- Quality: JPEG quality 80-85, fast encoding via `image::codecs::jpeg::JpegEncoder`.

### 3. EXIF Extraction
- PhotoCloud parses EXIF tags for:
  - Orientation (1 to 8)
  - DateTimeOriginal
  - GPSLatitude, GPSLongitude
  - Camera Make and Model
- In Rust, `kamadak-exif` or `nom-exif` parses EXIF directly from memory buffer without external C dependencies.
