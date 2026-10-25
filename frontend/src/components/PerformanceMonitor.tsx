import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PerformanceMetrics {
  loadTime: number;
  domContentLoaded: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
}

const PerformanceMonitor = () => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show in development
    if (!import.meta.env.DEV) return;

    const measurePerformance = () => {
      if ('performance' in window) {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const paint = performance.getEntriesByType('paint');
        
        const firstContentfulPaint = paint.find(entry => entry.name === 'first-contentful-paint');
        const largestContentfulPaint = performance.getEntriesByType('largest-contentful-paint')[0];

        const performanceMetrics: PerformanceMetrics = {
          loadTime: navigation.loadEventEnd - navigation.loadEventStart,
          domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
          firstContentfulPaint: firstContentfulPaint ? firstContentfulPaint.startTime : 0,
          largestContentfulPaint: largestContentfulPaint ? largestContentfulPaint.startTime : 0,
        };

        setMetrics(performanceMetrics);
        setIsVisible(true);

        // Hide after 5 seconds
        setTimeout(() => setIsVisible(false), 5000);
      }
    };

    // Wait for page to fully load
    if (document.readyState === 'complete') {
      measurePerformance();
    } else {
      window.addEventListener('load', measurePerformance);
      return () => window.removeEventListener('load', measurePerformance);
    }
  }, []);

  if (!import.meta.env.DEV || !isVisible || !metrics) return null;

  const getPerformanceColor = (value: number, threshold: number) => {
    if (value <= threshold) return 'text-green-600';
    if (value <= threshold * 1.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 300 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 300 }}
        className="fixed top-4 right-4 z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 max-w-xs"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Performance Monitor</h3>
          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">Load Time:</span>
            <span className={getPerformanceColor(metrics.loadTime, 1000)}>
              {metrics.loadTime.toFixed(0)}ms
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">DOM Ready:</span>
            <span className={getPerformanceColor(metrics.domContentLoaded, 500)}>
              {metrics.domContentLoaded.toFixed(0)}ms
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">First Paint:</span>
            <span className={getPerformanceColor(metrics.firstContentfulPaint, 1000)}>
              {metrics.firstContentfulPaint.toFixed(0)}ms
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">Largest Paint:</span>
            <span className={getPerformanceColor(metrics.largestContentfulPaint, 2500)}>
              {metrics.largestContentfulPaint.toFixed(0)}ms
            </span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>Good</span>
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span>Fair</span>
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span>Poor</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PerformanceMonitor; 