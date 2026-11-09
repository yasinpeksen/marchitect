import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiMock, dataState, navigationMock, supabaseMock } from '@/testing/mocks';
import { isActiveRoute, NAVIGATION, NotificationsBell, Shell } from './shell';

describe('isActiveRoute', () => {
  it('matches exact and nested routes only', () => {
    expect(isActiveRoute('/ads/1', '/ads')).toBe(true);
    expect(isActiveRoute('/library', '/library')).toBe(true);
    expect(isActiveRoute('/library-x', '/library')).toBe(false);
    expect(isActiveRoute('/dashboard', '/search')).toBe(false);
  });
});

describe('NAVIGATION', () => {
  it('has every page of the app', () => {
    expect(NAVIGATION.map((entry) => entry.href)).toEqual(['/dashboard', '/search', '/library', '/saved', '/scheduler', '/history', '/connections', '/settings']);
  });
});

describe('NotificationsBell', () => {
  const unread = [{ id: 'n1', type: 'schedule_failed', title: 'Schedule failed', body: 'Meta said no', created_at: '2026-03-01T10:00:00Z' }];

  it('shows the unread count and the notifications when opened', () => {
    dataState.responses['/notifications?unread=true'] = unread;
    render(<NotificationsBell />);
    expect(screen.getByText('1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('Schedule failed')).toBeInTheDocument();
    expect(screen.getByText('Meta said no')).toBeInTheDocument();
  });

  it('says there is nothing new', () => {
    dataState.responses['/notifications?unread=true'] = [];
    render(<NotificationsBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('No new notifications.')).toBeInTheDocument();
  });

  it('marks everything as read', async () => {
    dataState.responses['/notifications?unread=true'] = unread;
    apiMock.post.mockResolvedValue(undefined);
    render(<NotificationsBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/notifications/read', {}));
    await waitFor(() => expect(dataState.mutate).toHaveBeenCalledWith([]));
  });
});

describe('Shell', () => {
  it('shows a spinner, then the page and the user email once the session exists', async () => {
    render(<Shell><p>Page body</p></Shell>);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Page body')).toBeInTheDocument();
    expect(screen.getByText('me@example.test')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Ad Search/ }).length).toBeGreaterThan(0);
  });

  it('redirects to /login without a session', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    render(<Shell><p>Secret</p></Shell>);
    await waitFor(() => expect(navigationMock.router.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Secret')).toBeNull();
  });

  it('redirects when the session ends and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    let listener: (event: string, session: unknown) => void = () => undefined;
    supabaseMock.auth.onAuthStateChange.mockImplementation((callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    });
    const { unmount } = render(<Shell><p>Body</p></Shell>);
    await screen.findByText('Body');
    listener('SIGNED_OUT', null);
    expect(navigationMock.router.replace).toHaveBeenCalledWith('/login');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('signs out', async () => {
    supabaseMock.auth.signOut.mockResolvedValue({});
    render(<Shell><p>Body</p></Shell>);
    await screen.findByText('Body');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(supabaseMock.auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(navigationMock.router.replace).toHaveBeenCalledWith('/login'));
  });

  it('opens and closes the mobile menu', async () => {
    render(<Shell><p>Body</p></Shell>);
    await screen.findByText('Body');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
  });
});
