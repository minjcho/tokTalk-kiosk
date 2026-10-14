import { AlertTriangle, MessageCircle, X } from 'lucide-react';
import { useKiosk } from '@/hooks/use-kiosk';
import { SpeechControls } from './SpeechControls';

export function TranscriptBox() {
  const k = useKiosk();
  const question = k.clarification ?? '';
  const replies = question.includes('어떤 온도로')
    ? ['아이스로 주세요', '따뜻하게 주세요']
    : question.includes('어떤 크기로')
      ? ['레귤러로 주세요', '라지로 주세요']
      : question.includes('추가하거나 변경')
        ? [...new Set(k.menu.flatMap((m) => m.availableOptions)
          .filter((o) => question.includes(o.name)).map((o) => o.name)), '추가 없이 주세요']
        : [];
  const locked = k.busy !== null || k.recState !== 'idle';
  return (
    <div className="space-y-3" aria-live="polite">
      {(k.transcript || k.message) && <div className="rounded-2xl border bg-card px-5 py-4">
        {k.transcript && <><p className="text-sm font-medium text-muted-foreground">인식된 말씀</p>
        <p data-testid="text-transcript" className="mt-1 text-2xl font-semibold">"{k.transcript}"</p></>}
        {k.message && <p data-testid="text-ai-message" className="mt-2 flex gap-2 text-lg text-foreground/80"><MessageCircle className="mt-1 h-5 w-5 shrink-0 text-accent" />{k.message}</p>}
      </div>}
      {k.clarification && k.clarification !== k.message && (
        <div data-testid="text-clarification" className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-lg">{k.clarification}</div>
      )}
      <SpeechControls />
      {k.clarification && (
        <div data-testid="panel-preference-replies" className="rounded-2xl border-2 border-accent/40 bg-accent/5 px-5 py-4">
          <p className="mb-3 text-lg font-semibold">말씀으로 답하거나 아래에서 선택해주세요</p>
          {replies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {replies.map((reply) => (
                <button key={reply} type="button" disabled={locked} onClick={() => k.submitText(reply)}
                  className="k-press min-h-12 rounded-xl border bg-background px-4 py-2 text-lg font-semibold disabled:opacity-40">
                  {reply}
                </button>
              ))}
              <button type="button" disabled={locked} onClick={() => k.submitText('말하지 않은 설정은 모두 기본으로 해주세요')}
                className="k-press min-h-12 rounded-xl bg-secondary px-4 py-2 text-lg font-semibold disabled:opacity-40">
                나머지는 기본으로
              </button>
            </div>
          )}
          <p className="mt-3 text-base text-muted-foreground">확인 중인 음료는 답변이 끝나면 담아요. 화면 메뉴에서 직접 선택할 수도 있어요.</p>
        </div>
      )}
      {k.error && (
        <div role="alert" data-testid="text-error" className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-3 text-lg text-destructive">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
          <span className="flex-1">{k.error}</span>
          <button type="button" onClick={k.dismissError} aria-label="닫기" className="p-1"><X className="h-5 w-5" /></button>
        </div>
      )}
    </div>
  );
}
