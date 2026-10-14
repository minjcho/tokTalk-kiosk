import { useEffect, useRef, useState } from 'react';
import { BookOpen, Coffee, RotateCcw, TimerReset, Volume2, VolumeX, X } from 'lucide-react';
import type { CartItem, MenuItem } from '@workspace/api-client-react';
import { useKiosk } from '@/hooks/use-kiosk';
import { MicPanel } from '@/components/kiosk/MicPanel';
import { TranscriptBox } from '@/components/kiosk/TranscriptBox';
import { MenuGrid } from '@/components/kiosk/MenuGrid';
import { CartPanel } from '@/components/kiosk/CartPanel';
import { ItemDialog } from '@/components/kiosk/ItemDialog';
import { ReviewDialog } from '@/components/kiosk/ReviewDialog';
import { ReceiptView } from '@/components/kiosk/ReceiptView';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export default function KioskPage() {
  const k = useKiosk();
  const [picked, setPicked] = useState<MenuItem | null>(null);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [review, setReview] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  useEffect(() => () => k.stopSpeech(), [k.stopSpeech]);
  useEffect(() => {
    setPicked(null); setEditing(null); setReview(false); setCancelAsk(false);
  }, [k.session?.id]);
  const menuRef = useRef<HTMLHeadingElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (k.menuOpen) menuRef.current?.focus();
    else if (wasOpen.current) menuBtn.current?.focus();
    wasOpen.current = k.menuOpen;
  }, [k.menuOpen]);
  const hasItems = (k.session?.items.length ?? 0) > 0;
  const dialogMenu = picked ?? (editing ? k.menu.find((m) => m.menuId === editing.menuId) ?? null : null);
  const warn = k.session && k.idleLeft <= k.warnSec && !k.busy && k.recState === 'idle';

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-[860px] flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div data-testid="text-brand" className="flex items-center gap-2 text-xl font-bold"><Coffee className="h-6 w-6 text-primary" />톡톡</div>
        <div className="flex items-center gap-3">
          <button type="button" disabled={k.busy !== null} onClick={() => { k.stopSpeech(); if (k.session?.items.length) setCancelAsk(true); else k.reset(); }} className="k-press flex min-h-12 items-center gap-1 rounded-xl border px-3 text-base font-semibold disabled:opacity-40"><RotateCcw className="h-4 w-4" />새 주문</button>
          <button type="button" data-testid="button-speech-mute" onClick={k.toggleSpeechMuted} aria-pressed={k.speechMuted} className="k-press flex min-h-12 items-center gap-1 rounded-xl px-3 text-base text-muted-foreground">
            {k.speechMuted ? <VolumeX aria-hidden className="h-4 w-4" /> : <Volume2 aria-hidden className="h-4 w-4" />}{k.speechMuted ? '음성 켜기' : '음소거'}
          </button>
        </div>
      </header>
      {warn && (
        <div role="alert" data-testid="banner-idle" className="flex items-center justify-between gap-3 bg-amber-100 px-6 py-3 text-lg font-semibold">
          <span className="flex items-center gap-2"><TimerReset className="h-5 w-5" />{k.idleLeft}초 후 처음 화면으로 돌아갑니다</span>
          <button type="button" data-testid="button-keep-going" onClick={k.keepAlive} className="k-press rounded-xl bg-foreground px-4 py-2 text-background">계속 주문하기</button>
        </div>
      )}
      {k.receipt ? (
        <ReceiptView />
      ) : (
        <>
          <main className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2 text-center">
              <h1 className="break-keep text-4xl font-bold" data-testid="text-heading">톡톡</h1>
              <p data-testid="text-order-guide" className="break-keep text-xl font-semibold">점원에게 말하듯, 편하게 주문하세요.</p>
            </div>
            {!k.aiReady && <div role="status" data-testid="banner-ai-off" className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-lg">지금은 음성·텍스트 주문을 사용할 수 없어요. 메뉴 보기를 눌러 주문해 주세요.</div>}
            {k.initError && (
              <div role="alert" className="rounded-2xl border border-destructive/40 p-5 text-lg text-destructive">
                {k.initError}
                <button type="button" data-testid="button-retry-session" onClick={k.retryInit} className="k-press ml-3 rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">다시 시도</button>
              </div>
            )}
            <MicPanel />
            {!k.menuOpen && (
              <div className="flex justify-center">
                <button ref={menuBtn} type="button" data-testid="button-show-menu" aria-controls="menu-panel" aria-expanded={false} onClick={k.showMenu} className="k-press flex min-h-16 items-center gap-2 rounded-2xl border-2 px-8 text-2xl font-bold"><BookOpen aria-hidden className="h-6 w-6" />메뉴 보기</button>
              </div>
            )}
            <TranscriptBox />
            {k.menuOpen && (
              <section id="menu-panel" data-testid="section-menu" aria-labelledby="menu-title" className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 id="menu-title" ref={menuRef} tabIndex={-1} className="text-3xl font-bold outline-none">메뉴</h2>
                  <button type="button" data-testid="button-close-menu" aria-controls="menu-panel" aria-expanded={true} onClick={k.closeMenu} className="k-press flex min-h-14 items-center gap-2 rounded-2xl border-2 px-5 text-xl font-bold"><X aria-hidden className="h-5 w-5" />메뉴 닫기</button>
                </div>
                <MenuGrid onPick={setPicked} />
              </section>
            )}
          </main>
          {hasItems && <CartPanel onEdit={setEditing} onReview={() => { k.stopSpeech(); setReview(true); }} onCancelAll={() => { k.stopSpeech(); setCancelAsk(true); }} />}
        </>
      )}
      {dialogMenu && (
        <ItemDialog
          key={editing?.id ?? dialogMenu.menuId}
          menu={dialogMenu}
          existing={editing ?? undefined}
          busy={k.busy !== null}
          error={k.error}
          onClose={() => { setPicked(null); setEditing(null); }}
          onSubmit={async (c) => {
            const ok = editing ? await k.updateItem(editing.id, c) : await k.addItem(c);
            if (ok) { setPicked(null); setEditing(null); }
          }}
        />
      )}
      <ReviewDialog open={review && !k.receipt} onClose={() => setReview(false)} />
      <Dialog open={cancelAsk} onOpenChange={setCancelAsk}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-3xl p-6" data-testid="dialog-cancel">
          <DialogTitle className="text-2xl font-bold">주문을 모두 취소할까요?</DialogTitle>
          <DialogDescription className="text-lg">담은 메뉴가 모두 사라지고 처음 화면으로 돌아갑니다.</DialogDescription>
          <div className="flex gap-3">
            <button type="button" data-testid="button-cancel-keep" onClick={() => setCancelAsk(false)} className="k-press h-16 flex-1 rounded-2xl border-2 text-xl font-semibold">계속 주문</button>
            <button type="button" data-testid="button-cancel-confirm" onClick={() => { setCancelAsk(false); k.reset(); }} className="k-press h-16 flex-1 rounded-2xl bg-destructive text-xl font-bold text-destructive-foreground">전체 취소</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
