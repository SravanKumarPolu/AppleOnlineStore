import { useEffect, useRef, useState } from 'react';

interface PasswordRecoveryProps {
  isOpen: boolean;
  onClose: () => void;
  onRecoveryRequest: (email: string) => Promise<boolean>;
  /** Email typed on the login form, offered as a starting point (editable). */
  initialEmail?: string;
}

// Focusable descendants of the dialog, in DOM order — the basis of the trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PasswordRecovery = ({ isOpen, onClose, onRecoveryRequest, initialEmail = '' }: PasswordRecoveryProps) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  // The control that opened the modal — focus returns there on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // On open: reset the form, remember the initiator, move focus into the dialog.
  useEffect(() => {
    if (!isOpen) return;
    setEmail(initialEmail);
    setError('');
    setSuccess(false);
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    emailInputRef.current?.focus();
  }, [isOpen, initialEmail]);

  const close = () => {
    onClose();
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!isLoading) close();
      return;
    }
    // Keep Tab (and Shift+Tab) inside the dialog.
    if (e.key === 'Tab' && dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // duplicate-submission guard
    setIsLoading(true);
    setError('');

    try {
      const sent = await onRecoveryRequest(email);
      if (sent) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setEmail('');
          close();
        }, 3000);
      } else {
        // Covers HTTP 400/429/500 and any rejected payload — a safe, generic
        // message; the backend's enumeration-safe responses stay the authority.
        setError("We couldn't send the reset link. Please check the email address and try again in a few minutes.");
      }
    } catch {
      setError('Unable to reach the server. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-recovery-title"
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md animate-fade-in"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 id="password-recovery-title" className="text-xl font-bold text-gray-900">
            Reset Password
          </h2>
          <button
            onClick={isLoading ? undefined : close}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close password recovery"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="text-center" role="status" aria-live="polite">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Request Sent</h3>
            <p className="text-gray-600">
              If an account exists for this email address, a password reset link is on its way.
              Please check your inbox and spam folder.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="recovery-email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                ref={emailInputRef}
                id="recovery-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your email address"
                required
                aria-describedby="recovery-email-help"
              />
              <p id="recovery-email-help" className="text-sm text-gray-500 mt-1">
                We'll send you a link to reset your password.
              </p>
            </div>

            {error && (
              <div
                className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={isLoading ? undefined : close}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default PasswordRecovery;
