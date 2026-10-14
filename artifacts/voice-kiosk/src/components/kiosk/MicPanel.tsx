import { Mic, Square, Loader2 } from 'lucide-react';
import { useKiosk } from '@/hooks/use-kiosk';

export function MicPanel() {
  const k = useKiosk();
  const { recState: st } = k;
  const disabled = !k.aiReady || !k.session || (k.busy !== null && st === 'idle') || st === 'starting' || st === 'analyzing';
  const label =
    st === 'recording' ? '말씀이 끝나면 다시 눌러 주세요'
    : st === 'analyzing' ? '주문 내용을 분석하고 있어요'
    : st === 'starting' ? '마이크를 준비하고 있어요'
    : !k.aiReady ? '음성 주문을 사용할 수 없어요. 화면을 눌러 주문해 주세요'
    : k.clarification ? '질문을 듣고, 버튼을 눌러 짧게 답해주세요'
    : '누르고 편하게 말씀하세요';
  return (
    <section className="grid grid-cols-1 items-center justify-items-center gap-4 " aria-label="음성 주문">
      <div className="order-2 flex w-full flex-col items-center gap-4">
      <p id="voice-privacy" className="max-w-lg text-center text-sm text-muted-foreground">
        음성은 외부로 전송되며, 앱에는 저장되지 않아요.
      </p>
      <details className="w-full max-w-lg text-center">
        <summary className="cursor-pointer text-base text-muted-foreground" data-testid="button-voice-detail">음성 처리 자세히 보기</summary>
        <p className="mt-2 text-sm text-muted-foreground">녹음은 OpenAI로 전송되어 주문 인식에 쓰이며, 앱은 음성 파일을 저장하지 않습니다. 안내와 확인 질문은 AI가 만든 음성으로 읽어드려요. 원치 않으면 음소거하거나 화면으로 주문해 주세요.</p>
      </details>
      </div>
      <div className="order-1 flex w-full flex-col items-center gap-4">
      <div className="relative flex h-44 w-44 items-center justify-center">
        {st === 'recording' && <span className="k-pulse absolute inset-0 rounded-full bg-primary/40" />}
        <button
          type="button"
          data-testid="button-mic"
          onClick={k.toggleMic}
          disabled={disabled}
          aria-label={st === 'recording' ? '녹음 끝내기' : k.clarification ? '질문에 말로 답하기' : '말로 주문하기'}
          aria-describedby="voice-privacy"
          className={`k-press relative flex h-44 w-44 items-center justify-center rounded-full text-primary-foreground shadow-lg transition-colors disabled:opacity-40 ${st === 'recording' ? 'bg-destructive' : 'bg-primary'}`}
        >
          {st === 'analyzing' || st === 'starting' ? <Loader2 className="h-16 w-16 animate-spin" /> : st === 'recording' ? <Square className="h-14 w-14" fill="currentColor" /> : <Mic className="h-16 w-16" />}
        </button>
      </div>
      <div className="flex h-12 items-end gap-1" aria-hidden>
        {k.levels.map((l, i) => (
          <span key={i} className="w-1.5 origin-bottom rounded-full bg-primary/70 transition-transform duration-75" style={{ height: 48, transform: `scaleY(${st === 'recording' ? Math.max(0.08, l) : 0.08})` }} />
        ))}
      </div>
      {st === 'idle' && <p className="text-2xl font-bold">말로 주문하기</p>}
      <p data-testid="text-mic-state" className="text-center text-xl font-semibold" aria-live="polite">
        {st === 'recording' && <span className="mr-2 tabular-nums text-destructive">{k.recSeconds}초 / {k.maxRecSec}초</span>}
        {label}
      </p>
      </div>
    </section>
  );
}
