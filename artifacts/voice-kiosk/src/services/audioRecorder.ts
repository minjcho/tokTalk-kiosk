export type RecorderErrorCode = 'unsupported' | 'insecure' | 'denied' | 'no-device' | 'device-busy' | 'permission-timeout' | 'failed' | 'no-speech' | 'too-short';

export class RecorderError extends Error {
  code: RecorderErrorCode;
  constructor(code: RecorderErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface RecordingResult {
  blob: Blob;
  mimeType: 'audio/wav';
  durationMs: number;
}

export interface StartOptions {
  maxMs?: number;
  onLevel?: (rms: number) => void;
  onAutoStop?: () => void;
  onInterrupted?: () => void;
}

// Energy is not proof of speech. Reject only near-silence; STT/parser still
// have to reject noise and ambiguous requests. Keep this aligned with WAV validation.
const SIGNAL_RMS = 0.0015;
const MIN_SIGNAL_MS = 120;
const PERMISSION_TIMEOUT_MS = 20_000;

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, total * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

export class AudioRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private signalSamples = 0;
  private totalSamples = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rejectStart: ((error: RecorderError) => void) | null = null;
  private starting = false;
  private token = 0;
  active = false;

  async start(opts: StartOptions = {}): Promise<void> {
    if (this.active || this.starting) throw new RecorderError('failed');
    if (window.isSecureContext === false) throw new RecorderError('insecure');
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || (window as any).webkitAudioContext)) {
      throw new RecorderError('unsupported');
    }
    const token = ++this.token;
    this.starting = true;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      // Create/resume within the button gesture (not after the permission await),
      // needed by browsers with user-activation restrictions, notably mobile Safari.
      const ctx: AudioContext = new Ctor();
      this.ctx = ctx;
      const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      void resumed.catch(() => {}); // May reject while the permission UI is still open.
      const interrupted = new Promise<never>((_resolve, reject) => { this.rejectStart = reject; });
      void interrupted.catch(() => {});
      this.timer = setTimeout(() => this.cleanup(new RecorderError('permission-timeout')), PERMISSION_TIMEOUT_MS);
      const pendingStream = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }).then((stream) => {
        // getUserMedia cannot be aborted; stop a late grant after cancel/timeout.
        if (token !== this.token) {
          stream.getTracks().forEach((t) => t.stop());
          throw new RecorderError('failed', 'cancelled');
        }
        this.stream = stream;
        return stream;
      });
      const stream = await Promise.race([pendingStream, interrupted]);
      await Promise.race([resumed, interrupted]);
      if (token !== this.token || ctx.state !== 'running') throw new RecorderError('failed');
      if (!stream.getAudioTracks().some((t) => t.readyState === 'live')) throw new RecorderError('no-device');
      this.rejectStart = null;
      if (this.timer) clearTimeout(this.timer);
      this.chunks = []; this.signalSamples = 0; this.totalSamples = 0;
      const maxMs = Math.max(500, Math.min(45_000, opts.maxMs ?? 45_000));
      const maxSamples = Math.floor(ctx.sampleRate * maxMs / 1000);
      for (const track of stream.getAudioTracks()) track.onended = () => {
        this.cleanup();
        opts.onInterrupted?.();
      };
      this.src = ctx.createMediaStreamSource(stream);
      this.proc = ctx.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (ev) => {
        if (!this.active) return;
        const input = ev.inputBuffer.getChannelData(0);
        const count = Math.min(input.length, maxSamples - this.totalSamples);
        if (count <= 0) return;
        const data = new Float32Array(input.subarray(0, count));
        this.chunks.push(data);
        this.totalSamples += data.length;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const windowSamples = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
        for (let start = 0; start < data.length; start += windowSamples) {
          const n = Math.min(windowSamples, data.length - start);
          let energy = 0;
          for (let i = start; i < start + n; i++) energy += data[i] * data[i];
          if (Math.sqrt(energy / n) >= SIGNAL_RMS) this.signalSamples += n;
        }
        opts.onLevel?.(rms);
      };
      this.src.connect(this.proc);
      this.proc.connect(ctx.destination);
      this.active = true;
      this.starting = false;
      this.timer = setTimeout(() => {
        try { opts.onAutoStop?.(); }
        finally { if (this.active) this.cleanup(); } // Safety even without a UI callback.
      }, maxMs);
    } catch (e) {
      if (token === this.token) this.cleanup();
      if (e instanceof RecorderError) throw e;
      const name = (e as DOMException)?.name;
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new RecorderError('no-device');
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new RecorderError('denied');
      if (name === 'NotReadableError' || name === 'AbortError') throw new RecorderError('device-busy');
      throw new RecorderError('failed');
    }
  }

  async stop(): Promise<RecordingResult> {
    if (!this.active || !this.ctx) throw new RecorderError('failed');
    const rate = this.ctx.sampleRate;
    const durationMs = this.totalSamples / rate * 1000;
    const chunks = this.chunks;
    const signalMs = this.signalSamples / rate * 1000;
    this.cleanup();
    if (durationMs < 500) throw new RecorderError('too-short');
    if (signalMs < MIN_SIGNAL_MS) throw new RecorderError('no-speech');
    return { blob: encodeWav(chunks, rate), mimeType: 'audio/wav', durationMs };
  }

  cancel() { this.cleanup(); }

  private cleanup(reason = new RecorderError('failed', 'cancelled')) {
    this.token++;
    this.active = false;
    this.starting = false;
    this.rejectStart?.(reason);
    this.rejectStart = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.proc) { this.proc.onaudioprocess = null; try { this.proc.disconnect(); } catch { /* */ } }
    try { this.src?.disconnect(); } catch { /* */ }
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.ctx?.close().catch(() => {});
    this.proc = null; this.src = null; this.stream = null; this.ctx = null; this.chunks = [];
    this.signalSamples = 0; this.totalSamples = 0;
  }
}
