import { useEffect, useState } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { clearStaffCache } from './staff-cache';
import {
  getGetStaffMeQueryKey,
  getListStaffOrdersQueryKey,
  useGetStaffMe,
  useListStaffOrders,
  useUpdateStaffOrderStatus,
  type StaffOrder,
} from '@workspace/api-client-react';

type Filter = 'all' | 'pending' | 'preparing' | 'completed';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: '대기' },
  { id: 'preparing', label: '제작 중' },
  { id: 'completed', label: '완료' },
  { id: 'all', label: '전체' },
];

const STATUS_LABEL = { pending: '대기', preparing: '제작 중', completed: '완료' };
const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-900 border-amber-300',
  preparing: 'bg-sky-100 text-sky-900 border-sky-300',
  completed: 'bg-emerald-100 text-emerald-900 border-emerald-300',
};

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}
const isAuthStatus = (s?: number) => s === 401 || s === 403;

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const time = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(iso))
    : '-';

function Frame({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  return (
    <div className="min-h-[100dvh] bg-secondary text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <img src={`${basePath}/logo.svg`} alt="" className="h-9 w-9" />
          <div className="mr-auto">
            <h1 className="text-lg font-bold leading-tight">톡톡 직원 주문 관리</h1>
            <p className="text-xs font-medium text-destructive" data-testid="text-mock-label">
              모의 주문 / 결제 미연동
            </p>
          </div>
          {header}
          <Link
            href="/"
            onClick={(event) => {
              clearStaffCache(qc);
              if (isSignedIn) {
                event.preventDefault();
                void signOut({ redirectUrl: basePath || '/' });
              }
            }}
            data-testid="link-back-kiosk"
            className="inline-flex min-h-11 items-center rounded-xl border bg-card px-4 text-sm font-semibold"
          >
            {isSignedIn ? '로그아웃 후 키오스크로' : '키오스크로 돌아가기'}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

function Panel({ title, children, alert }: { title: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? 'alert' : 'status'}
      className="mx-auto max-w-xl rounded-2xl border bg-card p-6 k-fade"
    >
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </div>
  );
}

const btn =
  'inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-semibold k-press disabled:opacity-50';

function OrderCard({
  order,
  busy,
  onAdvance,
}: {
  order: StaffOrder;
  busy: boolean;
  onAdvance: (o: StaffOrder) => void;
}) {
  const next = order.status === 'pending' ? '제작 시작' : order.status === 'preparing' ? '제작 완료' : null;
  return (
    <li
      className="rounded-2xl border bg-card p-4 k-fade"
      data-testid={`card-order-${order.orderNumber}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold tabular-nums">#{order.orderNumber}</span>
        <span
          className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${STATUS_STYLE[order.status]}`}
          data-testid={`status-order-${order.orderNumber}`}
        >
          {STATUS_LABEL[order.status]}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          주문 {time(order.confirmedAt)}
        </span>
      </div>
      <ul className="mt-3 divide-y">
        {order.items.map((it, i) => (
          <li key={`${it.id}-${i}`} className="flex gap-3 py-2">
            <span className="min-w-10 rounded-lg bg-secondary px-2 py-1 text-center text-lg font-bold tabular-nums">
              x{it.quantity}
            </span>
            <div className="flex-1">
              <p className="font-semibold">{it.name}</p>
              <p className="text-sm text-muted-foreground">
                {it.temperature === 'hot' ? '핫' : '아이스'} / {it.size}
                {it.options.length > 0 && ` / ${it.options.map((o) => o.name).join(', ')}`}
              </p>
            </div>
            <span className="text-sm tabular-nums">{won(it.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
        <p className="text-sm text-muted-foreground">
          총 {order.itemCount}잔 / <b className="text-foreground">{won(order.total)}</b>
          {order.preparationStartedAt && <> / 제작 시작 {time(order.preparationStartedAt)}</>}
          {order.fulfilledAt && <> / 완료 {time(order.fulfilledAt)}</>}
        </p>
        {next && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance(order)}
            data-testid={`button-advance-${order.orderNumber}`}
            className={`${btn} ml-auto ${
              order.status === 'pending' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
            }`}
          >
            {busy ? '처리 중...' : next}
          </button>
        )}
      </div>
    </li>
  );
}

export default function StaffPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>('pending');
  const [cursors, setCursors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationDenied, setMutationDenied] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = '직원 주문 관리 - 톡톡';
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', '톡톡 직원용 확정 주문 확인과 제작 상태 관리 화면. 모의 주문, 결제 미연동.');
    return () => {
      document.title = prevTitle;
      if (created) meta?.remove();
      else if (prevDesc !== null) meta?.setAttribute('content', prevDesc);
    };
  }, []);

  const signedIn = isLoaded && !!isSignedIn;
  const me = useGetStaffMe({
    query: { enabled: signedIn, queryKey: [...getGetStaffMeQueryKey(), userId], retry: false, gcTime: 0 },
  });
  const approved = signedIn && me.isSuccess && !mutationDenied;

  const params = {
    ...(filter !== 'all' ? { status: filter } : {}),
    ...(cursors.length ? { before: cursors[cursors.length - 1] } : {}),
  };
  const list = useListStaffOrders(params, {
    query: {
      enabled: approved,
      queryKey: [...getListStaffOrdersQueryKey(params), userId],
      retry: false,
      gcTime: 0,
      refetchInterval: (q) => (q.state.status === 'error' ? false : 10000),
    },
  });
  const update = useUpdateStaffOrderStatus();

  const listStatus = statusOf(list.error);
  const listDenied = isAuthStatus(listStatus);

  // Hide cached orders immediately on authorization failures.
  useEffect(() => {
    if (listDenied) {
      setMutationDenied(true);
      clearStaffCache(qc);
    }
  }, [listDenied, qc]);

  useEffect(() => {
    setMutationDenied(false);
    setCursors([]);
    setNotice(null);
    setBusyOrder(null);
  }, [userId]);

  const advance = async (o: StaffOrder) => {
    const target = o.status === 'pending' ? 'preparing' : 'completed';
    setBusyOrder(o.orderNumber);
    setNotice(null);
    try {
      await update.mutateAsync({
        orderNumber: o.orderNumber,
        data: { status: target, expectedVersion: o.version },
      });
    } catch (e) {
      const s = statusOf(e);
      if (isAuthStatus(s)) {
        qc.removeQueries({ queryKey: getListStaffOrdersQueryKey() });
        setMutationDenied(true);
      } else if (s === 409) {
        setNotice('다른 직원이 먼저 상태를 바꿨습니다. 최신 주문으로 새로고침했습니다.');
      } else {
        setNotice('상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setBusyOrder(null);
      await qc.invalidateQueries({ queryKey: getListStaffOrdersQueryKey() });
    }
  };

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setCursors([]);
  };

  const logout = (
    <button
      type="button"
      data-testid="button-sign-out"
      onClick={() => {
        setMutationDenied(true);
        clearStaffCache(qc);
        void signOut({ redirectUrl: basePath || '/' });
      }}
      className="inline-flex min-h-11 items-center rounded-xl bg-foreground px-4 text-sm font-semibold text-background"
    >
      로그아웃
    </button>
  );

  if (!isLoaded) {
    return (
      <Frame>
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-busy="true" aria-label="불러오는 중" />
      </Frame>
    );
  }

  if (!isSignedIn) {
    return (
      <Frame>
        <Panel title="직원 로그인이 필요합니다">
          <p>확정된 주문을 확인하고 제작 상태를 바꾸려면 로그인해 주세요. 로그인 전에는 어떤 주문도 불러오지 않습니다.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/sign-in" data-testid="link-sign-in" className={`${btn} bg-primary text-primary-foreground`}>
              로그인
            </Link>
            <Link href="/sign-up" data-testid="link-sign-up" className={`${btn} border bg-card text-foreground`}>
              계정 만들기
            </Link>
          </div>
        </Panel>
      </Frame>
    );
  }

  const meStatus = statusOf(me.error);

  if (me.isLoading) {
    return (
      <Frame header={logout}>
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-busy="true" aria-label="권한 확인 중" />
      </Frame>
    );
  }

  if (me.isError && meStatus === 403) {
    return (
      <Frame header={logout}>
        <Panel title="운영자 승인이 필요합니다" alert>
          <p>이 계정은 아직 직원으로 승인되지 않았습니다. 운영자에게 아래 사용자 ID를 전달해 승인을 요청해 주세요.</p>
          <code
            className="block break-all rounded-xl bg-secondary p-3 text-sm text-foreground"
            data-testid="text-user-id"
          >
            {userId}
          </code>
          <button type="button" onClick={() => void me.refetch()} data-testid="button-recheck" className={`${btn} border bg-card text-foreground`}>
            승인 다시 확인
          </button>
        </Panel>
      </Frame>
    );
  }

  const accessError = (me.isError && meStatus === 401) || listDenied || mutationDenied;
  if (accessError) {
    return (
      <Frame header={logout}>
        <Panel title="접근 권한을 확인할 수 없습니다" alert>
          <p>로그인이 만료되었거나 권한이 없습니다. 주문 정보는 안전하게 숨겼습니다. 다시 로그인하거나 권한을 확인해 주세요.</p>
          <button
            type="button"
            data-testid="button-recheck-access"
            className={`${btn} bg-primary text-primary-foreground`}
            onClick={() => {
              setMutationDenied(false);
              qc.removeQueries({ queryKey: getListStaffOrdersQueryKey() });
              void me.refetch();
            }}
          >
            다시 확인
          </button>
        </Panel>
      </Frame>
    );
  }

  if (me.isError) {
    return (
      <Frame header={logout}>
        <Panel title="직원 권한을 확인하지 못했습니다" alert>
          <p>서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>
          <button type="button" onClick={() => void me.refetch()} data-testid="button-retry-me" className={`${btn} bg-primary text-primary-foreground`}>
            다시 시도
          </button>
        </Panel>
      </Frame>
    );
  }

  const orders = list.isError ? undefined : list.data?.orders;
  const nextCursor = list.isError ? null : list.data?.nextCursor ?? null;

  return (
    <Frame header={logout}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => changeFilter(f.id)}
              data-testid={`button-filter-${f.id}`}
              className={`min-h-11 rounded-full border px-5 text-base font-semibold k-press ${
                filter === f.id ? 'bg-foreground text-background' : 'bg-card'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
          data-testid="button-refresh"
          className="ml-auto min-h-11 rounded-xl border bg-card px-4 text-sm font-semibold disabled:opacity-50"
        >
          {list.isFetching ? '새로고침 중...' : '새로고침'}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">10초마다 자동으로 갱신됩니다.</p>

      {notice && (
        <div role="alert" data-testid="text-notice" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
          {notice}
        </div>
      )}

      {list.isError ? (
        <Panel title="주문을 불러오지 못했습니다" alert>
          <p>이전에 불러온 주문은 정확하지 않을 수 있어 표시하지 않습니다.</p>
          <button type="button" onClick={() => void list.refetch()} data-testid="button-retry-orders" className={`${btn} bg-primary text-primary-foreground`}>
            다시 시도
          </button>
        </Panel>
      ) : list.isLoading || !orders ? (
        <div className="space-y-3" aria-busy="true" aria-label="주문 불러오는 중">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Panel title="표시할 주문이 없습니다">
          <p>새 주문이 확정되면 이곳에 나타납니다.</p>
        </Panel>
      ) : (
        <ul className="space-y-3" data-testid="list-orders">
          {orders.map((o) => (
            <OrderCard key={o.orderNumber} order={o} busy={busyOrder !== null} onAdvance={advance} />
          ))}
        </ul>
      )}

      <nav className="mt-6 flex items-center justify-between" aria-label="페이지 이동">
        <button
          type="button"
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
          data-testid="button-prev-page"
          className={`${btn} border bg-card`}
        >
          이전
        </button>
        <span className="text-sm text-muted-foreground">{cursors.length + 1}페이지</span>
        <button
          type="button"
          disabled={!nextCursor}
          onClick={() => nextCursor && setCursors((c) => [...c, nextCursor])}
          data-testid="button-next-page"
          className={`${btn} border bg-card`}
        >
          다음
        </button>
      </nav>
    </Frame>
  );
}
