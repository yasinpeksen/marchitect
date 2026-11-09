import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useApi, useData } from '@/lib/api';
import { useSupabase } from '@/lib/config';
import { apiMock, lookupData, navigationMock, resetMocks, supabaseMock } from './mocks';

vi.mock('next/navigation', async () => {
  const { navigationMock: mock } = await import('./mocks');
  return {
    useRouter: () => mock.router,
    usePathname: () => mock.pathname,
    useSearchParams: () => mock.searchParameters,
    useParams: () => mock.routeParameters,
    redirect: vi.fn(),
  };
});

// Real implementations stay available through vi.importActual in the tests of these modules.
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), useData: vi.fn(), useApi: vi.fn() }));
vi.mock('@/lib/config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/config')>()), useSupabase: vi.fn(), useConfig: vi.fn() }));

// The Supabase browser client is replaced everywhere; config.test.tsx asserts how it is created.
vi.mock('@supabase/ssr', () => ({ createBrowserClient: vi.fn(() => ({ auth: 'client' })) }));

// Charts need layout measurement jsdom does not have: render their children flat.
vi.mock('recharts', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-chart': true }, children);
  const empty = () => null;
  return {
    ResponsiveContainer: passthrough, LineChart: passthrough, BarChart: passthrough,
    Line: empty, Bar: empty, XAxis: empty, YAxis: empty, CartesianGrid: empty, Tooltip: empty, Legend: empty,
  };
});

beforeEach(() => {
  resetMocks();
  vi.mocked(useApi).mockReturnValue(apiMock);
  vi.mocked(useData).mockImplementation(((path: string | null) => lookupData(path)) as never);
  vi.mocked(useSupabase).mockReturnValue(supabaseMock as never);
});

// Unmount rendered components between tests so DOM state never leaks.
afterEach(() => {
  cleanup();
  navigationMock.router.replace.mockReset();
});
