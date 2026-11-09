import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { navigationMock, supabaseMock } from '@/testing/mocks';
import AuthCallback from './auth/callback/page';
import ResetPassword from './auth/reset/page';
import LoginPage from './login/page';

const fillAndSubmit = (email: string, password?: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  if (password !== undefined) fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form') as HTMLFormElement);
};

describe('LoginPage', () => {
  it('signs in with email and password and goes to the dashboard', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit('me@example.test', 'password123');
    await waitFor(() => expect(navigationMock.router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.test', password: 'password123' });
  });

  it('shows the error when sign-in fails', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });
    render(<LoginPage />);
    fillAndSubmit('me@example.test', 'wrong-password');
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(navigationMock.router.replace).not.toHaveBeenCalled();
  });

  it('registers and continues when a session is returned', async () => {
    supabaseMock.auth.signUp.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Create your account')).toBeInTheDocument();
    fillAndSubmit('new@example.test', 'password123');
    await waitFor(() => expect(navigationMock.router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(supabaseMock.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.test', options: { emailRedirectTo: `${location.origin}/auth/callback` } }));
  });

  it('asks to confirm the email when no session is returned, and reports sign-up errors', async () => {
    supabaseMock.auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: null }).mockResolvedValueOnce({ data: {}, error: new Error('User already registered') });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fillAndSubmit('new@example.test', 'password123');
    expect(await screen.findByText(/Check your email to confirm/)).toBeInTheDocument();
    fillAndSubmit('new@example.test', 'password123');
    expect(await screen.findByText('User already registered')).toBeInTheDocument();
  });

  it('sends a password reset link', async () => {
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fillAndSubmit('me@example.test');
    expect(await screen.findByText(/reset link is on its way/)).toBeInTheDocument();
    expect(supabaseMock.auth.resetPasswordForEmail).toHaveBeenCalledWith('me@example.test', { redirectTo: `${location.origin}/auth/reset` });
  });

  it('reports a reset failure and navigates back to sign in', async () => {
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ error: new Error('Rate limited') });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fillAndSubmit('me@example.test');
    expect(await screen.findByText('Rate limited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
  });

  it('continues with Google and surfaces OAuth errors', async () => {
    supabaseMock.auth.signInWithOAuth.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('Provider disabled') });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(supabaseMock.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Provider disabled')).toBeInTheDocument();
  });
});

describe('AuthCallback', () => {
  it('exchanges the PKCE code and goes to the dashboard', async () => {
    window.history.pushState({}, '', '/auth/callback?code=abc');
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    render(<AuthCallback />);
    await waitFor(() => expect(navigationMock.router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(supabaseMock.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('shows exchange errors', async () => {
    window.history.pushState({}, '', '/auth/callback?code=bad');
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('Code expired') });
    render(<AuthCallback />);
    expect(await screen.findByText('Code expired')).toBeInTheDocument();
  });

  it('explains when no session results', async () => {
    window.history.pushState({}, '', '/auth/callback');
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    render(<AuthCallback />);
    expect(await screen.findByText(/No session was created/)).toBeInTheDocument();
  });
});

describe('ResetPassword', () => {
  it('lets the user choose a new password and then redirects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.pushState({}, '', '/auth/reset?code=abc');
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    supabaseMock.auth.updateUser.mockResolvedValue({ error: null });
    render(<ResetPassword />);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Update password' }).closest('form') as HTMLFormElement);
    expect(await screen.findByText('Password updated. Redirecting…')).toBeInTheDocument();
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
    vi.advanceTimersByTime(1500);
    expect(navigationMock.router.replace).toHaveBeenCalledWith('/dashboard');
    vi.useRealTimers();
  });

  it('reports update errors', async () => {
    window.history.pushState({}, '', '/auth/reset');
    supabaseMock.auth.updateUser.mockResolvedValue({ error: new Error('Password too weak') });
    render(<ResetPassword />);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'weak-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Update password' }).closest('form') as HTMLFormElement);
    expect(await screen.findByText('Password too weak')).toBeInTheDocument();
  });

  it('rejects an invalid or expired link', async () => {
    window.history.pushState({}, '', '/auth/reset?code=bad');
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('Link expired') });
    const { unmount } = render(<ResetPassword />);
    expect(await screen.findByText('Link expired')).toBeInTheDocument();
    unmount();
    window.history.pushState({}, '', '/auth/reset');
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    render(<ResetPassword />);
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
  });
});
