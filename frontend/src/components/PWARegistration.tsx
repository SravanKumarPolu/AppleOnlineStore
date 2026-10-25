import { useEffect } from 'react';
import { toast } from 'react-toastify';

const PWARegistration = () => {
  useEffect(() => {
    // Listen for service worker updates
    const handleSWUpdate = () => {
      toast.info(
        <div>
          <p className="font-semibold">New version available!</p>
          <p className="text-sm">A new version of NovaCart is ready to install.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            Update Now
          </button>
        </div>,
        {
          autoClose: false,
          closeOnClick: false,
          draggable: false,
          position: 'bottom-right'
        }
      );
    };

    // Listen for service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', handleSWUpdate);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', handleSWUpdate);
      }
    };
  }, []);

  return null;
};

export default PWARegistration; 