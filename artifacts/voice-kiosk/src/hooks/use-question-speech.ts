import { useCallback, useEffect, useRef, useState } from 'react';
import { speakClarification, speakGuidance, type GuidanceSpeechInput } from '@workspace/api-client-react';
import { QuestionAudio, type SpeechState, type SpeechSpeed } from '@/services/questionAudio';
import { SpeechAutoplayPolicy } from '@/services/speechPolicy';

export function useQuestionSpeech(
  sessionId: string | undefined, revision: number | undefined, question: string | null, turn: number,
  canPlay: () => boolean,
  guide: GuidanceSpeechInput['guide'] | null = null, enabled = true,
) {
  const [state, setState] = useState<SpeechState>('idle');
  const [speed, setSpeedState] = useState<SpeechSpeed>('normal');
  const speedSession = useRef(sessionId);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [player] = useState(() => new QuestionAudio(setState));
  const [autoplay] = useState(() => new SpeechAutoplayPolicy());
  const stop = useCallback(() => player.stop(), [player]);
  const clear = useCallback(() => player.setQuestion(null), [player]);

  useEffect(() => {
    if (speedSession.current !== sessionId) {
      speedSession.current = sessionId;
      player.setSpeed('normal');
      setSpeedState('normal');
    }
    player.setQuestion(sessionId && revision !== undefined && (guide || question)
      ? (signal, speed) => guide
        ? speakGuidance(sessionId, { revision, guide }, { signal, cache: 'no-store', responseType: 'blob' })
        : speakClarification(sessionId, { revision, question: question!, speed }, { signal, cache: 'no-store', responseType: 'blob' })
      : null);
    return () => player.setQuestion(null);
  }, [player, sessionId, revision, question, turn, guide]);

  useEffect(() => {
    if (!enabled || !canPlay()) { player.stop(); return; }
    if (!sessionId) { autoplay.claim(undefined, ''); return; }
    if (revision === undefined || (!guide && !question) || mutedRef.current || document.hidden) return;
    // Guides get one automatic attempt per code per session, even after another
    // recording fails. Questions get one attempt per server question turn.
    const key = guide ? `guide:${guide}` : `question:${revision}:${turn}:${question}`;
    if (autoplay.claim(sessionId, key)) void player.play();
  }, [player, autoplay, sessionId, revision, question, turn, guide, enabled, canPlay]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) player.stop(); };
    const leave = () => player.stop(true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      player.stop(true);
    };
  }, [player]);

  const toggleMuted = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) player.stop();
    // Unmuting never starts playback while the microphone might be active.
    // The separate replay button explicitly starts the current announcement.
  }, [player]);
  const replay = useCallback(() => {
    if (!mutedRef.current && !document.hidden && enabled && canPlay()) void player.play();
  }, [player, enabled, canPlay]);
  const setSpeed = useCallback((speed: SpeechSpeed) => {
    // Cancel before React effects, so a later microphone start cannot race playback.
    if (!player.setSpeed(speed)) return;
    setSpeedState(speed);
    // Reading pace changes only reread a current question, never a welcome/error guide.
    if (!guide && question && !mutedRef.current && !document.hidden && enabled && canPlay()) void player.play();
  }, [player, guide, question, enabled, canPlay]);
  return { state, muted, speed, setSpeed, stop, clear, toggleMuted, replay };
}
