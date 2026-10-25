import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { PWAInstallProvider } from '../../context/PWAInstallProvider';
import { usePWAInstall } from '../../context/pwa-install-context';
import PWAInstallGuide from '../../components/PWAInstallGuide';
import PWARegistration from '../../components/PWARegistration';
import OfflinePage from '../../components/OfflinePage';
import ErrorBoundary from '../../components/ErrorBoundary';
import MobileBottomNav from '../../components/MobileBottomNav';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// PWA lifecycle + the last shared components. The install flow is
// event-driven (beforeinstallprompt / display-mode / online-offline), which is
// exactly the kind of wiring that silently rots.

const OpenGuideButton = () => {
  const { openGuide } = usePWAInstall();
  return (
    <button type="button" onClick={(event) => openGuide(event.currentTarget)}>
      Install App
    </button>
  );
};

const StatusProbe = () => {
  const { canInstall, isInstalled } = usePWAInstall();
  return (
    <p>
      {isInstalled ? 'Installed' : 'Browser'} / {canInstall ? 'can-install' : 'no-prompt'}
    </p>
  );
};

const InstallButton = () => {
  const { canInstall, installApp, isInstalled } = usePWAInstall();
  return (
    <button
      type="button"
      disabled={!canInstall || isInstalled}
      onClick={() => installApp()}
    >
      {canInstall ? 'Install now' : 'Install unavailable'}
    </button>
  );
};

describe('PWA install lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the install guide on demand and closes it with Escape', () => {
    renderWithProviders(
      <PWAInstallProvider>
        <OpenGuideButton />
        <PWAInstallGuide />
      </PWAInstallProvider>,
      { contextValue: createMockContextValue() }
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install App' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('captures beforeinstallprompt and delegates installApp to it', async () => {
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' });

    renderWithProviders(
      <PWAInstallProvider>
        <InstallButton />
        <StatusProbe />
      </PWAInstallProvider>,
      { contextValue: createMockContextValue() }
    );

    expect(screen.getByText('Browser / no-prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install unavailable' })).toBeDisabled();

    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice,
      platforms: ['web'],
    });
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(screen.getByText('Browser / can-install')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install now' }));
    });

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('reports the app as installed in standalone display mode', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('display-mode: standalone'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      renderWithProviders(
        <PWAInstallProvider>
          <StatusProbe />
        </PWAInstallProvider>,
        { contextValue: createMockContextValue() }
      );
      expect(screen.getByText('Installed / no-prompt')).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe('PWA update prompt and offline shell', () => {
  it('stays a no-op where service workers are unavailable (jsdom)', () => {
    expect('serviceWorker' in navigator).toBe(false);
    const { container } = renderWithProviders(<PWARegistration />, {
      contextValue: createMockContextValue(),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the offline shell only while the browser is offline', () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

    try {
      const { container } = renderWithProviders(<OfflinePage />, {
        contextValue: createMockContextValue(),
      });
      expect(container).toBeEmptyDOMElement();

      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(screen.getByText(/You're Offline/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(screen.queryByText(/You're Offline/i)).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(window.navigator, 'onLine', original);
    }
  });
});

describe('error boundary and mobile navigation', () => {
  it('catches a render error instead of blanking the page', () => {
    const Boom = () => {
      throw new Error('boom');
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      renderWithProviders(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
        { contextValue: createMockContextValue() }
      );
      // Recovery chrome is rendered rather than an empty document.
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders the mobile navigation targets', () => {
    renderWithProviders(<MobileBottomNav />, {
      contextValue: createMockContextValue({ getCartCount: () => 2 }),
      route: '/',
    });

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll('a, button').length).toBeGreaterThan(0);
  });
});
