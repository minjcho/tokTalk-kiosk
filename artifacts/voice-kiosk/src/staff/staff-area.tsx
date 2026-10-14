import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { useQueryClient } from '@tanstack/react-query';
import { Route, Switch, useLocation } from 'wouter';
import StaffPage from './staff-page';
import { clearStaffCache } from './staff-cache';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: `${basePath}/staff`,
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#D93A12',
    colorForeground: '#2B1F17',
    colorMutedForeground: '#5E5048',
    colorDanger: '#B32020',
    colorBackground: '#FFFBF5',
    colorInput: '#FFFFFF',
    colorInputForeground: '#2B1F17',
    colorNeutral: '#2B1F17',
    fontFamily: "'IBM Plex Sans KR', sans-serif",
    borderRadius: '0.9rem',
  },
  elements: {
    rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
    cardBox: {
      backgroundColor: '#FFFBF5',
      width: '440px',
      maxWidth: '100%',
      border: '1px solid #E8DCCD',
      borderRadius: '1.25rem',
    },
  },
};

const localization = {
  signIn: {
    start: {
      title: '직원 로그인',
      subtitle: '톡톡 직원 전용 주문 관리',
    },
  },
  signUp: {
    start: {
      title: '직원 계정 만들기',
      subtitle: '가입 후 운영자 승인이 필요합니다',
    },
  },
};

function StaffCacheGuard() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const off = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== id) clearStaffCache(qc);
      prev.current = id;
    });
    return () => {
      off();
      clearStaffCache(qc);
    };
  }, [addListener, qc]);
  return null;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-secondary px-4 py-8">
      {children}
      <p className="text-sm text-muted-foreground">
        모의 주문 / 결제 미연동 - 직원 화면
      </p>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthShell>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/staff`}
      />
    </AuthShell>
  );
}

function SignUpPage() {
  return (
    <AuthShell>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/staff`}
      />
    </AuthShell>
  );
}

export default function StaffArea() {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) {
    return (
      <AuthShell>
        <div role="alert" className="max-w-md rounded-2xl border bg-card p-6">
          <h1 className="text-xl font-semibold">로그인을 사용할 수 없습니다</h1>
          <p className="mt-2 text-muted-foreground">
            인증 설정이 없어 직원 화면을 열 수 없습니다. 키오스크는 계속 사용할 수 있습니다.
          </p>
        </div>
      </AuthShell>
    );
  }
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={localization}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <StaffCacheGuard />
      <Switch>
        <Route path="/staff" component={StaffPage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
      </Switch>
    </ClerkProvider>
  );
}
