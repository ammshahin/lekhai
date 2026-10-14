// Short start/stop tones so you know the mic is live without looking at the screen.
let ctx: AudioContext | undefined;

function tone(freq: number, ms: number) {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    // audio output unavailable; ignore
  }
}

export const playStart = () => tone(880, 90);
export const playStop = () => tone(587, 90);
export const playError = () => tone(220, 220);
