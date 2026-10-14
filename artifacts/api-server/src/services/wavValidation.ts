import { KioskError } from "./errors";

const invalid = () => new KioskError("AUDIO_FORMAT", "녹음 파일 형식을 확인할 수 없습니다. 다시 녹음하거나 화면에서 주문해주세요.");

/** Native kiosk WAV only: PCM16, 1–2 channels. Never interpret headers as samples.
 * Energy detects near-silence, not speech; background audio still needs safe parsing.
 */
export function validatePcmWav(audio: Buffer): { durationMs: number; signalMs: number } {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw invalid();
  if (audio.readUInt32LE(4) + 8 !== audio.length) throw invalid();
  let format: { channels: number; rate: number; alignment: number } | undefined;
  let pcm: Buffer | undefined;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const length = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (length > audio.length - start) throw invalid();
    const id = audio.toString("ascii", offset, offset + 4);
    if (id === "fmt ") {
      if (format || length < 16) throw invalid();
      const encoding = audio.readUInt16LE(start);
      const channels = audio.readUInt16LE(start + 2);
      const rate = audio.readUInt32LE(start + 4);
      const bytesPerSecond = audio.readUInt32LE(start + 8);
      const alignment = audio.readUInt16LE(start + 12);
      if (encoding !== 1 || (channels !== 1 && channels !== 2) ||
          rate < 8_000 || rate > 96_000 || audio.readUInt16LE(start + 14) !== 16 ||
          alignment !== channels * 2 || bytesPerSecond !== rate * alignment) throw invalid();
      format = { channels, rate, alignment };
    } else if (id === "data") {
      if (pcm) throw invalid();
      pcm = audio.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
  }
  if (offset !== audio.length || !format || !pcm || !pcm.length || pcm.length % format.alignment) throw invalid();
  const frames = pcm.length / format.alignment;
  const durationMs = frames / format.rate * 1000;
  if (durationMs > 45_000) throw new KioskError("AUDIO_TOO_LARGE", "녹음이 너무 깁니다. 45초 이내로 나누어 말씀해주세요.");
  if (durationMs < 500) throw new KioskError("NO_AUDIO", "녹음이 너무 짧습니다. 메뉴와 수량을 끝까지 말씀해주세요.");
  // Windowed energy avoids rejecting a quiet, short utterance surrounded by silence.
  const windowFrames = Math.max(1, Math.floor(format.rate * 0.02));
  let signalFrames = 0;
  for (let start = 0; start < frames; start += windowFrames) {
    const count = Math.min(windowFrames, frames - start);
    let energy = 0;
    for (let frame = start; frame < start + count; frame++) {
      for (let channel = 0; channel < format.channels; channel++) {
        energy += (pcm.readInt16LE(frame * format.alignment + channel * 2) / 32768) ** 2;
      }
    }
    if (Math.sqrt(energy / (count * format.channels)) >= 0.0015) signalFrames += count;
  }
  const signalMs = signalFrames / format.rate * 1000;
  if (signalMs < 120) throw new KioskError("NO_AUDIO", "목소리가 들리지 않았습니다. 조금 더 가까이에서 말씀해주세요.");
  return { durationMs, signalMs };
}
