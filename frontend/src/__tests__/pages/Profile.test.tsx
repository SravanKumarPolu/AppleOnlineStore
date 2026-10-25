import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import Profile from '../../pages/Profile';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// Profile had no tests, and its "Save Changes" button silently discarded the
// edit (handleSave was a TODO). These specs lock the real PUT wiring and the
// cancel/validation paths.

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const user = { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'user' as const };

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe('Profile page', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    navigateSpy.mockReset();
    fetchMock = vi.fn(() =>
      jsonResponse({
        success: true,
        message: 'Profile updated successfully',
        user: { id: 'user-1', name: 'Ada Byron', email: 'ada.byron@example.com', role: 'user' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  const renderProfile = (overrides = {}) =>
    renderWithProviders(<Profile />, {
      contextValue: createMockContextValue({
        isLoggedIn: true,
        token: 'shopper-token',
        user,
        ...overrides,
      }),
    });

  it('shows the signed-in user read-only, with logout available', () => {
    renderProfile();

    expect(screen.getByText('My Profile')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves the edit through PUT /api/user/profile and adopts the returned user', async () => {
    const setUser = vi.fn();
    renderProfile({ setUser });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

    const nameInput = screen.getByDisplayValue('Ada Lovelace');
    fireEvent.change(nameInput, { target: { value: 'Ada Byron' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/user/profile');
    expect(init.method).toBe('PUT');
    expect(init.headers.token).toBe('shopper-token');
    expect(JSON.parse(init.body)).toEqual({ name: 'Ada Byron', email: 'ada@example.com' });

    await waitFor(() => expect(setUser).toHaveBeenCalledWith({
      id: 'user-1',
      name: 'Ada Byron',
      email: 'ada.byron@example.com',
      role: 'user',
    }));
    expect(toast.success).toHaveBeenCalledWith('Profile updated successfully');
    // Back to read-only mode.
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('keeps the form open and shows the server message when the update is rejected', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ success: false, message: 'Email is already taken by another user' })
    );
    const setUser = vi.fn();
    renderProfile({ setUser });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email is already taken by another user'));
    expect(setUser).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument();
  });

  it('reports a network failure instead of pretending the save worked', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const setUser = vi.fn();
    renderProfile({ setUser });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update profile'));
    expect(setUser).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards edits on Cancel', () => {
    renderProfile();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    fireEvent.change(screen.getByDisplayValue('Ada Lovelace'), { target: { value: 'Temp Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs out and returns home', () => {
    const logoutUser = vi.fn();
    renderProfile({ logoutUser });

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(logoutUser).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('redirects anonymous visitors to login', () => {
    renderProfile({ isLoggedIn: false, user: null });

    expect(screen.getByText('Please Login')).toBeInTheDocument();
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });
});
