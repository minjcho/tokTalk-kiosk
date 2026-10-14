import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addCartItem, cancelSession, confirmOrder, createSession, getSession, removeCartItem,
  submitTextOrder, submitVoiceOrder, touchSession, updateCartItem, useGetKioskStatus, useGetMenu,
  type MenuItem, type OrderReceipt, type OrderResult, type OrderSession, type GuidanceSpeechInput,
} from '@workspace/api-client-react';
import { AudioRecorder, RecorderError, blobToBase64 } from '@/services/audioRecorder';
import { describeError } from '@/lib/format';
import { useQuestionSpeech } from './use-question-speech';
import { recoveryGuide } from '@/services/speechPolicy';
import type { SpeechSpeed } from '@/services/questionAudio';
import { createKioskAnalytics, type MenuOpenSource } from '@/lib/kiosk-analytics';
import { menuVisibilityForResult } from '@/services/menuUiAction';

export interface ItemConfig { menuId?: string; quantity: number; temperature: 'ice' | 'hot'; size: string; options: string[] }
export type RecState = 'idle' | 'starting' | 'recording' | 'analyzing';

const MAX_REC_SEC = 45;
const WARN_SEC = 30;
const BARS = 28;

const REC_MSG: Record<string, string> = {
  unsupported: '이 기기에서는 마이크를 사용할 수 없어요. 화면을 눌러 주문해 주세요.',
  insecure: '보안 연결(HTTPS)에서 마이크를 사용할 수 있어요. 화면을 눌러 주문해 주세요.',
  denied: '마이크 사용이 허용되지 않았어요. 브라우저 설정에서 마이크를 허용해 주세요.',
  'no-device': '마이크를 찾을 수 없어요. 연결을 확인해 주세요.',
  'device-busy': '마이크를 다른 앱이 사용 중이거나 연결이 끊겼어요. 연결을 확인하거나 화면에서 주문해 주세요.',
  'permission-timeout': '마이크 권한 응답이 없어요. 브라우저 권한을 확인한 뒤 다시 누르거나 화면에서 주문해 주세요.',
  failed: '녹음을 시작하지 못했어요. 다시 시도해 주세요.',
  'no-speech': '목소리가 들리지 않았어요. 마이크 버튼을 누르고 다시 말씀해 주세요.',
  'too-short': '너무 짧게 녹음되었어요. 주문하실 메뉴를 끝까지 말씀해 주세요.',
};

function useKioskController() {
  const qc = useQueryClient();
  const menuQ = useGetMenu();
  const statusQ = useGetKioskStatus();
  const idleTimeout = statusQ.data?.idleTimeoutSeconds ?? 180;
  const idleTimeoutRef = useRef(idleTimeout);
  idleTimeoutRef.current = idleTimeout;

  const [session, setSession] = useState<OrderSession | null>(null);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [busy, setBusy] = useState<string | null>('init');
  const [initError, setInitError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractedJson, setExtractedJson] = useState<string | null>(null);
  const [recState, setRecState] = useState<RecState>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [idleLeft, setIdleLeft] = useState(180);
  const [questionTurn, setQuestionTurn] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guidance, setGuidance] = useState<GuidanceSpeechInput['guide'] | null>(null);
  const speechQuestion = error && !guidance ? null : clarification;

  const genRef = useRef(0);
  const busyRef = useRef(true);
  const sessionRef = useRef<OrderSession | null>(null);
  const recRef = useRef(new AudioRecorder());
  const recStateRef = useRef<RecState>('idle');
  const lastActivity = useRef(Date.now());
  const recTick = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLevelAt = useRef(0);
  const finishRef = useRef<() => void>(() => {});
  const lastPing = useRef(0);
  const analyticsRef = useRef(createKioskAnalytics());
  const canPlayQuestion = useCallback(() =>
    !busyRef.current && recStateRef.current === 'idle' && sessionRef.current?.status === 'active', []);
  const speech = useQuestionSpeech(session?.id, session?.revision, speechQuestion, questionTurn, canPlayQuestion, guidance, busy === null && recState === 'idle');
  const { stop: stopSpeech, clear: clearSpeech } = speech;

  const setRec = (s: RecState) => {
    recStateRef.current = s; setRecState(s);
    analyticsRef.current.recordingChanged(s === 'recording');
  };
  const setSess = (s: OrderSession | null) => { sessionRef.current = s; setSession(s); };
  const clearTick = () => { if (recTick.current) clearInterval(recTick.current); recTick.current = null; };
  const changeMenu = useCallback((open: boolean, source: MenuOpenSource = 'button') => {
    setMenuOpen(open);
    analyticsRef.current.menuChanged(open, source);
  }, []);

  const startNew = useCallback(() => {
    const gen = ++genRef.current;
    analyticsRef.current.reset();
    clearSpeech();
    setGuidance(null); changeMenu(false);
    recRef.current.cancel(); clearTick();
    setRec('idle'); setRecSeconds(0); setLevels(Array(BARS).fill(0));
    setSess(null); setReceipt(null); setTranscript(null); setMessage(null); setClarification(null);
    setError(null); setExtractedJson(null); setInitError(null);
    busyRef.current = true; setBusy('init');
    lastActivity.current = Date.now();
    createSession().then((s) => {
      if (gen !== genRef.current) return;
      setSess(s); setGuidance('welcome'); busyRef.current = false; setBusy(null); lastActivity.current = Date.now();
    }).catch((e) => {
      if (gen !== genRef.current) return;
      setInitError(describeError(e).message); busyRef.current = false; setBusy(null);
    });
  }, [clearSpeech, changeMenu]);

  const reset = useCallback(() => {
    const old = sessionRef.current;
    if (old) {
      cancelSession(old.id).catch(() => {});
      qc.removeQueries({ queryKey: [`/api/kiosk/sessions/${old.id}`] });
      qc.removeQueries({ queryKey: [`/api/kiosk/sessions/${old.id}/debug`] });
    }
    startNew();
  }, [qc, startNew]);

  useEffect(() => {
    startNew();
    return () => { genRef.current++; recRef.current.cancel(); clearTick(); };
  }, [startNew]);

  useEffect(() => {
    const interrupt = () => {
      if (recStateRef.current !== 'starting' && recStateRef.current !== 'recording') return;
      recRef.current.cancel(); clearTick(); setRec('idle');
      setRecSeconds(0); setLevels(Array(BARS).fill(0));
      setError('화면을 벗어나 녹음을 취소했어요. 다시 누르고 말씀해 주세요.');
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', interrupt);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', interrupt);
    };
  }, []);

  const recordActivity = useCallback((force = false) => {
    if (busyRef.current) return;
    const now = Date.now();
    lastActivity.current = now;
    const current = sessionRef.current;
    if (!current || current.status !== 'active' || (!force && now - lastPing.current < 10_000)) return;
    lastPing.current = now;
    const gen = genRef.current;
    touchSession(current.id).catch((e) => {
      if (gen !== genRef.current) return;
      if (describeError(e).status === 410) reset();
    });
  }, [reset]);

  // idle handling
  useEffect(() => {
    let last = 0;
    const bump = () => {
      const n = Date.now();
      if (n - last < 500 || busyRef.current) return;
      last = n; recordActivity();
    };
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      const left = Math.max(0, idleTimeoutRef.current - Math.floor((Date.now() - lastActivity.current) / 1000));
      setIdleLeft(left);
      if (left <= 0 && !busyRef.current) reset();
    }, 1000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, [reset, recordActivity]);

  const keepAlive = useCallback(() => { recordActivity(true); setIdleLeft(idleTimeoutRef.current); }, [recordActivity]);

  const applyResult = (r: OrderResult, source: 'voice' | 'text') => {
    if (r.uiAction === 'show_menu' || r.uiAction === 'close_menu') {
      const visible = menuVisibilityForResult(r, sessionRef.current);
      if (visible !== undefined) {
        // Preserve the live cart, clarification turn and extraction. UI-only
        // responses, including request-ID replays, are not new order answers.
        setGuidance(null); setTranscript(r.transcript); changeMenu(visible, source);
      }
      return;
    }
    if (r.session.status === 'cancelled') { reset(); return; }
    setSess(r.session);
    setGuidance(null);
    setTranscript(r.transcript);
    setMessage(r.message);
    setClarification(r.needsClarification ? r.message : r.session.clarification);
    setQuestionTurn((turn) => turn + 1);
    setExtractedJson(r.extractedJson);
  };

  async function run<T>(label: string, fn: (s: OrderSession) => Promise<T>, onOk: (r: T) => void) {
    const s = sessionRef.current;
    if (!s || busyRef.current || recStateRef.current !== 'idle') return false;
    stopSpeech();
    setGuidance(null);
    const gen = genRef.current;
    busyRef.current = true; setBusy(label); setError(null);
    let ok = false;
    try {
      const r = await fn(s);
      if (gen !== genRef.current) return false;
      onOk(r); ok = true;
    } catch (e) {
      if (gen !== genRef.current) return false;
      const d = describeError(e);
      setError(d.message);
      setGuidance(recoveryGuide(d.code));
      if (d.transcript) setTranscript(d.transcript);
      if (d.status === 409) {
        try { const fresh = await getSession(s.id); if (gen === genRef.current) { setSess(fresh); setClarification(fresh.clarification); } } catch { /* keep */ }
      }
      if (d.status === 410) { reset(); return false; }
    } finally {
      if (gen === genRef.current) { busyRef.current = false; setBusy(null); lastActivity.current = Date.now(); }
    }
    return ok;
  }

  const finishRecording = useCallback(async () => {
    if (recStateRef.current !== 'recording') return;
    const gen = genRef.current;
    const s = sessionRef.current;
    clearTick();
    setRec('analyzing'); busyRef.current = true; setBusy('voice'); setError(null); setGuidance(null);
    try {
      const rec = await recRef.current.stop();
      const audioBase64 = await blobToBase64(rec.blob);
      if (gen !== genRef.current || !s) return;
      const r = await submitVoiceOrder(s.id, { audioBase64, mimeType: 'audio/wav', revision: s.revision, requestId: crypto.randomUUID() });
      if (gen !== genRef.current) return;
      applyResult(r, 'voice');
    } catch (e) {
      if (gen !== genRef.current) return;
      if (e instanceof RecorderError) {
        setError(REC_MSG[e.code] ?? REC_MSG.failed);
        setGuidance(recoveryGuide(e.code));
      }
      else {
        const d = describeError(e);
        setError(d.message);
        setGuidance(recoveryGuide(d.code));
        if (d.transcript) setTranscript(d.transcript);
        if (d.status === 409 && s) { try { const f = await getSession(s.id); if (gen === genRef.current) { setSess(f); setClarification(f.clarification); } } catch { /* */ } }
        if (d.status === 410) reset();
      }
    } finally {
      if (gen === genRef.current) { setRec('idle'); busyRef.current = false; setBusy(null); setRecSeconds(0); setLevels(Array(BARS).fill(0)); lastActivity.current = Date.now(); }
    }
  }, [reset, changeMenu]);
  finishRef.current = finishRecording;

  const toggleMic = useCallback(async () => {
    if (recStateRef.current === 'recording') { await finishRecording(); return; }
    if (recStateRef.current !== 'idle' || busyRef.current || !sessionRef.current) return;
    stopSpeech(); // Cancel downloads and playback before requesting microphone access.
    setGuidance(null);
    const gen = genRef.current;
    setError(null); setRec('starting');
    try {
      await recRef.current.start({
        maxMs: MAX_REC_SEC * 1000,
        onLevel: (rms) => {
          const n = performance.now();
          if (n - lastLevelAt.current < 70) return;
          lastLevelAt.current = n;
          setLevels((p) => [...p.slice(1), Math.min(1, rms * 9)]);
        },
        onAutoStop: () => finishRef.current(),
        onInterrupted: () => {
          clearTick(); setRec('idle'); setRecSeconds(0); setLevels(Array(BARS).fill(0));
          setError(REC_MSG['device-busy']);
          setGuidance('mic-unavailable');
        },
      });
      if (gen !== genRef.current) { recRef.current.cancel(); return; }
      setRec('recording'); setRecSeconds(0);
      const t0 = Date.now();
      recTick.current = setInterval(() => setRecSeconds(Math.min(MAX_REC_SEC, Math.floor((Date.now() - t0) / 1000))), 250);
    } catch (e) {
      if (gen !== genRef.current) return;
      if (e instanceof RecorderError && e.message === 'cancelled') return;
      setRec('idle');
      if (e instanceof RecorderError) {
        setError(REC_MSG[e.code] ?? REC_MSG.failed);
        setGuidance(recoveryGuide(e.code));
      }
    }
  }, [finishRecording, stopSpeech]);

  const submitText = (text: string) =>
    run('text', (s) => submitTextOrder(s.id, { text, revision: s.revision, requestId: crypto.randomUUID() }), (r) => applyResult(r, 'text'));

  const applyCartResult = (r: OrderSession) => {
    setSess(r); setClarification(r.clarification); setMessage(null);
  };
  const addItem = (c: ItemConfig) =>
    run('cart', (s) => addCartItem(s.id, { menuId: c.menuId!, quantity: c.quantity, temperature: c.temperature, size: c.size, options: c.options, revision: s.revision }), applyCartResult);

  const updateItem = (id: string, c: ItemConfig) =>
    run('cart', (s) => updateCartItem(s.id, id, { quantity: c.quantity, temperature: c.temperature, size: c.size, options: c.options, revision: s.revision }), applyCartResult);

  const removeItem = (id: string) => run('cart', (s) => removeCartItem(s.id, id, { revision: s.revision }), applyCartResult);

  const confirm = () =>
    run('confirm', (s) => confirmOrder(s.id, { revision: s.revision }), (r) => {
      const old = sessionRef.current;
      if (old) qc.removeQueries({ queryKey: [`/api/kiosk/sessions/${old.id}/debug`] });
      setReceipt(r); setSess(null); setTranscript(null); setMessage(null);
      setClarification(null); setExtractedJson(null); setError(null);
      clearSpeech();
      setGuidance(null); changeMenu(false);
      analyticsRef.current.orderConfirmed();
    });

  const menu: MenuItem[] = useMemo(() => menuQ.data ?? [], [menuQ.data]);

  return {
    menu, menuLoading: menuQ.isLoading, menuError: menuQ.isError, refetchMenu: () => menuQ.refetch(),
    status: statusQ.data, aiReady: statusQ.data ? statusQ.data.aiReady : true,
    session, receipt, busy, initError, retryInit: startNew, transcript, message, clarification, error, extractedJson,
    recState, recSeconds, levels, maxRecSec: MAX_REC_SEC, idleLeft, warnSec: WARN_SEC,
    menuOpen, showMenu: () => changeMenu(true, 'button'), closeMenu: () => changeMenu(false),
    toggleMic, submitText, addItem, updateItem, removeItem, confirm, reset, keepAlive,
    speechState: speech.state, speechMuted: speech.muted, toggleSpeechMuted: speech.toggleMuted,
    speechSpeed: speech.speed,
    setSpeechSpeed: (speed: SpeechSpeed) => {
      if (busyRef.current || recStateRef.current !== 'idle' || !sessionRef.current) return;
      recordActivity(true);
      speech.setSpeed(speed);
    },
    speechKind: guidance === 'welcome' ? 'welcome' : guidance ? 'recovery' : 'question',
    speechAvailable: Boolean(session && (guidance || speechQuestion)),
    stopSpeech,
    replayQuestion: () => {
      if (busyRef.current || recStateRef.current !== 'idle' || !sessionRef.current || (!guidance && !speechQuestion)) return;
      recordActivity(true);
      speech.replay();
    },
    dismissError: () => { clearSpeech(); setGuidance(null); setError(null); },
  };
}

type Kiosk = ReturnType<typeof useKioskController>;
const Ctx = createContext<Kiosk | null>(null);

export function KioskProvider({ children }: { children: ReactNode }) {
  const k = useKioskController();
  return <Ctx.Provider value={k}>{children}</Ctx.Provider>;
}

export function useKiosk(): Kiosk {
  const k = useContext(Ctx);
  if (!k) throw new Error('KioskProvider missing');
  return k;
}
