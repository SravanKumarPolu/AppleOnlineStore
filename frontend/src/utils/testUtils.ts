// Test utilities for authentication system
export const mockUser = {
  id: '507f1f77bcf86cd799439011',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'user',
  createdAt: new Date('2024-01-01'),
  lastLogin: new Date('2024-01-15')
};

export const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsImlhdCI6MTcwNTQ0NzIwMCwiZXhwIjoxNzA2MDUyMDAwfQ.test-signature';

export const mockPasswordResetToken = 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';

// Mock API responses
export const mockApiResponses = {
  loginSuccess: {
    success: true,
    token: mockToken,
    user: mockUser
  },
  loginFailure: {
    success: false,
    message: 'Invalid credentials'
  },
  registerSuccess: {
    success: true,
    token: mockToken,
    user: mockUser
  },
  registerFailure: {
    success: false,
    message: 'User already exists with this email'
  },
  passwordResetRequest: {
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.'
  },
  passwordResetSuccess: {
    success: true,
    message: 'Password has been reset successfully'
  },
  passwordResetFailure: {
    success: false,
    message: 'Invalid or expired password reset token'
  }
};

// Test data for form validation
export const testPasswords = {
  valid: 'TestPass123!',
  invalid: {
    tooShort: 'Test1!',
    noUppercase: 'testpass123!',
    noLowercase: 'TESTPASS123!',
    noNumber: 'TestPass!',
    noSpecialChar: 'TestPass123'
  }
};

export const testEmails = {
  valid: 'test@example.com',
  invalid: [
    'test@',
    '@example.com',
    'test.example.com',
    'test@example',
    'test example.com'
  ]
};

// Performance test data
export const performanceTestData = {
  lowEndDevice: {
    hardwareConcurrency: 2,
    deviceMemory: 2,
    connection: { effectiveType: '3g' },
    prefersReducedMotion: true
  },
  highEndDevice: {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    connection: { effectiveType: '4g' },
    prefersReducedMotion: false
  }
};

// Accessibility test helpers
export const accessibilityTestHelpers = {
  // Check if element has proper ARIA attributes
  hasAriaLabel: (element: HTMLElement) => {
    return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
  },
  
  // Check if element is focusable
  isFocusable: (element: HTMLElement) => {
    const tabIndex = element.getAttribute('tabindex');
    return element.tagName === 'BUTTON' || 
           element.tagName === 'INPUT' || 
           element.tagName === 'A' || 
           (tabIndex && parseInt(tabIndex) >= 0);
  },
  
  // Check if element has proper role
  hasRole: (element: HTMLElement, role: string) => {
    return element.getAttribute('role') === role;
  },
  
  // Check if form has proper labels
  hasFormLabels: (form: HTMLFormElement) => {
    const inputs = form.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
    return Array.from(inputs).every(input => {
      const id = input.getAttribute('id');
      if (!id) return false;
      return form.querySelector(`label[for="${id}"]`) !== null;
    });
  }
};

// Browser compatibility test data
export const browserTestData = {
  supportedBrowsers: [
    'Chrome 90+',
    'Firefox 88+',
    'Safari 14+',
    'Edge 90+'
  ],
  unsupportedBrowsers: [
    'Internet Explorer 11',
    'Chrome 89',
    'Firefox 87',
    'Safari 13'
  ]
};

// Security test data
export const securityTestData = {
  xssPayloads: [
    '<script>alert("XSS")</script>',
    'javascript:alert("XSS")',
    '"><script>alert("XSS")</script>',
    '"><img src=x onerror=alert("XSS")>'
  ],
  sqlInjectionPayloads: [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT * FROM users --"
  ],
  csrfTokens: [
    'valid-csrf-token-123',
    'invalid-csrf-token-456',
    'expired-csrf-token-789'
  ]
};

// Network test scenarios
export const networkTestScenarios = {
  slowConnection: {
    latency: 1000,
    bandwidth: 'slow-2g',
    offline: false
  },
  fastConnection: {
    latency: 50,
    bandwidth: '4g',
    offline: false
  },
  offline: {
    latency: 0,
    bandwidth: 'none',
    offline: true
  }
};

// Device test scenarios
export const deviceTestScenarios = {
  mobile: {
    screen: { width: 375, height: 667 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
    touch: true
  },
  tablet: {
    screen: { width: 768, height: 1024 },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
    touch: true
  },
  desktop: {
    screen: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    touch: false
  }
};

// Test environment helpers
export const testEnvironment = {
  isDevelopment: import.meta.env.DEV,
  isTest: import.meta.env.MODE === 'test',
  isProduction: import.meta.env.PROD,
  
  // Mock environment variables
  mockEnvVars: {
    VITE_BACKEND_URL: 'http://localhost:3001',
    VITE_APP_NAME: 'E-commerce Store',
    VITE_APP_VERSION: '1.0.0'
  }
};

// Error simulation helpers
export const errorSimulation = {
  // Simulate network errors
  simulateNetworkError: () => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Network error')), 100);
    });
  },
  
  // Simulate timeout
  simulateTimeout: (timeout = 5000) => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeout);
    });
  },
  
  // Simulate server error
  simulateServerError: (status = 500) => {
    return Promise.reject(new Error(`Server error: ${status}`));
  }
};

// Performance measurement helpers
export const performanceHelpers = {
  // Measure function execution time
  measureExecutionTime: async (fn: () => Promise<unknown>) => {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    return {
      result,
      executionTime: end - start
    };
  },
  
  // Measure component render time
  measureRenderTime: () => {
    const start = performance.now();
    // Render component logic here
    const end = performance.now();
    return end - start;
  },
  
  // Check memory usage (Performance.memory is Chromium-only and non-standard)
  getMemoryUsage: (): PerformanceMemoryLike | null => {
    const perf = performance as Performance & { memory?: PerformanceMemoryLike };
    if ('memory' in perf) {
      return perf.memory ?? null;
    }
    return null;
  }
};

interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

// Accessibility compliance checkers
export const accessibilityCompliance = {
  // WCAG 2.1 AA compliance checks
  wcag21AA: {
    // Color contrast ratio should be at least 4.5:1 for normal text
    checkColorContrast: () => {
      // Implementation for color contrast calculation
      return true; // Placeholder
    },
    
    // All interactive elements should be keyboard accessible
    checkKeyboardAccessibility: (element: HTMLElement) => {
      return accessibilityTestHelpers.isFocusable(element);
    },
    
    // All form inputs should have associated labels
    checkFormLabels: (form: HTMLFormElement) => {
      return accessibilityTestHelpers.hasFormLabels(form);
    }
  }
};

export default {
  mockUser,
  mockToken,
  mockPasswordResetToken,
  mockApiResponses,
  testPasswords,
  testEmails,
  performanceTestData,
  accessibilityTestHelpers,
  browserTestData,
  securityTestData,
  networkTestScenarios,
  deviceTestScenarios,
  testEnvironment,
  errorSimulation,
  performanceHelpers,
  accessibilityCompliance
}; 