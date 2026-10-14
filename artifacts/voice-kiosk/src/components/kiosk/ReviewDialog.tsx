import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useKiosk } from '@/hooks/use-kiosk';
import { tempLabel, won } from '@/lib/format';

export function ReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const k = useKiosk();
  const s = k.session;
  if (!s) return null;
  const confirming = k.busy === 'confirm';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !confirming && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-3xl p-6" data-testid="dialog-review">
        <DialogTitle className="text-3xl font-bold">주문 내용이 맞나요?</DialogTitle>
        <DialogDescription className="text-lg">확인 후 아래 버튼을 누르면 주문이 접수됩니다. 결제는 연결되어 있지 않은 시연입니다.</DialogDescription>
        <ul className="divide-y rounded-2xl border px-4">
          {s.items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <p className="text-xl font-bold">{i.name} <span className="text-primary">x {i.quantity}</span></p>
                <p className="text-base text-muted-foreground">{tempLabel(i.temperature)} · {i.size}{i.options.length ? ` · ${i.options.map((o) => o.name).join(', ')}` : ''}</p>
              </div>
              <p className="text-xl font-semibold tabular-nums">{won(i.lineTotal)}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between">
          <span className="text-xl">총 {s.itemCount}잔</span>
          <span className="text-4xl font-bold tabular-nums" data-testid="text-review-total">{won(s.total)}</span>
        </div>
        {k.error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-lg text-destructive" data-testid="text-review-error">{k.error}</p>}
        <div className="flex gap-3">
          <button type="button" data-testid="button-review-back" disabled={confirming} onClick={onClose} className="k-press h-16 flex-1 rounded-2xl border-2 text-xl font-semibold disabled:opacity-40">수정하기</button>
          <button type="button" data-testid="button-confirm-order" disabled={k.busy !== null || s.items.length === 0} onClick={async () => { if (await k.confirm()) onClose(); }} className="k-press h-16 flex-[2] rounded-2xl bg-accent text-2xl font-bold text-accent-foreground disabled:opacity-40">{confirming ? '접수하는 중...' : '주문 확정'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
