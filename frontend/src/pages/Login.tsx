import { FormEvent, useState, useEffect, useRef } from "react";
import { useShopContext } from "../context/shop-context";
import { useNavigate } from "react-router-dom";
import { usePerformanceMode } from "../hooks/usePerformanceMode";
import PasswordRecovery from "../components/PasswordRecovery";
import {
  UserIcon,
  EmailIcon,
  LockIcon,
  EyeIcon,
  CheckIcon,
  ExclamationIcon,
  ShieldIcon,
  GoogleIcon,
  FacebookIcon,
  ValidationIcon
} from "../components/icons";

const Login = () => {
  const [currentState, setCurrentState] = useState<string>("Login");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [isPageLoaded, setIsPageLoaded] = useState<boolean>(false);
  const [, setFocusedField] = useState<string>("");
  const [isFormSubmitting, ] = useState<boolean>(false);
  const [showPasswordRecovery, setShowPasswordRecovery] = useState<boolean>(false);
  const [isSocialLoading, ] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(false);
  
  // Performance optimizations
  const { reducedAnimations, particleCount } = usePerformanceMode();
  
  // Accessibility refs
  const formRef = useRef<HTMLFormElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  
  // Field validation states
  const [fieldErrors, setFieldErrors] = useState({
    name: "",
    email: "",
    password: ""
  });
  
  const { loginUser, registerUser, isLoggedIn } = useShopContext();
  const navigate = useNavigate();

  // Page load animation with performance optimization
  useEffect(() => {
    const timer = setTimeout(() => setIsPageLoaded(true), reducedAnimations ? 50 : 100);
    return () => clearTimeout(timer);
  }, [reducedAnimations]);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) {
      navigate('/');
    }
  }, [isLoggedIn, navigate]);

  // Clear error when switching between login/signup
  useEffect(() => {
    setError("");
    setSuccess("");
    setFieldErrors({ name: "", email: "", password: "" });
  }, [currentState]);

  // Password recovery handler
  const handlePasswordRecovery = async (recoveryEmail: string): Promise<boolean> => {
    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api/user/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: recoveryEmail }),
      });

      const data = await response.json();

      if (data.success) {
        return true;
      } else {
        console.error('Password recovery failed:', data.message);
        return false;
      }
    } catch (error) {
      console.error('Password recovery error:', error);
      return false;
    }
  };

  // Biometric authentication handler
  const handleBiometricAuth = async () => {
    try {
      if ('credentials' in navigator) {
        const credential = await navigator.credentials.get({
          publicKey: {
            challenge: new Uint8Array(32),
            rpId: window.location.hostname,
            userVerification: 'preferred'
          }
        });
        
        if (credential) {
          console.log('Biometric authentication successful');
        }
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
      setError('Biometric authentication not available or failed');
    }
  };

  // Real-time validation functions
  const validateName = (name: string) => {
    if (currentState !== "Sign Up") return "";
    if (name.length === 0) return "";
    if (name.length < 2) return "Name must be at least 2 characters";
    if (!/^[a-zA-Z\s]+$/.test(name)) return "Name can only contain letters and spaces";
    return "";
  };

  const validateEmail = (email: string) => {
    if (email.length === 0) return "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    return "";
  };

  const validatePasswordField = (password: string) => {
    if (currentState !== "Sign Up") return "";
    if (password.length === 0) return "";
    
    const minLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[@$!%*?&]/.test(password);
    
    if (!minLength || !hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
      return "Password must meet all requirements";
    }
    
    return "";
  };

  // Handle field changes with validation
  const handleNameChange = (value: string) => {
    setName(value);
    setFieldErrors(prev => ({ ...prev, name: validateName(value) }));
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setFieldErrors(prev => ({ ...prev, email: validateEmail(value) }));
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    setFieldErrors(prev => ({ ...prev, password: validatePasswordField(value) }));
  };

  // Password validation for signup
  const validatePassword = (password: string) => {
    const minLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[@$!%*?&]/.test(password);
    
    return {
      isValid: minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      errors: {
        minLength: !minLength,
        hasUpperCase: !hasUpperCase,
        hasLowerCase: !hasLowerCase,
        hasNumbers: !hasNumbers,
        hasSpecialChar: !hasSpecialChar
      }
    };
  };

  const onSubmitHandler = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      let success = false;
      
      if (currentState === "Login") {
        success = await loginUser(email, password);
        
        if (success && rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else if (!rememberMe) {
          localStorage.removeItem('rememberedEmail');
        }
      } else {
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
          setError("Password must be at least 8 characters and contain uppercase, lowercase, number, and special character (@$!%*?&)");
          setIsLoading(false);
          return;
        }

        if (name.trim().length < 2) {
          setError("Name must be at least 2 characters long");
          setIsLoading(false);
          return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          setError("Please enter a valid email address");
          setIsLoading(false);
          return;
        }

        success = await registerUser(name.trim(), email.toLowerCase(), password);
      }

      if (success) {
        setSuccess(currentState === "Login" ? "Login successful!" : "Account created successfully!");
        setTimeout(() => {
          navigate('/');
        }, 1000);
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Load remembered email on component mount
  useEffect(() => {
    const rememberedEmail = localStorage.getItem('rememberedEmail');
    if (rememberedEmail && currentState === "Login") {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, [currentState]);

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4 sm:p-6 lg:p-8 relative overflow-hidden"
      role="main"
      aria-label="Login and registration form"
    >
      {/* Modern Animated Background */}
      <div className="absolute inset-0">
        {/* Gradient Orbs */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-br from-indigo-400/20 to-purple-400/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-gradient-to-br from-purple-400/20 to-pink-400/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 animate-pulse-slow" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-gradient-to-br from-blue-400/15 to-indigo-400/15 rounded-full blur-2xl -translate-x-1/2 -translate-y-1/2 animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
        
        {/* Geometric Patterns */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-20 w-32 h-32 border border-indigo-300 rounded-full animate-spin" style={{ animationDuration: '20s' }}></div>
          <div className="absolute bottom-20 right-20 w-24 h-24 border border-purple-300 rounded-full animate-spin" style={{ animationDuration: '15s', animationDirection: 'reverse' }}></div>
          <div className="absolute top-1/2 left-1/4 w-16 h-16 border border-blue-300 rounded-full animate-spin" style={{ animationDuration: '25s' }}></div>
        </div>
      </div>
      
      <div className={`w-full max-w-md lg:max-w-lg xl:max-w-xl relative z-10 transition-all duration-700 ease-out ${
        isPageLoaded ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
      }`}>
        {/* Modern Header Section */}
        <div className={`text-center mb-8 lg:mb-10 xl:mb-12 transition-all duration-500 ease-out ${
          isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          {/* Modern Logo with Gradient */}
          <div className={`inline-flex items-center justify-center w-20 h-20 lg:w-24 lg:h-24 xl:w-28 xl:h-28 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl lg:rounded-4xl shadow-2xl lg:shadow-3xl mb-8 lg:mb-10 xl:mb-12 transition-all duration-300 hover:scale-110 hover:shadow-3xl hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700 ${
            isPageLoaded && !reducedAnimations ? 'animate-bounce-gentle' : ''
          }`} style={{ animationDelay: '1s' }}>
            <UserIcon 
              size="2xl" 
              className="text-white transition-transform duration-300 hover:rotate-12" 
              aria-hidden="true"
            />
          </div>
          
          {/* Modern Typography with Gradient */}
          <h1 className={`text-4xl lg:text-5xl xl:text-6xl font-black bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-6 lg:mb-8 xl:mb-10 leading-tight tracking-tight transition-all duration-500 ease-out ${
            isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`} style={{ animationDelay: '0.4s' }}>
            {currentState === "Login" ? "Welcome Back" : "Create Account"}
          </h1>
          
          <p className={`text-lg lg:text-xl xl:text-2xl text-gray-600 font-medium leading-relaxed max-w-md mx-auto transition-all duration-500 ease-out ${
            isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`} style={{ animationDelay: '0.6s' }}>
            {currentState === "Login" 
              ? "Sign in to your account to continue shopping" 
              : "Join us and start your shopping journey"
            }
          </p>
        </div>

        {/* Modern Form Card with Glassmorphism */}
        <div className={`bg-white/80 backdrop-blur-xl rounded-3xl lg:rounded-4xl shadow-2xl lg:shadow-3xl p-8 lg:p-10 xl:p-12 transition-all duration-500 ease-out ${
          isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        } hover:shadow-3xl hover:-translate-y-2 border border-white/20 relative overflow-hidden`}>
          {/* Subtle background pattern */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 via-transparent to-purple-50/30 opacity-60"></div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-200/40 to-transparent rounded-full blur-xl"></div>
          <div className="absolute bottom-0 left-0 w-28 h-28 bg-gradient-to-tr from-purple-200/30 to-transparent rounded-full blur-lg"></div>
          
          <div className="relative z-10">
            <form 
              ref={formRef}
              onSubmit={onSubmitHandler} 
              className="space-y-6 lg:space-y-8"
              aria-label={`${currentState} form`}
            >
              {/* Modern Error Message */}
              {error && (
                <div 
                  className="bg-gradient-to-r from-red-50 to-red-100 border border-red-200 text-red-800 px-6 py-4 rounded-2xl text-sm font-medium animate-fade-in relative overflow-hidden shadow-lg"
                  role="alert"
                  aria-live="polite"
                >
                  <div className="flex items-center space-x-3 relative z-10">
                    <ExclamationIcon 
                      size="md" 
                      className="text-red-600 flex-shrink-0" 
                      aria-hidden="true"
                    />
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {/* Modern Success Message */}
              {success && (
                <div 
                  className="bg-gradient-to-r from-emerald-50 to-green-100 border border-emerald-200 text-emerald-800 px-6 py-4 rounded-2xl text-sm font-medium animate-fade-in relative overflow-hidden shadow-lg"
                  role="alert"
                  aria-live="polite"
                >
                  <div className="flex items-center space-x-3 relative z-10">
                    <CheckIcon 
                      size="md" 
                      className="text-emerald-600 flex-shrink-0" 
                      aria-hidden="true"
                    />
                    <span>{success}</span>
                  </div>
                </div>
              )}

              {/* Enhanced Loading Skeleton */}
              {isFormSubmitting && !isLoading && (
                <div className="space-y-6" aria-hidden="true">
                  <div className="h-4 skeleton-line"></div>
                  <div className="skeleton-input"></div>
                  <div className="skeleton-input"></div>
                  <div className="skeleton-input"></div>
                </div>
              )}

              {/* Modern Name Field - Only for Sign Up */}
              {currentState === "Sign Up" && !isFormSubmitting && (
                <div className={`space-y-3 transition-all duration-500 ease-out ${
                  currentState === "Sign Up" ? 'opacity-100 max-h-96' : 'opacity-0 max-h-0'
                }`}>
                  <label htmlFor="name" className="block text-sm font-semibold text-gray-700">
                    Full Name
                  </label>
                  <div className="relative group">
                    <input
                      id="name"
                      type="text"
                      className={`w-full pl-14 pr-4 py-4 lg:py-5 text-base border-2 border-gray-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all duration-300 bg-white/80 backdrop-blur-sm text-gray-900 placeholder-gray-500 group-hover:border-gray-300 input-focus-enhanced ${
                        fieldErrors.name 
                          ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' 
                          : name.length > 0 && !fieldErrors.name 
                            ? 'border-emerald-300 focus:ring-emerald-500/20 focus:border-emerald-500'
                            : ''
                      }`}
                      placeholder="Enter your full name"
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onFocus={() => setFocusedField('name')}
                      onBlur={() => setFocusedField('')}
                      required
                      aria-describedby={fieldErrors.name ? "name-error" : undefined}
                      aria-invalid={!!fieldErrors.name}
                    />
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                      <UserIcon 
                        size="lg" 
                        className="text-gray-400 transition-colors duration-300 group-focus-within:text-indigo-600" 
                        aria-hidden="true"
                      />
                    </div>
                    {/* Modern validation indicator */}
                    {name.length > 0 && (
                      <div className="absolute inset-y-0 right-0 pr-5 flex items-center" aria-hidden="true">
                        {fieldErrors.name ? (
                          <ExclamationIcon 
                            size="md" 
                            className="text-red-500 error-cross"
                          />
                        ) : (
                          <CheckIcon 
                            size="md" 
                            className="text-emerald-500 success-checkmark"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {fieldErrors.name && (
                    <div id="name-error" className="text-red-600 text-sm mt-2 flex items-center space-x-2 validation-error" role="alert">
                      <ExclamationIcon 
                        size="sm" 
                        className="text-red-500" 
                        aria-hidden="true"
                      />
                      <span>{fieldErrors.name}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Modern Email Field */}
              {!isFormSubmitting && (
                <div className="space-y-3">
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700">
                    Email Address
                  </label>
                  <div className="relative group">
                    <input
                      ref={emailInputRef}
                      id="email"
                      type="email"
                      className={`w-full pl-14 pr-4 py-4 lg:py-5 text-base border-2 border-gray-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all duration-300 bg-white/80 backdrop-blur-sm text-gray-900 placeholder-gray-500 group-hover:border-gray-300 input-focus-enhanced ${
                        fieldErrors.email 
                          ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' 
                          : email.length > 0 && !fieldErrors.email 
                            ? 'border-emerald-300 focus:ring-emerald-500/20 focus:border-emerald-500'
                            : ''
                      }`}
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField('')}
                      required
                      aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      aria-invalid={!!fieldErrors.email}
                    />
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                      <EmailIcon 
                        size="lg" 
                        className="text-gray-400 transition-colors duration-300 group-focus-within:text-indigo-600" 
                        aria-hidden="true"
                      />
                    </div>
                    {/* Modern validation indicator */}
                    {email.length > 0 && (
                      <div className="absolute inset-y-0 right-0 pr-5 flex items-center" aria-hidden="true">
                        {fieldErrors.email ? (
                          <ExclamationIcon 
                            size="md" 
                            className="text-red-500 error-cross"
                          />
                        ) : (
                          <CheckIcon 
                            size="md" 
                            className="text-emerald-500 success-checkmark"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {fieldErrors.email && (
                    <div id="email-error" className="text-red-600 text-sm mt-2 flex items-center space-x-2 validation-error" role="alert">
                      <ExclamationIcon 
                        size="sm" 
                        className="text-red-500" 
                        aria-hidden="true"
                      />
                      <span>{fieldErrors.email}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Modern Password Field */}
              {!isFormSubmitting && (
                <div className="space-y-3">
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
                    Password
                  </label>
                  <div className="relative group">
                    <input
                      ref={passwordInputRef}
                      id="password"
                      type={showPassword ? "text" : "password"}
                      className={`w-full pl-14 pr-14 py-4 lg:py-5 text-base border-2 border-gray-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all duration-300 bg-white/80 backdrop-blur-sm text-gray-900 placeholder-gray-500 group-hover:border-gray-300 input-focus-enhanced ${
                        fieldErrors.password 
                          ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' 
                          : password.length > 0 && !fieldErrors.password 
                            ? 'border-emerald-300 focus:ring-emerald-500/20 focus:border-emerald-500'
                            : ''
                      }`}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      onFocus={() => setFocusedField('password')}
                      onBlur={() => setFocusedField('')}
                      required
                      minLength={8}
                      aria-describedby={fieldErrors.password ? "password-error" : undefined}
                      aria-invalid={!!fieldErrors.password}
                    />
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                      <LockIcon 
                        size="lg" 
                        className="text-gray-400 transition-colors duration-300 group-focus-within:text-indigo-600" 
                        aria-hidden="true"
                      />
                    </div>
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-5 flex items-center hover:bg-gray-50/50 rounded-r-2xl transition-all duration-300 btn-press"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      <EyeIcon 
                        size="lg" 
                        className="text-gray-400 hover:text-gray-600 transition-all duration-300" 
                        isVisible={!showPassword}
                        aria-hidden="true"
                      />
                    </button>
                    {/* Modern validation indicator - positioned to the left of password toggle */}
                    {password.length > 0 && (
                      <div className="absolute inset-y-0 right-0 pr-14 flex items-center" aria-hidden="true">
                        {fieldErrors.password ? (
                          <ExclamationIcon 
                            size="md" 
                            className="text-red-500 error-cross"
                          />
                        ) : (
                          <CheckIcon 
                            size="md" 
                            className="text-emerald-500 success-checkmark"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Modern password error message */}
                  {fieldErrors.password && (
                    <div id="password-error" className="text-red-600 text-sm mt-2 flex items-center space-x-2 validation-error" role="alert">
                      <ExclamationIcon 
                        size="sm" 
                        className="text-red-500" 
                        aria-hidden="true"
                      />
                      <span>{fieldErrors.password}</span>
                    </div>
                  )}
                  
                  {/* Modern Password Requirements - Only show for Sign Up */}
                  {currentState === "Sign Up" && password && !isFormSubmitting && (
                    <div className={`mt-6 p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-200/50 transition-all duration-300 ease-out form-transition`}>
                      <p className="text-sm font-semibold text-gray-700 mb-4">Password requirements:</p>
                      <div className="space-y-3">
                        {[
                          { key: 'minLength', label: 'At least 8 characters', test: password.length >= 8 },
                          { key: 'hasUpperCase', label: 'One uppercase letter', test: /[A-Z]/.test(password) },
                          { key: 'hasLowerCase', label: 'One lowercase letter', test: /[a-z]/.test(password) },
                          { key: 'hasNumbers', label: 'One number', test: /\d/.test(password) },
                          { key: 'hasSpecialChar', label: 'One special character (@$!%*?&)', test: /[@$!%*?&]/.test(password) }
                        ].map((requirement, index) => (
                          <div key={requirement.key} className={`flex items-center space-x-3 transition-all duration-300 ${
                            requirement.test ? 'animate-fade-in validation-success' : ''
                          }`} style={{ animationDelay: `${index * 100}ms` }}>
                            <ValidationIcon 
                              size="sm" 
                              className={`transition-all duration-300 ${requirement.test ? 'text-emerald-500' : 'text-gray-400'}`}
                              isValid={requirement.test}
                            />
                            <span className={`text-sm transition-all duration-300 ${requirement.test ? 'text-emerald-700 font-medium' : 'text-gray-600'}`}>
                              {requirement.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Modern Remember Me Checkbox - Only for Login */}
              {currentState === "Login" && !isFormSubmitting && (
                <div className="flex items-center space-x-3">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-5 h-5 text-indigo-600 border-gray-300 rounded-lg focus:ring-indigo-500 focus:ring-2"
                  />
                  <label htmlFor="remember-me" className="text-sm text-gray-700 font-medium">
                    Remember me
                  </label>
                </div>
              )}

              {/* Modern Biometric Authentication - Only for Login */}
              {currentState === "Login" && !isFormSubmitting && (
                <button
                  type="button"
                  onClick={handleBiometricAuth}
                  className="w-full py-4 lg:py-5 px-6 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-2xl hover:from-gray-700 hover:to-gray-800 transition-all duration-300 flex items-center justify-center space-x-3 font-medium shadow-lg hover:shadow-xl text-sm lg:text-base transform hover:scale-[1.02] active:scale-[0.98]"
                  aria-label="Sign in with biometric authentication"
                >
                  <ShieldIcon 
                    size="md" 
                    className="text-white" 
                    aria-hidden="true"
                  />
                  <span>Sign in with Biometrics</span>
                </button>
              )}

              {/* Modern Forgot Password & Toggle Links */}
              {!isFormSubmitting && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0 text-sm">
                  <button
                    type="button"
                    onClick={() => setShowPasswordRecovery(true)}
                    className="text-gray-600 hover:text-indigo-600 font-medium transition-all duration-300 hover:underline text-left"
                    aria-label="Forgot password? Click to reset"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentState(currentState === "Login" ? "Sign Up" : "Login")}
                    className="text-gray-600 hover:text-indigo-600 font-medium transition-all duration-300 hover:underline text-left sm:text-right"
                    aria-label={`Switch to ${currentState === "Login" ? "Sign Up" : "Login"} mode`}
                  >
                    {currentState === "Login" ? "Create account" : "Sign in instead"}
                  </button>
                </div>
              )}

              {/* Modern Submit Button with Enhanced Loading Animation */}
              <div className="pt-6 lg:pt-8">
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className={`w-full py-5 lg:py-6 px-8 text-white text-lg lg:text-xl font-bold rounded-2xl shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-offset-4 transform relative overflow-hidden btn-press ${
                    isLoading
                      ? 'bg-gray-500 cursor-not-allowed btn-loading'
                      : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700 hover:shadow-2xl active:scale-[0.98] focus:ring-indigo-500'
                  }`}
                  style={{ display: 'block', visibility: 'visible', opacity: 1 }}
                  aria-describedby={isLoading ? "loading-status" : undefined}
                >
                  {/* Enhanced Loading Background Animation */}
                  {isLoading && (
                    <div className="absolute inset-0 loading-authenticating"></div>
                  )}
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center space-x-4 relative z-10">
                      {/* Enhanced Spinner with Pulse Effect */}
                      <div className="loading-spinner-enhanced w-7 h-7 lg:w-8 lg:h-8 text-white"></div>
                      <span className="font-bold loading-text">
                        {currentState === "Login" ? "Signing in..." : "Creating account..."}
                      </span>
                    </div>
                  ) : (
                    <span className="font-bold relative z-10">
                      {currentState === "Login" ? "Sign In" : "Create Account"}
                    </span>
                  )}
                </button>
                {isLoading && (
                  <div id="loading-status" className="sr-only" aria-live="polite">
                    {currentState === "Login" ? "Signing in..." : "Creating account..."}
                  </div>
                )}
              </div>
            </form>

            {/* Modern Divider */}
            {!isFormSubmitting && (
              <div className="relative my-8 lg:my-10">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-6 bg-white text-gray-500 font-medium">Or continue with</span>
                </div>
              </div>
            )}

            {/* Modern Social Login Buttons with Enhanced Loading States */}
            {!isFormSubmitting && (
              <div className="space-y-4">
                <button 
                  className="w-full py-4 lg:py-5 px-6 bg-white border-2 border-gray-200 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 flex items-center justify-center space-x-3 text-gray-700 font-semibold shadow-lg hover:shadow-xl text-sm lg:text-base relative overflow-hidden btn-press transform hover:scale-[1.02] active:scale-[0.98]"
                  disabled={isSocialLoading}
                >
                  {/* Enhanced Loading Background for Social Buttons */}
                  {isSocialLoading && (
                    <div className="absolute inset-0 social-loading"></div>
                  )}
                  
                  {isSocialLoading ? (
                    <div className="flex items-center justify-center space-x-3 relative z-10">
                      {/* Enhanced Social Loading Spinner */}
                      <div className="loading-spinner-enhanced w-6 h-6 text-gray-600"></div>
                      <span className="text-gray-600 font-semibold loading-text">Connecting...</span>
                    </div>
                  ) : (
                    <>
                      <GoogleIcon 
                        size="lg" 
                        className="transition-transform duration-300"
                      />
                      <span>Continue with Google</span>
                    </>
                  )}
                </button>
                
                <button className="w-full py-4 lg:py-5 px-6 bg-white border-2 border-gray-200 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 flex items-center justify-center space-x-3 text-gray-700 font-semibold shadow-lg hover:shadow-xl text-sm lg:text-base btn-press transform hover:scale-[1.02] active:scale-[0.98]">
                  <FacebookIcon 
                    size="lg" 
                    className="transition-transform duration-300"
                  />
                  <span>Continue with Facebook</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Modern Footer */}
        <div className={`text-center mt-8 lg:mt-10 transition-all duration-500 ease-out ${
          isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <p className="text-sm text-gray-600 leading-relaxed font-medium">
            By continuing, you agree to our{" "}
            <a href="#" className="text-indigo-600 hover:text-indigo-700 font-semibold transition-all duration-300 hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-indigo-600 hover:text-indigo-700 font-semibold transition-all duration-300 hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
      
      {/* Modern Floating Particles */}
      {!reducedAnimations && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(particleCount)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-gradient-to-r from-indigo-400/40 to-purple-400/40 rounded-full animate-float"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${3 + Math.random() * 2}s`
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      )}
      
      {/* Password Recovery Modal */}
      <PasswordRecovery
        isOpen={showPasswordRecovery}
        onClose={() => setShowPasswordRecovery(false)}
        onRecoveryRequest={handlePasswordRecovery}
      />
    </div>
  );
};

export default Login;