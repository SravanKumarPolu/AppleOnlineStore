import { createContext, useContext } from 'react';

export interface PWAInstallContextValue {
  canInstall: boolean;
  isInstalled: boolean;
  showGuide: boolean;
  openGuide: (trigger?: HTMLElement) => void;
  closeGuide: () => void;
  installApp: () => Promise<void>;
}

export const PWAInstallContext = createContext<PWAInstallContextValue | null>(null);

export const usePWAInstall = () => {
  const context = useContext(PWAInstallContext);
  if (!context) {
    throw new Error('usePWAInstall must be used within a PWAInstallProvider');
  }
  return context;
};
