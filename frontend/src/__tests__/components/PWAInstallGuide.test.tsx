import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NavBar from '../../components/NavBar';
import PWAInstallGuide from '../../components/PWAInstallGuide';
import { PWAInstallProvider } from '../../context/PWAInstallProvider';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

const originalUserAgent = navigator.userAgent;

const renderInstallExperience = () =>
  renderWithProviders(
    <PWAInstallProvider>
      <NavBar />
      <PWAInstallGuide />
    </PWAInstallProvider>,
    { contextValue: createMockContextValue() },
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent,
  });
});

describe('PWA installation guide', () => {
  it('does not open automatically, including after the previous five-second delay', async () => {
    vi.useFakeTimers();
    renderInstallExperience();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens only after Install App is activated and can be dismissed with Maybe Later or Close', () => {
    renderInstallExperience();

    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));
    expect(screen.getByRole('dialog', { name: 'Install NovaCart' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe Later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));
    // The icon-only dismiss control was given a unique, descriptive name
    // ("Close install guide") so it is distinguishable from other dialogs.
    fireEvent.click(screen.getByRole('button', { name: /close install guide/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the captured native prompt only after the user clicks Install Now', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      platforms: string[];
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
      prompt: () => Promise<void>;
    };
    Object.defineProperties(event, {
      platforms: { value: ['web'] },
      userChoice: { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) },
      prompt: { value: prompt },
    });

    renderInstallExperience();
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Install Now' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Install App' })).not.toBeInTheDocument(),
    );
  });

  it('handles a dismissed native prompt without marking the app installed', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      platforms: string[];
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
      prompt: () => Promise<void>;
    };
    Object.defineProperties(event, {
      platforms: { value: ['web'] },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }) },
      prompt: { value: prompt },
    });

    renderInstallExperience();
    await act(async () => {
      window.dispatchEvent(event);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install Now' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Install App' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows browser-specific manual instructions when native prompting is unavailable', () => {
    renderInstallExperience();
    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));

    expect(
      screen.getByText(/Use the install icon in your browser's address bar/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install Now' })).not.toBeInTheDocument();
  });

  it('shows the iOS Safari Add to Home Screen instructions', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    });

    renderInstallExperience();
    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));

    expect(screen.getByText(/In Safari, tap/i)).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it('does not show the install action when already installed', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));

    renderInstallExperience();

    expect(screen.queryByRole('button', { name: 'Install App' })).not.toBeInTheDocument();
  });

  it('hides the install action when the browser reports that the app was installed', async () => {
    renderInstallExperience();
    expect(screen.getByRole('button', { name: 'Install App' })).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(screen.queryByRole('button', { name: 'Install App' })).not.toBeInTheDocument();
  });
});
