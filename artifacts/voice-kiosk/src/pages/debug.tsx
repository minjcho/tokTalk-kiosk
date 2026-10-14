import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { getGetSessionDebugQueryKey, useGetSessionDebug } from '@workspace/api-client-react';
import { useKiosk } from '@/hooks/use-kiosk';

function pretty(j: string | null | undefined) {
  if (!j) return '(없음)';
  try { return JSON.stringify(JSON.parse(j), null, 2); } catch { return j; }
}

export default function DebugPage() {
  const k = useKiosk();
  const id = k.session?.id ?? '';
  const q = useGetSessionDebug(id, { query: { enabled: !!id, queryKey: getGetSessionDebugQueryKey(id), refetchInterval: 4000 } });
  const d = q.data;
  return (
    <div className="mx-auto min-h-[100dvh] max-w-[860px] space-y-5 p-6">
      <Link href="/" data-testid="link-back" className="inline-flex items-center gap-2 text-lg font-semibold"><ArrowLeft className="h-5 w-5" />주문 화면으로</Link>
      <h1 className="text-3xl font-bold">개발자 진단</h1>
      <p className="text-muted-foreground">현재 주문 세션 범위의 정보만 표시됩니다. 새 손님이 시작되면 사라집니다.</p>
      {!id ? <p data-testid="text-debug-empty" className="rounded-2xl border p-6">진행 중인 세션이 없어요.</p> : (
        <>
          <section className="rounded-2xl border p-4 text-sm">
            <p>세션 <span className="font-mono">{id}</span> · 리비전 {k.session?.revision} · 상태 {k.session?.status}</p>
            <p>STT 모델 {k.status?.transcriptionModel ?? '-'} · 파서 모델 {k.status?.parserModel ?? '-'} · AI {k.aiReady ? '준비됨' : '사용 불가'}</p>
          </section>
          {q.isLoading && <div className="h-32 animate-pulse rounded-2xl bg-muted" />}
          {q.isError && <p role="alert" className="text-destructive">진단 정보를 불러오지 못했어요. <button type="button" onClick={() => q.refetch()} className="underline">다시 시도</button></p>}
          <section><h2 className="mb-1 text-lg font-bold">STT 인식 결과</h2><p data-testid="text-debug-transcript" className="rounded-2xl border bg-card p-4 text-lg">{d?.transcript ?? k.transcript ?? '(없음)'}</p></section>
          <section><h2 className="mb-1 text-lg font-bold">추출된 구조화 JSON</h2><pre data-testid="text-debug-json" className="overflow-x-auto rounded-2xl bg-foreground p-4 font-mono text-sm text-background">{pretty(d?.extractedJson ?? k.extractedJson)}</pre></section>
          <section><h2 className="mb-1 text-lg font-bold">API 이벤트</h2>
            {d && d.events.length === 0 ? <p className="text-muted-foreground">이벤트가 없어요.</p> : (
              <ul className="divide-y rounded-2xl border font-mono text-sm">
                {d?.events.map((e, i) => (
                  <li key={i} data-testid={`row-event-${i}`} className="flex gap-3 p-3"><span className="text-muted-foreground">{new Date(e.time).toLocaleTimeString('ko-KR')}</span><span className={e.level === 'error' ? 'font-bold text-destructive' : 'text-accent'}>{e.code}</span><span className="flex-1">{e.message}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
