import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { KioskProvider } from '@/hooks/use-kiosk';
import KioskPage from '@/pages/kiosk';
import DebugPage from '@/pages/debug';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const StaffArea = lazy(() => import('@/staff/staff-area'));

function StaffRoute() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="min-h-[100dvh] bg-secondary" aria-busy="true" />}>
        <StaffArea />
      </Suspense>
    </ErrorBoundary>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={KioskPage} />
        <Route path="/debug" component={DebugPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/staff" component={StaffRoute} />
            <Route path="/sign-in/*?" component={StaffRoute} />
            <Route path="/sign-up/*?" component={StaffRoute} />
            <Route>
              <KioskProvider>
                <Router />
              </KioskProvider>
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
