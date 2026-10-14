import { RefreshCw } from 'lucide-react';
import type { MenuItem } from '@workspace/api-client-react';
import { useKiosk } from '@/hooks/use-kiosk';
import { won } from '@/lib/format';

export function MenuGrid({ onPick }: { onPick: (m: MenuItem) => void }) {
  const k = useKiosk();
  if (k.menuLoading) {
    return <div className="grid grid-cols-2 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />)}</div>;
  }
  if (k.menuError || k.menu.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-center">
        <p className="text-xl">메뉴를 불러오지 못했어요.</p>
        <button type="button" data-testid="button-retry-menu" onClick={k.refetchMenu} className="k-press mt-4 inline-flex h-14 items-center gap-2 rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground"><RefreshCw className="h-5 w-5" />다시 불러오기</button>
      </div>
    );
  }
  const groups = [['coffee', '커피'], ['non-coffee', '논커피']] as const;
  return (
    <div className="space-y-6">
      {groups.map(([cat, title]) => {
        const items = k.menu.filter((m) => m.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat}>
            <h3 className="mb-3 text-xl font-bold">{title}</h3>
            <div className="grid grid-cols-2 gap-4">
              {items.map((m, i) => (
                <button key={m.menuId} type="button" data-testid={`card-menu-${m.menuId}`} disabled={!k.session || k.busy !== null || k.recState !== 'idle'} onClick={() => onPick(m)} style={{ animationDelay: `${i * 50}ms` }} className="k-fade k-press flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm disabled:opacity-50">
                  <div className="flex h-36 items-center justify-center bg-secondary">
                    <img src={`${import.meta.env.BASE_URL}menu/${m.menuId}.jpg`} alt={m.name} loading="lazy" className="h-full w-full object-contain" />
                  </div>
                  <div className="p-4">
                    <p className="text-2xl font-bold">{m.name}</p>
                    <p className="text-sm text-muted-foreground">{m.englishName}</p>
                    <p className="mt-1 text-2xl font-bold text-primary">{won(m.price)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
