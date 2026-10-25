import { useState, useEffect } from 'react';

interface PerformanceMode {
  isLowPerformance: boolean;
  reducedAnimations: boolean;
  particleCount: number;
}

// Non-standard navigator extensions used for device capability detection
// (deviceMemory is a Chrome proposal; connection is the Network Information API).
interface NetworkInformationLike {
  effectiveType?: string;
}

interface CapabilityNavigator extends Navigator {
  deviceMemory?: number;
  connection?: NetworkInformationLike;
}

export const usePerformanceMode = (): PerformanceMode => {
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>({
    isLowPerformance: false,
    reducedAnimations: false,
    particleCount: 20
  });

  useEffect(() => {
    const detectPerformance = () => {
      const capabilities = navigator as CapabilityNavigator;

      // Check for hardware concurrency (CPU cores)
      const cores = navigator.hardwareConcurrency || 4;

      // Check for device memory
      const memory = capabilities.deviceMemory || 4;

      // Check for connection speed
      const connection = capabilities.connection;
      const isSlowConnection = connection !== undefined && (
        connection.effectiveType === 'slow-2g' ||
        connection.effectiveType === '2g' ||
        connection.effectiveType === '3g'
      );
      
      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      
      // Determine if device is low performance
      const isLowPerformance = cores <= 2 || memory <= 2 || isSlowConnection || prefersReducedMotion;
      
      setPerformanceMode({
        isLowPerformance,
        reducedAnimations: isLowPerformance || prefersReducedMotion,
        particleCount: isLowPerformance ? 8 : 20
      });
    };

    detectPerformance();
    
    // Listen for changes in reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => detectPerformance();
    
    mediaQuery.addEventListener('change', handleChange);
    
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return performanceMode;
}; 