import { CheckCircle2 } from 'lucide-react';
import { useKiosk } from '@/hooks/use-kiosk';
import { tempLabel, won } from '@/lib/format';

export function ReceiptView() {
  const k = useKiosk();
  const r = k.receipt;
  if (!r) return null;
  return (
    <div className="k-fade flex flex-1 flex-col items-center overflow-y-auto px-6 py-8" data-testid="panel-receipt">
      <CheckCircle2 className="h-20 w-20 text-accent" />
      <h1 className="mt-3 text-4xl font-bold">주문이 접수되었어요</h1>
      <p className="mt-1 text-lg text-muted-foreground">결제는 연결되지 않은 시연 영수증입니다.</p>
      <div className="mt-6 w-full max-w-md rounded-2xl border bg-card p-6">
        <p className="text-center text-base text-muted-foreground">주문번호</p>
        <p className="text-center text-6xl font-bold tracking-wider text-primary" data-testid="text-order-number">{r.orderNumber}</p>
        <ul className="mt-5 divide-y border-t">
          {r.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-3">
              <div>
                <p className="text-lg font-bold">{i.name} x {i.quantity}</p>
                <p className="text-sm text-muted-foreground">{tempLabel(i.temperature)} · {i.size}{i.options.length ? ` · ${i.options.map((o) => o.name).join(', ')}` : ''}</p>
              </div>
              <p className="text-lg tabular-nums">{won(i.lineTotal)}</p>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t pt-4 text-2xl font-bold"><span>총 {r.itemCount}잔</span><span data-testid="text-receipt-total">{won(r.total)}</span></div>
        <p className="mt-2 text-center text-sm text-muted-foreground">{new Date(r.completedAt).toLocaleString('ko-KR')}</p>
      </div>
      <button type="button" data-testid="button-new-customer" onClick={k.reset} className="k-press mt-8 h-20 w-full max-w-md rounded-2xl bg-primary text-3xl font-bold text-primary-foreground">다음 손님 주문하기</button>
      <p className="mt-3 text-base text-muted-foreground" data-testid="text-receipt-idle">{k.idleLeft}초 후 자동으로 처음 화면으로 돌아갑니다</p>
    </div>
  );
}
