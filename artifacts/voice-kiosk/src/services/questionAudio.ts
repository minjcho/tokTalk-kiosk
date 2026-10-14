import type { ClarificationSpeechInputSpeed } from '@workspace/api-client-react';

export type SpeechState = 'idle' | 'loading' | 'playing' | 'done' | 'blocked' | 'error';
type Loader = (signal: AbortSignal, speed: SpeechSpeed) => Promise<Blob>;
type AudioElement = Pick<HTMLAudioElement, 'src' | 'play' | 'pause' | 'load' | 'removeAttribute' | 'onended' | 'onerror'>;
interface AudioEnvironment {
  createAudio: () => AudioElement;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

/** Only the current question or approved guide is kept in memory for replay. */
export class QuestionAudio {
  private loader: Loader | null = null;
  private speed: SpeechSpeed = 'normal';
  private blob: Blob | null = null;
  private audio: AudioElement | null = null;
  private url: string | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private env: AudioEnvironment;
  private notify: (state: SpeechState) => void;

  constructor(notify: (state: SpeechState) => void, env?: AudioEnvironment) {
    this.notify = notify;
    this.env = env ?? {
      createAudio: () => new Audio(),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    };
  }

  setQuestion(loader: Loader | null) {
    this.stop(true);
    this.loader = loader;
  }

  /** A pace change invalidates even cached bytes, but retains only the current loader. */
  setSpeed(speed: SpeechSpeed): boolean {
    if (this.speed === speed) return false;
    this.stop();
    this.blob = null;
    this.speed = speed;
    return true;
  }

  private releaseAudio() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.url) this.env.revokeUrl(this.url);
    this.url = null;
  }

  stop(forget = false) {
    ++this.generation; // Abort is not enough: a completed/late request may ignore it.
    this.controller?.abort();
    this.controller = null;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    this.releaseAudio();
    if (forget) { this.blob = null; this.loader = null; }
    this.notify('idle');
  }

  async play(): Promise<void> {
    if (!this.loader) return;
    this.stop();
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.notify('loading');
    const controller = new AbortController();
    this.controller = controller;
    this.deadline = setTimeout(() => {
      if (!current()) return;
      this.stop();
      this.notify('error');
    }, 30_000);
    try {
      // Cached replay reaches audio.play() synchronously from the button gesture.
      const blob = this.blob ?? await this.loader(controller.signal, this.speed);
      if (!current()) return;
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Invalid question audio');
      this.blob = blob;
      const audio = this.env.createAudio();
      this.audio = audio;
      this.url = this.env.createUrl(blob);
      audio.src = this.url;
      audio.onended = () => {
        if (!current()) return;
        this.stop(); this.notify('done');
      };
      audio.onerror = () => {
        if (!current()) return;
        this.stop(); this.blob = null; this.notify('error');
      };
      await audio.play();
      if (!current()) return;
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = null;
      this.controller = null;
      this.notify('playing');
    } catch (error) {
      if (!current()) return;
      // Keep the loader and bytes so an autoplay block can be retried with a tap.
      this.stop();
      this.notify((error as { name?: string })?.name === 'NotAllowedError' ? 'blocked' : 'error');
    }
  }
}

export type SpeechSpeed = ClarificationSpeechInputSpeed;
