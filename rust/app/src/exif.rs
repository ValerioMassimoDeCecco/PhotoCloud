use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifMetadata {
    pub make: Option<String>,
    pub model: Option<String>,
    pub camera: Option<String>,
    pub date_time_original: Option<String>,
    pub date_time_original_ms: Option<i64>,
    pub aperture_f_number: Option<f64>,
    pub iso: Option<i64>,
    pub exposure_time_sec: Option<f64>,
    pub exposure_time_label: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_m: Option<f64>,
    pub has_gps: bool,
}

impl Default for ExifMetadata {
    fn default() -> Self {
        Self {
            make: None,
            model: None,
            camera: None,
            date_time_original: None,
            date_time_original_ms: None,
            aperture_f_number: None,
            iso: None,
            exposure_time_sec: None,
            exposure_time_label: None,
            focal_length_mm: None,
            latitude: None,
            longitude: None,
            altitude_m: None,
            has_gps: false,
        }
    }
}

pub fn empty_exif_metadata() -> ExifMetadata {
    ExifMetadata::default()
}

pub fn is_exif_parseable_filename(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".jpe")
}

const TAG_MAKE: u16 = 0x010f;
const TAG_MODEL: u16 = 0x0110;
const TAG_DATETIME: u16 = 0x0132;
const TAG_EXIF_IFD_PTR: u16 = 0x8769;
const TAG_GPS_IFD_PTR: u16 = 0x8825;
const TAG_EXPOSURE_TIME: u16 = 0x829a;
const TAG_FNUMBER: u16 = 0x829d;
const TAG_ISO: u16 = 0x8827;
const TAG_DATETIME_ORIGINAL: u16 = 0x9003;
const TAG_FOCAL_LENGTH: u16 = 0x920a;
const TAG_GPS_LAT_REF: u16 = 0x0001;
const TAG_GPS_LAT: u16 = 0x0002;
const TAG_GPS_LON_REF: u16 = 0x0003;
const TAG_GPS_LON: u16 = 0x0004;
const TAG_GPS_ALT_REF: u16 = 0x0005;
const TAG_GPS_ALT: u16 = 0x0006;

fn type_size(t: u16) -> usize {
    match t {
        1 | 2 | 7 => 1,
        3 => 2,
        4 | 9 => 4,
        5 | 10 => 8,
        _ => 1,
    }
}

struct TiffReader<'a> {
    buf: &'a [u8],
    base: usize,
    little_endian: bool,
}

impl<'a> TiffReader<'a> {
    fn u16_at(&self, off: usize) -> Option<u16> {
        let start = self.base.checked_add(off)?;
        let bytes = self.buf.get(start..start + 2)?;
        Some(if self.little_endian {
            u16::from_le_bytes([bytes[0], bytes[1]])
        } else {
            u16::from_be_bytes([bytes[0], bytes[1]])
        })
    }

    fn u32_at(&self, off: usize) -> Option<u32> {
        let start = self.base.checked_add(off)?;
        let bytes = self.buf.get(start..start + 4)?;
        Some(if self.little_endian {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        } else {
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        })
    }

    fn i32_at(&self, off: usize) -> Option<i32> {
        self.u32_at(off).map(|v| v as i32)
    }

    fn rational_at(&self, off: usize) -> Option<f64> {
        let num = self.u32_at(off)? as f64;
        let den = self.u32_at(off + 4)? as f64;
        if den == 0.0 {
            return None;
        }
        Some(num / den)
    }

    fn signed_rational_at(&self, off: usize) -> Option<f64> {
        let num = self.i32_at(off)? as f64;
        let den = self.i32_at(off + 4)? as f64;
        if den == 0.0 {
            return None;
        }
        Some(num / den)
    }

    fn read_ascii(&self, value_off: usize, count: usize) -> String {
        let start = match self.base.checked_add(value_off) {
            Some(v) => v,
            None => return String::new(),
        };
        let end = start.saturating_add(count).min(self.buf.len());
        if end <= start {
            return String::new();
        }
        let raw: String = self.buf[start..end]
            .iter()
            .map(|b| *b as char)
            .collect();
        let trimmed = match raw.find('\0') {
            Some(idx) => &raw[..idx],
            None => raw.as_str(),
        };
        trimmed.trim().to_string()
    }
}

struct IfdEntry {
    tag: u16,
    entry_type: u16,
    count: usize,
    value_offset: usize,
}

fn read_ifd_entries(r: &TiffReader, ifd_offset: u32) -> Vec<IfdEntry> {
    let mut entries = Vec::new();
    let ifd_offset = ifd_offset as usize;
    if ifd_offset == 0 {
        return entries;
    }
    let count = match r.u16_at(ifd_offset) {
        Some(c) => c as usize,
        None => return entries,
    };
    if count == 0 || count > 512 {
        return entries;
    }
    let table_off = ifd_offset + 2;
    for i in 0..count {
        let entry_off = match table_off.checked_add(i * 12) {
            Some(v) => v,
            None => break,
        };
        let tag = match r.u16_at(entry_off) {
            Some(v) => v,
            None => break,
        };
        let entry_type = match r.u16_at(entry_off + 2) {
            Some(v) => v,
            None => break,
        };
        let value_count = match r.u32_at(entry_off + 4) {
            Some(v) => v as usize,
            None => break,
        };
        if value_count > 4096 {
            continue;
        }
        let size = type_size(entry_type).saturating_mul(value_count);
        if size == 0 {
            continue;
        }
        let value_offset = if size <= 4 {
            entry_off + 8
        } else {
            match r.u32_at(entry_off + 8) {
                Some(v) => v as usize,
                None => continue,
            }
        };
        if r.base.saturating_add(value_offset).saturating_add(size) > r.buf.len() {
            continue;
        }
        entries.push(IfdEntry {
            tag,
            entry_type,
            count: value_count,
            value_offset,
        });
    }
    entries
}

fn find_entry(entries: &[IfdEntry], tag: u16) -> Option<&IfdEntry> {
    entries.iter().find(|e| e.tag == tag)
}

fn read_numeric_tag(r: &TiffReader, entry: Option<&IfdEntry>) -> Option<f64> {
    let entry = entry?;
    match entry.entry_type {
        3 if entry.count >= 1 => r.u16_at(entry.value_offset).map(|v| v as f64),
        4 if entry.count >= 1 => r.u32_at(entry.value_offset).map(|v| v as f64),
        5 if entry.count >= 1 => r.rational_at(entry.value_offset),
        9 if entry.count >= 1 => r.i32_at(entry.value_offset).map(|v| v as f64),
        10 if entry.count >= 1 => r.signed_rational_at(entry.value_offset),
        _ => None,
    }
}

fn read_ascii_tag(r: &TiffReader, entry: Option<&IfdEntry>) -> Option<String> {
    let entry = entry?;
    if entry.entry_type != 2 {
        return None;
    }
    let value = r.read_ascii(entry.value_offset, entry.count);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn read_gps_coordinate(
    r: &TiffReader,
    dms_entry: Option<&IfdEntry>,
    ref_entry: Option<&IfdEntry>,
) -> Option<f64> {
    let dms = dms_entry?;
    if dms.entry_type != 5 || dms.count < 3 {
        return None;
    }
    let deg = r.rational_at(dms.value_offset)?;
    let min = r.rational_at(dms.value_offset + 8)?;
    let sec = r.rational_at(dms.value_offset + 16)?;
    if !deg.is_finite() || !min.is_finite() || !sec.is_finite() {
        return None;
    }
    if deg < 0.0 || deg > 180.0 || min < 0.0 || min >= 60.0 || sec < 0.0 || sec >= 60.0 {
        return None;
    }
    let mut value = deg + min / 60.0 + sec / 3600.0;
    let reference = read_ascii_tag(r, ref_entry)
        .unwrap_or_default()
        .to_uppercase();
    if reference == "S" || reference == "W" {
        value = -value;
    }
    Some((value * 1e6).round() / 1e6)
}

pub fn parse_exif_datetime_ms(raw: Option<&str>) -> Option<i64> {
    let raw = raw?;
    let parts: Vec<&str> = raw
        .trim()
        .split(|c| c == ':' || c == ' ' || c == 'T')
        .collect();
    if parts.len() != 6 {
        return None;
    }
    let year: i32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;
    let hour: u32 = parts[3].parse().ok()?;
    let minute: u32 = parts[4].parse().ok()?;
    let second: u32 = parts[5].parse().ok()?;
    if year < 1970 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    let time = chrono::NaiveTime::from_hms_opt(hour, minute, second)?;
    Some(date.and_time(time).and_utc().timestamp_millis())
}

fn format_exposure_label(seconds: f64) -> String {
    if seconds >= 0.3 {
        let rounded = (seconds * 10.0).round() / 10.0;
        format!("{rounded} s")
    } else {
        let denom = (1.0 / seconds).round() as i64;
        format!("1/{denom}")
    }
}

pub fn parse_exif_from_jpeg(buffer: &[u8]) -> ExifMetadata {
    let mut out = empty_exif_metadata();
    if buffer.len() < 4 || buffer[0] != 0xff || buffer[1] != 0xd8 {
        return out;
    }

    let mut tiff_base: Option<usize> = None;
    let mut offset = 2usize;
    while offset + 4 <= buffer.len() {
        if buffer[offset] != 0xff {
            break;
        }
        let marker = buffer[offset + 1];
        if marker == 0xda {
            break;
        }
        let seg_len = u16::from_be_bytes([buffer[offset + 2], buffer[offset + 3]]) as usize;
        if seg_len < 2 {
            break;
        }
        if marker == 0xe1 {
            if offset + 10 <= buffer.len() && &buffer[offset + 4..offset + 10] == b"Exif\0\0" {
                tiff_base = Some(offset + 10);
            }
            break;
        }
        offset = match offset.checked_add(2 + seg_len) {
            Some(v) => v,
            None => break,
        };
    }

    let base = match tiff_base {
        Some(v) if v + 8 <= buffer.len() => v,
        _ => return out,
    };

    let little_endian = match &buffer[base..base + 2] {
        b"II" => true,
        b"MM" => false,
        _ => return out,
    };
    let r = TiffReader {
        buf: buffer,
        base,
        little_endian,
    };
    if r.u16_at(2) != Some(42) {
        return out;
    }
    let ifd0_offset = match r.u32_at(4) {
        Some(v) => v,
        None => return out,
    };
    let ifd0 = read_ifd_entries(&r, ifd0_offset);

    out.make = read_ascii_tag(&r, find_entry(&ifd0, TAG_MAKE));
    out.model = read_ascii_tag(&r, find_entry(&ifd0, TAG_MODEL));
    out.camera = match (&out.make, &out.model) {
        (Some(make), Some(model)) => {
            if model.to_lowercase().starts_with(&make.to_lowercase()) {
                Some(model.clone())
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (None, Some(model)) => Some(model.clone()),
        (Some(make), None) => Some(make.clone()),
        _ => None,
    };
    let generic_date = read_ascii_tag(&r, find_entry(&ifd0, TAG_DATETIME));

    let exif_offset = find_entry(&ifd0, TAG_EXIF_IFD_PTR)
        .and_then(|e| r.u32_at(e.value_offset))
        .unwrap_or(0);
    let exif_ifd = if exif_offset > 0 {
        read_ifd_entries(&r, exif_offset)
    } else {
        Vec::new()
    };

    out.date_time_original = read_ascii_tag(&r, find_entry(&exif_ifd, TAG_DATETIME_ORIGINAL))
        .or(generic_date);
    out.date_time_original_ms =
        parse_exif_datetime_ms(out.date_time_original.as_deref());

    if let Some(f) = read_numeric_tag(&r, find_entry(&exif_ifd, TAG_FNUMBER)) {
        if f.is_finite() && f > 0.0 && f < 1000.0 {
            out.aperture_f_number = Some((f * 10.0).round() / 10.0);
        }
    }
    if let Some(iso) = read_numeric_tag(&r, find_entry(&exif_ifd, TAG_ISO)) {
        if iso.is_finite() && iso > 0.0 && iso < 10_000_000.0 {
            out.iso = Some(iso.round() as i64);
        }
    }
    if let Some(exposure) = read_numeric_tag(&r, find_entry(&exif_ifd, TAG_EXPOSURE_TIME)) {
        if exposure.is_finite() && exposure > 0.0 && exposure < 86400.0 {
            out.exposure_time_sec = Some(exposure);
            out.exposure_time_label = Some(format_exposure_label(exposure));
        }
    }
    if let Some(focal) = read_numeric_tag(&r, find_entry(&exif_ifd, TAG_FOCAL_LENGTH)) {
        if focal.is_finite() && focal > 0.0 && focal < 10000.0 {
            out.focal_length_mm = Some((focal * 10.0).round() / 10.0);
        }
    }

    let gps_offset = find_entry(&ifd0, TAG_GPS_IFD_PTR)
        .and_then(|e| r.u32_at(e.value_offset))
        .unwrap_or(0);
    if gps_offset > 0 {
        let gps_ifd = read_ifd_entries(&r, gps_offset);
        let lat = read_gps_coordinate(
            &r,
            find_entry(&gps_ifd, TAG_GPS_LAT),
            find_entry(&gps_ifd, TAG_GPS_LAT_REF),
        );
        let lon = read_gps_coordinate(
            &r,
            find_entry(&gps_ifd, TAG_GPS_LON),
            find_entry(&gps_ifd, TAG_GPS_LON_REF),
        );
        if let Some(v) = lat {
            if v.abs() <= 90.0 {
                out.latitude = Some(v);
            }
        }
        if let Some(v) = lon {
            if v.abs() <= 180.0 {
                out.longitude = Some(v);
            }
        }
        if let Some(alt_entry) = find_entry(&gps_ifd, TAG_GPS_ALT) {
            if let Some(alt) = r.rational_at(alt_entry.value_offset) {
                if alt.is_finite() && alt.abs() < 100000.0 {
                    let mut reference = 0u8;
                    if let Some(ref_entry) = find_entry(&gps_ifd, TAG_GPS_ALT_REF) {
                        if ref_entry.entry_type == 1 && ref_entry.count >= 1 {
                            reference = *buffer
                                .get(base + ref_entry.value_offset)
                                .unwrap_or(&0);
                        }
                    }
                    out.altitude_m = Some(((if reference == 1 { -alt } else { alt }) * 10.0).round() / 10.0);
                }
            }
        }
    }
    out.has_gps = out.latitude.is_some() && out.longitude.is_some();
    out
}
