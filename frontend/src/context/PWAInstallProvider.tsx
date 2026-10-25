import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'react-toastify';
import { PWAInstallContext } from './pwa-install-context';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const isAppInstalled = () => {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  return isStandalone || isIOSStandalone;
};

export const PWAInstallProvider = ({ children }: { children: ReactNode }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isAppInstalled);
  const [showGuide, setShowGuide] = useState(false);
  const guideTrigger = useRef<HTMLElement | null>(null);

  const closeGuide = useCallback(() => {
    setShowGuide(false);
    guideTrigger.current?.focus();
  }, []);

  const openGuide = useCallback(
    (trigger?: HTMLElement) => {
      if (isInstalled) return;
      guideTrigger.current = trigger ?? null;
      setShowGuide(true);
    },
    [isInstalled],
  );

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => setIsInstalled(isAppInstalled());
    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      if (typeof promptEvent.prompt !== 'function' || !promptEvent.userChoice) return;

      event.preventDefault();
      setDeferredPrompt(promptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowGuide(false);
      toast.success('NovaCart installed successfully!');
    };

    displayMode.addEventListener('change', handleDisplayModeChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      displayMode.removeEventListener('change', handleDisplayModeChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return;

    const promptEvent = deferredPrompt;
    setDeferredPrompt(null);

    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') setIsInstalled(true);
      closeGuide();
    } catch (error) {
      console.error('Error during app installation:', error);
      toast.error('Unable to start installation. Use your browser menu to install the app.');
    }
  }, [closeGuide, deferredPrompt]);

  const value = useMemo(
    () => ({
      canInstall: deferredPrompt !== null,
      isInstalled,
      showGuide,
      openGuide,
      closeGuide,
      installApp,
    }),
    [closeGuide, deferredPrompt, installApp, isInstalled, openGuide, showGuide],
  );

  return <PWAInstallContext.Provider value={value}>{children}</PWAInstallContext.Provider>;
};
