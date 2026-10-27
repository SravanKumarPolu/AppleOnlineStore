// Admin login form contract: posts credentials to the backend admin-login
// endpoint, stores the token via setToken on success, and maps a 401 to the
// dedicated "invalid credentials" toast. axios.post is spied (not
// module-mocked) so apiTypes' real isAxiosError triage keeps working.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-toastify';

import Login from '../../components/Login';
import { backendUrl } from '../../config';

const setToken = vi.fn();
const config = {} as InternalAxiosRequestConfig;

const responseOf = (status: number, data: unknown): AxiosResponse =>
  ({ status, statusText: '', data, headers: {}, config }) as AxiosResponse;

const fillAndSubmit = async () => {
  // The labels have no htmlFor — select the inputs by their placeholders.
  await userEvent.type(screen.getByPlaceholderText('admin@example.com'), 'admin@example.com');
  await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'secret-password');
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

describe('Login (admin panel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setToken.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the credentials to /api/user/admin and stores the token on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { success: true, token: 'admin-token-123' } });

    render(<Login setToken={setToken} />);
    await fillAndSubmit();

    await waitFor(() => expect(setToken).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(
      `${backendUrl}/api/user/admin`,
      { email: 'admin@example.com', password: 'secret-password' }
    );
    expect(setToken).toHaveBeenCalledWith('admin-token-123');
    expect(toast.success).toHaveBeenCalledWith('Login successful! Welcome back.');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('maps a 401 to the dedicated invalid-credentials toast and never stores a token', async () => {
    const error = new AxiosError(
      'Request failed with status code 401',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      responseOf(401, { success: false, message: 'Invalid admin credentials' })
    );
    vi.spyOn(axios, 'post').mockRejectedValue(error);

    render(<Login setToken={setToken} />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Invalid admin credentials. Please check your email and password.'
      )
    );
    expect(setToken).not.toHaveBeenCalled();
  });

  it('maps a server 500 to the generic server-error toast', async () => {
    const error = new AxiosError(
      'Request failed with status code 500',
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      responseOf(500, { success: false, message: 'Admin configuration error' })
    );
    vi.spyOn(axios, 'post').mockRejectedValue(error);

    render(<Login setToken={setToken} />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Server error. Please try again later.')
    );
    expect(setToken).not.toHaveBeenCalled();
  });

  it('shows validation messages returned for a 400 response', async () => {
    const error = new AxiosError(
      'Request failed with status code 400',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      responseOf(400, { success: false, message: 'Validation failed' })
    );
    vi.spyOn(axios, 'post').mockRejectedValue(error);

    render(<Login setToken={setToken} />);
    await fillAndSubmit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Validation failed'));
    expect(setToken).not.toHaveBeenCalled();
  });

  it('maps a network failure to the connection toast', async () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK', config, {} as never);
    vi.spyOn(axios, 'post').mockRejectedValue(error);

    render(<Login setToken={setToken} />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Network error. Please check your connection.')
    );
    expect(setToken).not.toHaveBeenCalled();
  });

  it('does not submit when required fields are empty (HTML validation)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    render(<Login setToken={setToken} />);
    // The form inputs are `required` — jsdom enforces the constraint on submit.
    const form = screen.getByRole('button', { name: /sign in/i }).closest('form');
    expect(form).toBeTruthy();
    expect(
      (screen.getByPlaceholderText('admin@example.com') as HTMLInputElement).required
    ).toBe(true);
    expect(
      (screen.getByPlaceholderText('Enter your password') as HTMLInputElement).required
    ).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });
});
