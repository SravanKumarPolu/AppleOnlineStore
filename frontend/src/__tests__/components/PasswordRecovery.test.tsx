// PasswordRecovery modal — the first half of the password-recovery flow.
// Backend consumption rules live in backend passwordResetConsumption.spec.js;
// these cover the client contract: dialog semantics, focus management,
// submission, and — critically — that a failed request is NEVER silent
// (the pre-2026-10-27 modal swallowed every failure).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import PasswordRecovery from '../../components/PasswordRecovery';
import Login from '../../pages/Login';
import { renderWithProviders, createMockContextValue } from '../../test/helpers';

type RecoveryFn = (email: string) => Promise<boolean>;

const renderModal = (
  overrides: {
    onRecoveryRequest?: RecoveryFn;
    onClose?: () => void;
    initialEmail?: string;
  } = {},
) => {
  const onRecoveryRequest: RecoveryFn =
    overrides.onRecoveryRequest ?? vi.fn(async (_email: string) => true);
  const onClose = overrides.onClose ?? vi.fn();
  renderWithProviders(
    <PasswordRecovery
      isOpen
      onClose={onClose}
      onRecoveryRequest={onRecoveryRequest}
      initialEmail={overrides.initialEmail}
    />,
  );
  return { onRecoveryRequest, onClose };
};

// A request that never settles until the test resolves it manually. The
// resolver lives in a holder object: a bare `{ request, resolve }` would
// snapshot the (undefined) binding at return time.
const pendingRequest = () => {
  const state: { resolve?: (value: boolean) => void } = {};
  const request: RecoveryFn = () =>
    new Promise<boolean>((res) => {
      state.resolve = res;
    });
  return { request, resolve: (value: boolean) => state.resolve!(value) };
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PasswordRecovery — dialog semantics and focus management', () => {
  it('is a labelled dialog that moves focus into the email field on open', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Reset Password' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveFocus();
  });

  it('prefills the email typed on the login form but keeps it editable', () => {
    renderModal({ initialEmail: 'shopper@example.com' });

    const input = screen.getByLabelText(/email address/i) as HTMLInputElement;
    expect(input.value).toBe('shopper@example.com');
    fireEvent.change(input, { target: { value: 'other@example.com' } });
    expect(input.value).toBe('other@example.com');
  });

  it('keeps Tab inside the dialog (Shift+Tab from the first control wraps to the last)', () => {
    renderModal();

    const closeIcon = screen.getByRole('button', { name: /close password recovery/i });
    closeIcon.focus();
    fireEvent.keyDown(closeIcon, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: /send reset link/i })).toHaveFocus();
  });

  it('closes via the close icon and via Cancel', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /close password recovery/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape and returns focus to the initiating control (Login integration)', async () => {
    renderWithProviders(<Login />, { contextValue: createMockContextValue() });

    const openButton = screen.getByRole('button', { name: /forgot password/i });
    openButton.focus(); // jsdom does not focus buttons on programmatic click
    fireEvent.click(openButton);
    const dialog = screen.getByRole('dialog', { name: 'Reset Password' });
    expect(within(dialog).getByLabelText(/email address/i)).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(openButton).toHaveFocus();
  });
});

describe('PasswordRecovery — submission and feedback', () => {
  it('sends the typed email through the recovery handler and confirms safely', async () => {
    const { onRecoveryRequest } = renderModal();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(onRecoveryRequest).toHaveBeenCalledWith('shopper@example.com'));
    // Enumeration-safe copy with inbox/spam guidance (never "email delivered").
    expect(await screen.findByText(/if an account exists for this email/i)).toBeInTheDocument();
    expect(screen.getByText(/inbox and spam folder/i)).toBeInTheDocument();
  });

  it('never stays silent when the request fails (HTTP 4xx/5xx path)', async () => {
    renderModal({ onRecoveryRequest: vi.fn(async () => false) });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/couldn't send the reset link/i)).toBeInTheDocument();
  });

  it('shows a connection message when the server is unreachable', async () => {
    renderModal({
      onRecoveryRequest: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/unable to reach the server/i)).toBeInTheDocument();
  });

  it('shows a visible loading state and disables submission while sending', async () => {
    const { request } = pendingRequest();
    renderModal({ onRecoveryRequest: request });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    const { request, resolve } = pendingRequest();
    const onRecoveryRequest = vi.fn(request);
    renderModal({ onRecoveryRequest });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    // Capture the button before the first click: while in flight it is
    // renamed to "Sending…" and the accessible name no longer matches.
    const send = screen.getByRole('button', { name: /send reset link/i });
    fireEvent.click(send);
    fireEvent.click(send);
    resolve(true);

    await waitFor(() => expect(onRecoveryRequest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it('keeps the dialog open on Escape while a request is in flight', async () => {
    const { request, resolve } = pendingRequest();
    const onClose = vi.fn();
    renderModal({ onClose, onRecoveryRequest: request });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolve(true);
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });
});
