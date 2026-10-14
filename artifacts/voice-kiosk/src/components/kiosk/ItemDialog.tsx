import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { CartItem, MenuItem } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ItemConfig } from '@/hooks/use-kiosk';
import { tempLabel, won } from '@/lib/format';

interface Props { menu: MenuItem; existing?: CartItem; busy: boolean; error?: string | null; onClose: () => void; onSubmit: (c: ItemConfig) => void }

const chip = (on: boolean) => `k-press min-h-14 rounded-xl border-2 px-4 py-2 text-lg font-semibold ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background'}`;

export function ItemDialog({ menu, existing, busy, error, onClose, onSubmit }: Props) {
  const defSize = menu.availableSizes.find((s) => s.id === 'M')?.id ?? menu.availableSizes[0]?.id ?? 'M';
  const [qty, setQty] = useState(existing?.quantity ?? 1);
  const [temp, setTemp] = useState<'ice' | 'hot'>(existing?.temperature ?? menu.defaultTemperature ?? 'ice');
  const [size, setSize] = useState(existing?.size ?? defSize);
  const [opts, setOpts] = useState<string[]>(existing?.options.map((o) => o.id) ?? []);
  const toggle = (id: string) => setOpts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const sizeP = menu.availableSizes.find((s) => s.id === size)?.price ?? 0;
  const optP = menu.availableOptions.filter((o) => opts.includes(o.id)).reduce((n, o) => n + o.price, 0);
  const unit = menu.price + sizeP + optP;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-3xl p-6" data-testid="dialog-item">
        <DialogTitle className="text-3xl font-bold">{menu.name}</DialogTitle>
        <DialogDescription className="text-lg">{menu.description}</DialogDescription>
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-lg font-bold">온도</p>
            <div className="flex gap-3">
              {menu.availableTemperatures.map((t) => (
                <button key={t} type="button" data-testid={`button-temp-${t}`} onClick={() => setTemp(t)} className={`${chip(temp === t)} flex-1`}>{tempLabel(t)}{t === menu.defaultTemperature ? ' (기본)' : ''}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-lg font-bold">크기</p>
            <div className="flex gap-3">
              {menu.availableSizes.map((s) => (
                <button key={s.id} type="button" data-testid={`button-size-${s.id}`} onClick={() => setSize(s.id)} className={`${chip(size === s.id)} flex-1`}>{s.name}{s.price ? <span className="block text-sm font-normal">+{won(s.price)}</span> : null}</button>
              ))}
            </div>
          </div>
          {menu.availableOptions.length > 0 && (
            <div>
              <p className="mb-2 text-lg font-bold">추가 옵션</p>
              <div className="grid grid-cols-2 gap-3">
                {menu.availableOptions.map((o) => (
                  <button key={o.id} type="button" aria-pressed={opts.includes(o.id)} data-testid={`button-option-${o.id}`} onClick={() => toggle(o.id)} className={chip(opts.includes(o.id))}>{o.name}{o.price ? <span className="block text-sm font-normal">+{won(o.price)}</span> : null}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold">수량</p>
            <div className="flex items-center gap-4">
              <button type="button" data-testid="button-dialog-minus" aria-label="수량 줄이기" disabled={qty <= 1} onClick={() => setQty(qty - 1)} className="k-press flex h-14 w-14 items-center justify-center rounded-full border-2 disabled:opacity-30"><Minus className="h-6 w-6" /></button>
              <span data-testid="text-dialog-qty" className="w-10 text-center text-3xl font-bold tabular-nums">{qty}</span>
              <button type="button" data-testid="button-dialog-plus" aria-label="수량 늘리기" disabled={qty >= 20} onClick={() => setQty(qty + 1)} className="k-press flex h-14 w-14 items-center justify-center rounded-full border-2 disabled:opacity-30"><Plus className="h-6 w-6" /></button>
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-lg text-destructive">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" disabled={busy} data-testid="button-dialog-cancel" onClick={onClose} className="k-press h-16 flex-1 rounded-2xl border-2 text-xl font-semibold disabled:opacity-40">닫기</button>
            <button type="button" data-testid="button-dialog-submit" disabled={busy} onClick={() => onSubmit({ menuId: menu.menuId, quantity: qty, temperature: temp, size, options: opts })} className="k-press h-16 flex-[2] rounded-2xl bg-primary text-xl font-bold text-primary-foreground disabled:opacity-40">
              {existing ? '변경 저장' : '담기'} · {won(unit * qty)}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
