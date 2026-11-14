import fs from 'fs';
import path from 'path';

function createWavFile(filename: string, durationSeconds: number, baseFreq: number, chordType: 'minor' | 'dim' | 'dark'): void {
  const sampleRate = 22050; // lightweight for fast loading and great atmospheric sound
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const numSamples = sampleRate * durationSeconds;
  const subChunk2Size = numSamples * numChannels * bytesPerSample;
  const chunkSize = 36 + subChunk2Size;

  const buffer = Buffer.alloc(44 + subChunk2Size);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(chunkSize, 4);
  buffer.write('WAVE', 8);

  // "fmt " sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // "data" sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(subChunk2Size, 40);

  // Chord intervals
  const f1 = baseFreq;
  const f2 = chordType === 'minor' ? baseFreq * 1.1892 : chordType === 'dim' ? baseFreq * 1.1892 * 0.95 : baseFreq * 1.2599;
  const f3 = baseFreq * 1.4983;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Slow atmospheric pulse & tremolo
    const lfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.3 * t);
    const envelope = Math.min(1, t / 0.5) * Math.min(1, (durationSeconds - t) / 0.8);

    // Multi-oscillator dark ambient drone
    const osc1 = Math.sin(2 * Math.PI * f1 * t);
    const sub = 0.5 * Math.sin(2 * Math.PI * (f1 / 2) * t);
    const osc2 = 0.4 * Math.sin(2 * Math.PI * f2 * t + 0.1);
    const osc3 = 0.35 * Math.sin(2 * Math.PI * f3 * t + 0.2);
    const harmonic = 0.2 * Math.sin(2 * Math.PI * (f1 * 3) * t) * Math.cos(2 * Math.PI * 0.1 * t);

    const sample = (osc1 + sub + osc2 + osc3 + harmonic) * 0.3 * lfo * envelope;
    const clamped = Math.max(-1, Math.min(1, sample));
    const intSample = Math.floor(clamped * 32767);

    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  const outDir = path.resolve('public/audio');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(path.join(outDir, filename), buffer);
}

createWavFile('crown_of_thorns.wav', 18, 110.0, 'minor'); // A2 minor brooding gothic
createWavFile('midnight_rose.wav', 16, 98.0, 'dark');    // G2 dark gothic ambient
createWavFile('cathedral_veil.wav', 20, 82.4, 'minor');   // E2 low dark gothic cathedral
console.log('Generated dark gothic audio files in public/audio/');
