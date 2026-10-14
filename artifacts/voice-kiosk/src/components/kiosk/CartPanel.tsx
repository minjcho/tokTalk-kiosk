import { Minus, Pencil, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { CartItem } from '@workspace/api-client-react';
import { useKiosk } from '@/hooks/use-kiosk';
import { tempLabel, won } from '@/lib/format';

interface Props { onEdit: (i: CartItem) => void; onReview: () => void; onCancelAll: () => void }

export function CartPanel({ onEdit, onReview, onCancelAll }: Props) {
  const k = useKiosk();
  const items = k.session?.items ?? [];
  const lock = k.busy !== null || k.recState !== 'idle';
  const qtyChange = (i: CartItem, d: number) =>
    k.updateItem(i.id, { quantity: i.quantity + d, temperature: i.temperature, size: i.size, options: i.options.map((o) => o.id) });
  return (
    <aside className="flex max-h-[44dvh] min-h-[200px] flex-col border-t-2 bg-card shadow-[0_-8px_24px_-12px_rgba(60,40,20,0.25)]" aria-label="장바구니" data-testid="panel-cart">
      <div className="flex items-center justify-between px-6 pt-4">
        <h2 className="flex items-center gap-2 text-2xl font-bold"><ShoppingBag className="h-6 w-6 text-primary" />내 주문 <span data-testid="text-item-count" className="text-primary">{k.session?.itemCount ?? 0}</span></h2>
        <button type="button" data-testid="button-cancel-all" disabled={lock || (items.length === 0 && !k.clarification)} onClick={onCancelAll} className="k-press rounded-xl px-3 py-2 text-lg font-semibold text-destructive disabled:opacity-30">전체 취소</button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-2">
        {items.length === 0 ? (
          <p className="py-6 text-center text-lg text-muted-foreground" data-testid="text-cart-empty">아직 담은 메뉴가 없어요. 말씀하시거나 메뉴를 눌러 주세요.</p>
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id} data-testid={`row-cart-${i.id}`} className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <p className="text-xl font-bold">{i.name}</p>
                  <p className="text-base text-muted-foreground">{tempLabel(i.temperature)} · {i.size}{i.options.length ? ` · ${i.options.map((o) => o.name).join(', ')}` : ''}</p>
                  <p className="text-sm text-muted-foreground">한 잔 {won(i.unitPrice)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" data-testid={`button-minus-${i.id}`} aria-label="하나 줄이기" disabled={lock || i.quantity <= 1} onClick={() => qtyChange(i, -1)} className="k-press flex h-12 w-12 items-center justify-center rounded-full border-2 disabled:opacity-30"><Minus className="h-5 w-5" /></button>
                  <span className="w-8 text-center text-2xl font-bold tabular-nums" data-testid={`text-qty-${i.id}`}>{i.quantity}</span>
                  <button type="button" data-testid={`button-plus-${i.id}`} aria-label="하나 늘리기" disabled={lock || i.quantity >= 20} onClick={() => qtyChange(i, 1)} className="k-press flex h-12 w-12 items-center justify-center rounded-full border-2 disabled:opacity-30"><Plus className="h-5 w-5" /></button>
                </div>
                <p className="flex-1 text-right text-xl font-bold tabular-nums sm:w-24 sm:flex-none" data-testid={`text-line-${i.id}`}>{won(i.lineTotal)}</p>
                <button type="button" data-testid={`button-edit-${i.id}`} aria-label="옵션 수정" disabled={lock} onClick={() => onEdit(i)} className="k-press flex h-12 w-12 items-center justify-center rounded-xl bg-secondary disabled:opacity-30"><Pencil className="h-5 w-5" /></button>
                <button type="button" data-testid={`button-remove-${i.id}`} aria-label="삭제" disabled={lock} onClick={() => k.removeItem(i.id)} className="k-press flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive disabled:opacity-30"><Trash2 className="h-5 w-5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-4 border-t px-6 py-4">
        <div className="flex-1">
          <p className="text-base text-muted-foreground">합계</p>
          <p className="text-3xl font-bold tabular-nums" data-testid="text-total">{won(k.session?.total ?? 0)}</p>
        </div>
        <button type="button" data-testid="button-review" disabled={lock || items.length === 0 || !!k.clarification} onClick={onReview} className="k-press h-16 rounded-2xl bg-accent px-6 text-xl font-bold text-accent-foreground disabled:opacity-40 sm:px-10 sm:text-2xl">{k.clarification ? '질문에 답해주세요' : '주문 확인'}</button>
      </div>
    </aside>
  );
}
