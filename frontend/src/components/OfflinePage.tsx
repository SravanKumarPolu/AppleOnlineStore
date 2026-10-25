import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const OfflinePage = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-white flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="text-center max-w-md">
        {/* Offline Icon */}
        <motion.div
          className="text-6xl mb-6"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring" }}
        >
          📡
        </motion.div>

        {/* Title */}
        <motion.h1
          className="text-2xl font-bold text-gray-900 mb-4"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          You're Offline
        </motion.h1>

        {/* Description */}
        <motion.p
          className="text-gray-600 mb-8 leading-relaxed"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Don't worry! You can still browse previously viewed products and access your cart. 
          Check your internet connection and try again.
        </motion.p>

        {/* Action Buttons */}
        <motion.div
          className="space-y-4"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <button
            onClick={() => window.location.reload()}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
          
          <button
            onClick={() => window.history.back()}
            className="w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
          >
            Go Back
          </button>
        </motion.div>

        {/* Offline Features */}
        <motion.div
          className="mt-8 p-4 bg-blue-50 rounded-xl"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <h3 className="font-semibold text-blue-900 mb-2">Available Offline:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Browse cached products</li>
            <li>• View your shopping cart</li>
            <li>• Access your profile</li>
            <li>• View order history</li>
          </ul>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default OfflinePage; 