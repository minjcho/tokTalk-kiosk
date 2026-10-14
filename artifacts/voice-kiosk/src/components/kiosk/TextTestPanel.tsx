import { useState } from 'react';
import { Send } from 'lucide-react';
import { useKiosk } from '@/hooks/use-kiosk';

const EXAMPLES = ['아아 두 잔 주세요', '뜨아 하나 주이소', '카페라떼 한 잔이랑 아메리카노 두 잔', '아메리카노 하나 빼주세요', '라떼 두 잔 중에 하나는 샷 추가요', '아니 세 잔 말고 두 잔이요'];

export function TextTestPanel() {
  const k = useKiosk();
  const [text, setText] = useState('');
  const off = !k.aiReady || !k.session || k.busy !== null || k.recState !== 'idle';
  const send = async (t: string) => {
    const v = t.trim();
    if (!v || off) return;
    if (await k.submitText(v)) setText('');
  };
  return (
    <section className="rounded-2xl border border-dashed bg-secondary/50 p-4" aria-label="텍스트 주문 테스트">
      <h2 className="text-base font-semibold text-muted-foreground">텍스트 주문 테스트</h2>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input data-testid="input-text-order" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} disabled={off} placeholder="주문 문장을 입력하세요" className="h-14 min-w-0 flex-1 rounded-xl border bg-background px-4 text-lg outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
        <button data-testid="button-send-text" type="submit" disabled={off || !text.trim()} className="k-press flex h-14 items-center gap-2 rounded-xl bg-foreground px-5 text-lg font-semibold text-background disabled:opacity-40"><Send className="h-5 w-5" />보내기</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex, i) => (
          <button key={ex} data-testid={`button-example-${i}`} type="button" disabled={off} onClick={() => send(ex)} className="k-press rounded-full border bg-background px-4 py-2 text-base disabled:opacity-40">{ex}</button>
        ))}
      </div>
    </section>
  );
}
