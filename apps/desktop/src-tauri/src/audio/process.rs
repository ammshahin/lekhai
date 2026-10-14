//! Pure audio helpers (no devices), unit-tested.

use std::io::Cursor;

/// Whisper models work at 16 kHz; sending more only costs upload time.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Linear-interpolation resampler. Good enough for speech going to STT.
pub fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if input.is_empty() || from_rate == to_rate || from_rate == 0 {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Encodes mono f32 samples as 16-bit PCM WAV in memory.
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::with_capacity(samples.len() * 2 + 44));
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for &s in samples {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer.write_sample(v).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipStats {
    pub rms: f32,
    pub peak: f32,
}

impl ClipStats {
    /// Whisper invents text ("Thank you.") on silence, so silent clips are never sent.
    pub fn is_silent(&self) -> bool {
        self.peak < 0.02 || self.rms < 0.003
    }
}

pub fn analyse(samples: &[f32]) -> ClipStats {
    if samples.is_empty() {
        return ClipStats {
            rms: 0.0,
            peak: 0.0,
        };
    }
    let mut sum_sq = 0.0f64;
    let mut peak = 0.0f32;
    for &s in samples {
        sum_sq += (s as f64) * (s as f64);
        peak = peak.max(s.abs());
    }
    ClipStats {
        rms: (sum_sq / samples.len() as f64).sqrt() as f32,
        peak,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_length() {
        let input: Vec<f32> = (0..48_000).map(|i| (i as f32 / 100.0).sin()).collect();
        let out = resample_linear(&input, 48_000, 16_000);
        assert_eq!(out.len(), 16_000);
    }

    #[test]
    fn resample_same_rate_is_identity() {
        let input = vec![0.1, 0.2, 0.3];
        assert_eq!(resample_linear(&input, 16_000, 16_000), input);
    }

    #[test]
    fn wav_has_header_and_samples() {
        let wav = encode_wav(&[0.0, 0.5, -0.5, 1.0], 16_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + 4 * 2);
    }

    #[test]
    fn silence_is_detected() {
        assert!(analyse(&vec![0.0; 1000]).is_silent());
        let speech: Vec<f32> = (0..1000).map(|i| (i as f32 / 5.0).sin() * 0.3).collect();
        assert!(!analyse(&speech).is_silent());
    }
}
