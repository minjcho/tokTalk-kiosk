import { Volume2, Square } from 'lucide-react';
import { useKiosk } from '@/hooks/use-kiosk';

/** A single set of controls serves questions, welcome and recovery notices. */
export function SpeechControls() {
  const k = useKiosk();
  if (!k.speechAvailable) return null;
  const speaking = k.speechState === 'playing' || k.speechState === 'loading';
  // Keep start-guide recovery/stop available without the old full-size panel.
  if (k.speechKind === 'welcome') {
    if (!speaking && k.speechState !== 'blocked' && k.speechState !== 'error') return null;
    return (
      <div className="flex justify-center" data-testid="panel-welcome-controls">
        {speaking
          ? <button type="button" data-testid="button-question-stop" onClick={k.stopSpeech}
              className="k-press flex min-h-12 items-center gap-2 rounded-xl border px-4 text-base">
              <Square aria-hidden className="h-5 w-5" />읽기 중지
            </button>
          : <button type="button" data-testid="button-guidance-replay" onClick={k.replayQuestion}
              disabled={k.busy !== null || k.recState !== 'idle' || k.speechMuted}
              className="k-press flex min-h-12 items-center gap-2 rounded-xl border px-4 text-base disabled:opacity-40">
              <Volume2 aria-hidden className="h-5 w-5" />주문 방법 듣기
            </button>}
      </div>
    );
  }
  const question = k.speechKind === 'question';
  const replayLabel = question ? '질문 다시 듣기' : '오류 안내 다시 듣기';
  const status = k.speechMuted ? '음성 안내가 꺼져 있어요. 음성 켜기 후 듣기 버튼을 눌러주세요.'
    : k.speechState === 'loading' ? '안내 음성을 준비하고 있어요.'
    : k.speechState === 'playing' ? '안내를 읽고 있어요. 마이크를 누르면 재생을 멈춰요.'
    : k.speechState === 'blocked' ? `소리를 들으려면 ${replayLabel}를 눌러주세요.`
    : k.speechState === 'error' ? '안내 음성을 재생하지 못했어요. 듣기 버튼으로 다시 시도하거나 화면에서 주문해주세요.'
    : question ? '질문을 다시 듣거나, 마이크를 눌러 짧게 답해주세요.'
    : '듣기 버튼으로 안내를 다시 들을 수 있어요. 화면에서 주문할 수도 있어요.';
  return (
    <div data-testid="panel-speech-controls" className="rounded-2xl border bg-card px-5 py-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" data-testid={question ? 'button-question-replay' : 'button-guidance-replay'}
          disabled={k.busy !== null || k.recState !== 'idle' || k.speechMuted}
          onClick={k.replayQuestion} className="k-press flex min-h-12 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-lg font-semibold text-primary-foreground disabled:opacity-40">
          <Volume2 aria-hidden className="h-6 w-6" />{replayLabel}
        </button>
        {speaking && <button type="button" data-testid="button-question-stop" onClick={k.stopSpeech}
          className="k-press flex min-h-12 items-center gap-2 rounded-xl border bg-background px-4 py-2 text-lg font-semibold">
          <Square aria-hidden className="h-5 w-5" />읽기 중지
        </button>}
      </div>
      <p role="status" data-testid="text-speech-state" className="text-base">{status}</p>
    </div>
  );
}
