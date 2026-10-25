import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWAInstall } from '../context/pwa-install-context';

const PWAInstallGuide = () => {
  const { canInstall, closeGuide, installApp, showGuide } = usePWAInstall();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const userAgent = navigator.userAgent.toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(userAgent);

  useEffect(() => {
    if (!showGuide) return;

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeGuide();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements?.length) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeGuide, showGuide]);

  if (!showGuide) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeGuide();
        }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          className="relative bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <div className="text-center mb-6">
            <div className="text-4xl mb-3" aria-hidden="true">📱</div>
            <h2 id="pwa-install-title" className="text-xl font-bold text-gray-900 mb-2">
              Install NovaCart
            </h2>
            <p className="text-gray-600 text-sm">
              Add NovaCart to your device for a convenient shopping experience.
            </p>
          </div>

          {!canInstall && (
            <div className="bg-blue-50 p-4 rounded-xl mb-6">
              <h3 className="font-semibold text-blue-900 mb-2">Install from your browser</h3>
              {isIOS ? (
                <p className="text-sm text-blue-800">
                  In Safari, tap <strong>Share</strong>, choose <strong>Add to Home Screen</strong>,
                  then tap <strong>Add</strong>.
                </p>
              ) : isAndroid ? (
                <p className="text-sm text-blue-800">
                  Open your browser menu and choose <strong>Install app</strong> or{' '}
                  <strong>Add to Home screen</strong>.
                </p>
              ) : (
                <p className="text-sm text-blue-800">
                  Use the install icon in your browser&apos;s address bar, or choose{' '}
                  <strong>Install app</strong> from its menu.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={closeGuide}
              className="flex-1 px-4 py-3 text-gray-600 bg-gray-100 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              Maybe Later
            </button>
            {canInstall && (
              <button
                type="button"
                onClick={() => void installApp()}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
              >
                Install Now
              </button>
            )}
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeGuide}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close install guide"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PWAInstallGuide;