// BPM estimation via energy onset envelope + autocorrelation.
// Works on a mono Float32Array sampled at `sampleRate` Hz.

const ENV_RATE = 100; // envelope frames per second
const MIN_BPM = 70;
const MAX_BPM = 180;

export function estimateBPM(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate * 5) return null;

  // Use the middle 45 seconds at most (skip intro/outro silence).
  const targetLen = Math.min(samples.length, Math.floor(sampleRate * 45));
  const offset = Math.max(0, Math.floor((samples.length - targetLen) / 2));
  const block = Math.max(1, Math.floor(sampleRate / ENV_RATE));
  const envLen = Math.floor(targetLen / block);
  const env = new Float32Array(envLen);

  for (let i = 0; i < envLen; i++) {
    let sum = 0;
    const start = offset + i * block;
    for (let j = 0; j < block; j++) {
      const s = samples[start + j];
      sum += s * s;
    }
    env[i] = Math.sqrt(sum / block);
  }

  // Half-wave rectified difference => onset strength signal.
  const onset = new Float32Array(envLen);
  for (let i = 1; i < envLen; i++) {
    const d = env[i] - env[i - 1];
    onset[i] = d > 0 ? d : 0;
  }

  // Remove mean for stable autocorrelation.
  let mean = 0;
  for (let i = 0; i < envLen; i++) mean += onset[i];
  mean /= envLen;
  for (let i = 0; i < envLen; i++) onset[i] -= mean;

  const minLag = Math.floor((60 * ENV_RATE) / MAX_BPM);
  const maxLag = Math.floor((60 * ENV_RATE) / MIN_BPM);

  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    const end = envLen - lag;
    for (let i = 0; i < end; i++) acc += onset[i] * onset[i + lag];
    if (acc > bestScore) {
      bestScore = acc;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  // Parabolic interpolation around the peak for sub-bin precision.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const score = (lag: number) => {
      let acc = 0;
      const end = envLen - lag;
      for (let i = 0; i < end; i++) acc += onset[i] * onset[i + lag];
      return acc;
    };
    const y0 = score(bestLag - 1);
    const y1 = bestScore;
    const y2 = score(bestLag + 1);
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const delta = (0.5 * (y0 - y2)) / denom;
      if (delta > -1 && delta < 1) refinedLag = bestLag + delta;
    }
  }

  let bpm = (60 * ENV_RATE) / refinedLag;
  // Octave correction: prefer 85–155 BPM range typical for dance music.
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}