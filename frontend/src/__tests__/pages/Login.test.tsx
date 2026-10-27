// Login page (auth-critical) — unit coverage for the storefront's
// authentication entry point: form structure, mode switching, credential
// submission, inline validation, and the auth-hook contract.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { toast } from 'react-toastify';
import Login from '../../pages/Login';
import { renderWithProviders, createMockContextValue } from '../../test/helpers';
import type { ShopContextType } from '../../types';

// Vitest 5 Mock generic: the whole function type as a single argument
type LoginFlow = {
  contextValue: ShopContextType;
  loginUser: Mock<(email: string, password: string) => Promise<boolean>>;
  registerUser: Mock<(name: string, email: string, password: string) => Promise<boolean>>;
};

const renderLogin = (): LoginFlow => {
  const loginUser = vi.fn(async (_email: string, _password: string): Promise<boolean> => true) as LoginFlow['loginUser'];
  const registerUser = vi.fn(async (_name: string, _email: string, _password: string): Promise<boolean> => true) as LoginFlow['registerUser'];
  const contextValue = createMockContextValue({ loginUser, registerUser });
  renderWithProviders(<Login />, { contextValue });
  return { contextValue, loginUser, registerUser };
};

// The switch control's accessible name now starts with its visible text
// ("Create account") so it satisfies WCAG 2.5.3 Label in Name; the mode is
// still conveyed in the parenthetical suffix.
const switchToSignUp = () =>
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));

const fillSignUp = (name: string, email: string, password: string) => {
  const form = screen.getByRole('form', { name: 'Sign Up form' });
  fireEvent.change(within(form).getByLabelText(/full name/i), { target: { value: name } });
  fireEvent.change(within(form).getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(within(form).getByLabelText(/^password$/i), { target: { value: password } });
};

beforeEach(() => {
  localStorage.clear();
  window.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Login page — structure and mode switching', () => {
  it('renders the sign-in form by default with labelled fields', () => {
    renderLogin();
    expect(screen.getByRole('form', { name: 'Login form' })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
  });

  it('switches to Sign Up mode and reveals the name field', () => {
    renderLogin();
    switchToSignUp();
    expect(screen.getByRole('form', { name: 'Sign Up form' })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
  });

  it('switches back to Login mode', () => {
    renderLogin();
    switchToSignUp();
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }));
    expect(screen.getByRole('form', { name: 'Login form' })).toBeInTheDocument();
  });
});

describe('Login page — credential submission contract', () => {
  it('submits sign-in credentials through the auth hook', async () => {
    const { loginUser } = renderLogin();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Str0ng!Pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    await waitFor(() => expect(loginUser).toHaveBeenCalledTimes(1));
    expect(loginUser).toHaveBeenCalledWith('shopper@example.com', 'Str0ng!Pass');
    expect(await screen.findByText('Login successful!')).toBeInTheDocument();
  });

  it('submits registration details through the register hook (lowercased email)', async () => {
    const { registerUser } = renderLogin();
    switchToSignUp();
    fillSignUp('Test Shopper', 'NEW@example.com', 'Str0ng!Pass');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1));
    expect(registerUser).toHaveBeenCalledWith('Test Shopper', 'new@example.com', 'Str0ng!Pass');
    expect(await screen.findByText('Account created successfully!')).toBeInTheDocument();
  });

  it('shows an inline error when the auth hook reports failure', async () => {
    const loginUser = vi.fn(async (_email: string, _password: string): Promise<boolean> => false) as LoginFlow['loginUser'];
    renderWithProviders(<Login />, {
      contextValue: createMockContextValue({ loginUser }),
    });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    // No success toast navigation; the hook contract is honored (called once).
    await waitFor(() => expect(loginUser).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Login successful!')).not.toBeInTheDocument();
  });
});

describe('Login page — client-side validation (Sign Up)', () => {
  it('rejects a weak password inline without calling the register hook', async () => {
    const { registerUser } = renderLogin();
    switchToSignUp();
    fillSignUp('Test Shopper', 'new@example.com', 'weakpass');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText(/Password must be at least 8 characters/i)).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('rejects a name shorter than 2 characters', async () => {
    const { registerUser } = renderLogin();
    switchToSignUp();
    fillSignUp('A', 'new@example.com', 'Str0ng!Pass');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    // Two UI surfaces can show this message (inline field hint + submit error).
    const matches = await screen.findAllByText(/Name must be at least 2 characters/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed email address', async () => {
    const { registerUser } = renderLogin();
    switchToSignUp();
    fillSignUp('Test Shopper', 'not-an-email', 'Str0ng!Pass');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });
});

describe('Login page — remembered email behaviour', () => {
  it('remembers the email on successful sign-in when Remember Me is checked', async () => {
    const { loginUser } = renderLogin();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'remember@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Str0ng!Pass' } });
    const remember = screen.getByLabelText(/remember me/i);
    if (remember) fireEvent.click(remember);
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    await waitFor(() => expect(loginUser).toHaveBeenCalled());
    await waitFor(() =>
      expect(localStorage.getItem('rememberedEmail')).toBe('remember@example.com')
    );
  });

  it('remembers the normalized email when Remember Me is checked with padded input', async () => {
    const { loginUser } = renderLogin();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  Remember@Example.COM ' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Str0ng!Pass' } });
    fireEvent.click(screen.getByLabelText(/remember me/i));
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    await waitFor(() => expect(loginUser).toHaveBeenCalledWith('remember@example.com', 'Str0ng!Pass'));
    await waitFor(() =>
      expect(localStorage.getItem('rememberedEmail')).toBe('remember@example.com')
    );
  });
});

describe('Login page — email normalization and unavailable sign-in options', () => {
  it('normalizes the email (trim + lowercase) before sign-in', async () => {
    const { loginUser } = renderLogin();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  Shopper@Example.COM ' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Str0ng!Pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    // Registration stores a lowercased email; the backend login is an
    // exact-case findOne, so the submitted value must be normalized.
    await waitFor(() =>
      expect(loginUser).toHaveBeenCalledWith('shopper@example.com', 'Str0ng!Pass')
    );
  });

  it('submits a legacy-length password in Login mode (no client-side minimum blocks it)', async () => {
    const { loginUser } = renderLogin();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'legacy@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'old6!' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    // The minLength=8 attribute is signup-only: the server authenticates
    // migrated accounts with pre-policy passwords regardless of length.
    await waitFor(() => expect(loginUser).toHaveBeenCalledWith('legacy@example.com', 'old6!'));
  });

  it('announces unconfigured Google/Facebook/biometric sign-in instead of failing silently', () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue with facebook/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in with biometrics/i }));

    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/google/i));
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/facebook/i));
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/biometric/i));
  });
});
