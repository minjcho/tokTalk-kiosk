/** Session-local automatic attempts, including failures, must never loop. */
export class SpeechAutoplayPolicy {
  private session: string | undefined;
  private attempted = new Set<string>();

  claim(session: string | undefined, key: string): boolean {
    if (this.session !== session) {
      this.session = session;
      this.attempted.clear();
    }
    if (!session || this.attempted.has(key)) return false;
    this.attempted.add(key);
    return true;
  }
}

// Local recorder failures and selected server STT failures map to approved codes.
// Provider messages, general API errors and TTS failures are never read aloud.
export function recoveryGuide(code: string | undefined) {
  switch (code) {
    case 'no-speech': case 'NO_SPEECH': case 'NO_AUDIO': return 'no-speech';
    case 'too-short': return 'too-short';
    case 'denied': return 'mic-denied';
    case 'unsupported': case 'insecure': case 'no-device': case 'device-busy':
    case 'permission-timeout': case 'failed': return 'mic-unavailable';
    case 'STT_FAILED': case 'STT_ERROR': return 'recognition-failed';
    default: return null;
  }
}
