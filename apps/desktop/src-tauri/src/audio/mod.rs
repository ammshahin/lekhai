//! Microphone capture for dictation.
//!
//! `cpal::Stream` is not `Send`, so each recording runs on its own thread that owns the
//! stream. `Recorder` talks to that thread through channels.

mod process;

pub use process::{analyse, encode_wav, meter_level, resample_linear, TARGET_SAMPLE_RATE};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Hard cap so a stuck hotkey can't fill memory. Meeting mode (v0.2) streams to disk instead.
const MAX_SECONDS: usize = 5 * 60;
/// How often the input level is reported while recording (~30 fps for the indicator).
const LEVEL_INTERVAL: Duration = Duration::from_millis(33);

/// Receives the input loudness (0–1, see `meter_level`) while recording.
pub type LevelCallback = Box<dyn Fn(f32) + Send>;

/// Mono samples captured from the microphone at the device's native rate.
pub struct Captured {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub duration: Duration,
}

struct Active {
    stop_tx: mpsc::Sender<()>,
    handle: JoinHandle<Result<Captured, String>>,
}

#[derive(Default)]
pub struct Recorder {
    active: Option<Active>,
}

impl Recorder {
    pub fn is_recording(&self) -> bool {
        self.active.is_some()
    }

    /// Opens the default input device and starts capturing. Returns once the stream is running.
    pub fn start(&mut self, on_level: LevelCallback) -> Result<(), String> {
        if self.active.is_some() {
            return Ok(());
        }
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let handle = std::thread::Builder::new()
            .name("audio-capture".into())
            .spawn(move || capture_thread(stop_rx, ready_tx, on_level))
            .map_err(|e| format!("Could not start audio thread: {e}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                self.active = Some(Active { stop_tx, handle });
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => Err("Microphone did not start in time".into()),
        }
    }

    /// Stops capturing and returns everything recorded since `start`.
    pub fn stop(&mut self) -> Result<Captured, String> {
        let active = self.active.take().ok_or("Not recording")?;
        let _ = active.stop_tx.send(());
        active
            .handle
            .join()
            .map_err(|_| "Audio thread panicked".to_string())?
    }
}

type Setup = (cpal::Stream, Arc<Mutex<Vec<f32>>>, u32);

fn capture_thread(
    stop_rx: mpsc::Receiver<()>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    on_level: LevelCallback,
) -> Result<Captured, String> {
    let setup = || -> Result<Setup, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No microphone found. Check your input device in system settings.")?;
        let supported = device
            .default_input_config()
            .map_err(|e| format!("Microphone config error: {e}"))?;
        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels() as usize;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();

        let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(
            sample_rate as usize * 30,
        )));
        let max_samples = sample_rate as usize * MAX_SECONDS;

        let stream = match format {
            SampleFormat::F32 => {
                build_stream::<f32>(&device, &config, channels, max_samples, buffer.clone())
            }
            SampleFormat::I16 => {
                build_stream::<i16>(&device, &config, channels, max_samples, buffer.clone())
            }
            SampleFormat::U16 => {
                build_stream::<u16>(&device, &config, channels, max_samples, buffer.clone())
            }
            SampleFormat::I32 => {
                build_stream::<i32>(&device, &config, channels, max_samples, buffer.clone())
            }
            other => return Err(format!("Unsupported microphone sample format: {other:?}")),
        }?;
        stream
            .play()
            .map_err(|e| format!("Could not start microphone: {e}"))?;
        Ok((stream, buffer, sample_rate))
    };

    let (stream, buffer, sample_rate) = match setup() {
        Ok(v) => {
            let _ = ready_tx.send(Ok(()));
            v
        }
        Err(e) => {
            let _ = ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };

    let started = Instant::now();
    // Until stop (or the Recorder being dropped), report the loudness of the newest audio.
    let mut reported = 0;
    while let Err(mpsc::RecvTimeoutError::Timeout) = stop_rx.recv_timeout(LEVEL_INTERVAL) {
        let rms = {
            let Ok(buf) = buffer.lock() else { break };
            let rms = analyse(&buf[reported.min(buf.len())..]).rms;
            reported = buf.len();
            rms
        };
        on_level(meter_level(rms));
    }
    drop(stream);
    let duration = started.elapsed();

    let samples = std::mem::take(&mut *buffer.lock().map_err(|_| "Audio buffer poisoned")?);
    Ok(Captured {
        samples,
        sample_rate,
        duration,
    })
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    max_samples: usize,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    let err_fn = |err| log::error!("audio stream error: {err}");
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let Ok(mut buf) = buffer.lock() else { return };
                if buf.len() >= max_samples {
                    return;
                }
                // Downmix interleaved frames to mono.
                for frame in data.chunks(channels.max(1)) {
                    let sum: f32 = frame
                        .iter()
                        .map(|s| <f32 as cpal::FromSample<T>>::from_sample_(*s))
                        .sum();
                    buf.push(sum / frame.len() as f32);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Could not open microphone: {e}"))
}
