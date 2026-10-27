import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import ResetPassword from '../../pages/ResetPassword';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// The reset-password page is the second half of the password-recovery flow.
// It had no tests; the backend consumption rules are covered by
// passwordResetConsumption.spec.js, these cover the client contract.

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe('ResetPassword page', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    navigateSpy.mockReset();
    fetchMock = vi.fn(() => jsonResponse({ success: true, message: 'Password reset successful' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  const renderPage = (token = 'reset-token-123') =>
    renderWithProviders(<ResetPassword />, {
      contextValue: createMockContextValue(),
      route: token ? `/reset-password?token=${token}` : '/reset-password',
    });

  it('rejects a link without a token and sends the shopper to login', () => {
    renderPage('');

    expect(toast.error).toHaveBeenCalledWith(
      'Invalid reset link. Please request a new password reset.'
    );
    expect(navigateSpy).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('button', { name: /Reset Password/i })).not.toBeInTheDocument();
  });

  it('blocks submission when the two passwords differ (no request sent)', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), { target: { value: 'Str0ng!other' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset Password/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the password policy before calling the API', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'weakpass' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), { target: { value: 'weakpass' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset Password/i }));

    expect(await screen.findByText(/Password must be at least 8 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the token and the new password, then shows the success state', async () => {
    renderPage('token-abc');

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset Password/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/user/reset-password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'token-abc', newPassword: 'Str0ng!pass' });

    expect(await screen.findByText(/has been reset successfully/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Password reset successfully!');
  });

  it('surfaces a rejected token from the API', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ success: false, message: 'Invalid or expired reset token' })
    );
    renderPage('expired-token');

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset Password/i }));

    expect(await screen.findByText('Invalid or expired reset token')).toBeInTheDocument();
    expect(screen.queryByText(/has been reset successfully/i)).not.toBeInTheDocument();
  });

  it('shows the live password checklist while typing', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'Ab1!abcd' } });

    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('One special character (@$!%*?&)')).toBeInTheDocument();
  });

  it('labels both password visibility toggles for screen readers', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show confirm password' })).toBeInTheDocument();
  });

  it('clears the submitted passwords and the stale local session on success', async () => {
    const setToken = vi.fn();
    renderWithProviders(<ResetPassword />, {
      contextValue: createMockContextValue({ setToken }),
      route: '/reset-password?token=stale-session',
    });

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), { target: { value: 'Str0ng!pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset Password/i }));

    // AF-2 on the backend bumps tokenVersion, so every existing JWT for this
    // account is dead — the frontend must drop the stale local session and
    // the sensitive form state with it.
    await waitFor(() => expect(setToken).toHaveBeenCalledWith(''));
    expect(await screen.findByText(/has been reset successfully/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New Password/i)).not.toBeInTheDocument();
  });
});
