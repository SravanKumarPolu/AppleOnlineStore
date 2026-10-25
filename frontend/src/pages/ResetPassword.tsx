import { FormEvent, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPageLoaded, setIsPageLoaded] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      toast.error("Invalid reset link. Please request a new password reset.");
      navigate('/login');
      return;
    }

    const timer = setTimeout(() => setIsPageLoaded(true), 100);
    return () => clearTimeout(timer);
  }, [token, navigate]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      // Validate passwords match
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match");
        setIsLoading(false);
        return;
      }

      // Validate password strength
      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        setError("Password must be at least 8 characters and contain uppercase, lowercase, number, and special character (@$!%*?&)");
        setIsLoading(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api/user/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          token: token,
          newPassword: newPassword 
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        toast.success("Password reset successfully!");
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } else {
        setError(data.message || "Failed to reset password");
      }
    } catch (error) {
      console.error('Password reset error:', error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-100/50 flex items-center justify-center p-4 sm:p-6 lg:p-8 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/20 via-transparent to-transparent"></div>
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 animate-pulse-slow"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-200/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 animate-pulse-slow" style={{ animationDelay: '1s' }}></div>
      
      <div className={`w-full max-w-md lg:max-w-lg xl:max-w-xl relative z-10 transition-all duration-700 ease-out ${
        isPageLoaded ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
      }`}>
        {/* Header Section */}
        <div className={`text-center mb-8 lg:mb-10 xl:mb-12 transition-all duration-500 ease-out ${
          isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          {/* Logo */}
          <div className={`inline-flex items-center justify-center w-16 h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl lg:rounded-3xl shadow-xl lg:shadow-2xl mb-6 lg:mb-8 xl:mb-10 transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:rotate-3 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-900 ${
            isPageLoaded ? 'animate-bounce-gentle' : ''
          }`} style={{ animationDelay: '1s' }}>
            <svg className="w-8 h-8 lg:w-10 lg:h-10 xl:w-12 xl:h-12 text-white transition-transform duration-300 hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          
          {/* Title */}
          <h1 className={`text-3xl lg:text-4xl xl:text-5xl font-black text-gray-900 mb-4 lg:mb-6 xl:mb-8 leading-tight tracking-tight transition-all duration-500 ease-out ${
            isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`} style={{ animationDelay: '0.4s' }}>
            Reset Password
          </h1>
          
          <p className={`text-base lg:text-lg xl:text-xl text-gray-600 font-semibold leading-relaxed max-w-md mx-auto transition-all duration-500 ease-out ${
            isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`} style={{ animationDelay: '0.6s' }}>
            Enter your new password below
          </p>
        </div>

        {/* Form Card */}
        <div className={`bg-white/90 backdrop-blur-md rounded-3xl lg:rounded-4xl shadow-2xl lg:shadow-3xl p-6 lg:p-8 xl:p-10 transition-all duration-500 ease-out ${
          isPageLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        } hover:shadow-3xl hover:-translate-y-1 hover:shadow-blue-100/50 border border-white/30`}>
          
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Password Reset Successful!</h3>
              <p className="text-gray-600 mb-6">
                Your password has been reset successfully. You will be redirected to the login page shortly.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
              >
                Go to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 lg:space-y-8 xl:space-y-10">
              {/* Error Message */}
              {error && (
                <div className="bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-200 text-red-900 px-4 py-3 rounded-2xl text-sm font-bold animate-fade-in relative overflow-hidden shadow-lg">
                  <div className="flex items-center space-x-3 relative z-10">
                    <svg className="w-5 h-5 text-red-600 flex-shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{error}</span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-red-200/30 via-red-100/40 to-red-200/30 animate-pulse-slow"></div>
                </div>
              )}

              {/* New Password Field */}
              <div className="space-y-3">
                <label htmlFor="newPassword" className="block text-sm lg:text-base xl:text-lg font-bold text-gray-900 transition-colors duration-200 hover:text-blue-700">
                  New Password
                </label>
                <div className="relative group">
                  <input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    className="w-full pl-12 pr-12 py-3 lg:py-4 xl:py-5 text-sm lg:text-base xl:text-lg border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all duration-300 bg-white/60 backdrop-blur-sm text-gray-900 placeholder-gray-500 group-hover:border-blue-400 group-hover:shadow-lg group-hover:bg-white/90 border-gray-300 focus:ring-blue-500/20"
                    placeholder="Enter your new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-transform duration-200 group-focus-within:scale-110">
                    <svg className="h-5 w-5 lg:h-6 lg:w-6 xl:h-7 xl:w-7 text-gray-500 transition-colors duration-200 group-focus-within:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-4 flex items-center hover:bg-gray-50/80 rounded-r-2xl transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-inner"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <svg className="h-5 w-5 lg:h-6 lg:w-6 xl:h-7 xl:w-7 text-gray-500 hover:text-gray-700 transition-all duration-200 hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      {showPassword ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268-2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* Confirm Password Field */}
              <div className="space-y-3">
                <label htmlFor="confirmPassword" className="block text-sm lg:text-base xl:text-lg font-bold text-gray-900 transition-colors duration-200 hover:text-blue-700">
                  Confirm New Password
                </label>
                <div className="relative group">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    className="w-full pl-12 pr-12 py-3 lg:py-4 xl:py-5 text-sm lg:text-base xl:text-lg border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all duration-300 bg-white/60 backdrop-blur-sm text-gray-900 placeholder-gray-500 group-hover:border-blue-400 group-hover:shadow-lg group-hover:bg-white/90 border-gray-300 focus:ring-blue-500/20"
                    placeholder="Confirm your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-transform duration-200 group-focus-within:scale-110">
                    <svg className="h-5 w-5 lg:h-6 lg:w-6 xl:h-7 xl:w-7 text-gray-500 transition-colors duration-200 group-focus-within:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-4 flex items-center hover:bg-gray-50/80 rounded-r-2xl transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-inner"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    <svg className="h-5 w-5 lg:h-6 lg:w-6 xl:h-7 xl:w-7 text-gray-500 hover:text-gray-700 transition-all duration-200 hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      {showConfirmPassword ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268-2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* Password Requirements */}
              {newPassword && (
                <div className="mt-4 p-4 bg-gradient-to-br from-gray-50/90 to-blue-50/90 backdrop-blur-sm rounded-2xl border-2 border-gray-200/60 transition-all duration-500 ease-out animate-slide-up hover:shadow-lg hover:border-blue-200 hover:from-blue-50/95 hover:to-indigo-50/95">
                  <p className="text-sm lg:text-base xl:text-lg font-bold text-gray-900 mb-4">Password requirements:</p>
                  <div className="space-y-3">
                    {[
                      { key: 'minLength', label: 'At least 8 characters', test: newPassword.length >= 8 },
                      { key: 'hasUpperCase', label: 'One uppercase letter', test: /[A-Z]/.test(newPassword) },
                      { key: 'hasLowerCase', label: 'One lowercase letter', test: /[a-z]/.test(newPassword) },
                      { key: 'hasNumbers', label: 'One number', test: /\d/.test(newPassword) },
                      { key: 'hasSpecialChar', label: 'One special character (@$!%*?&)', test: /[@$!%*?&]/.test(newPassword) }
                    ].map((requirement, index) => (
                      <div key={requirement.key} className={`flex items-center space-x-3 transition-all duration-300 ease-out hover:scale-105 ${
                        requirement.test ? 'animate-fade-in' : ''
                      }`} style={{ animationDelay: `${index * 100}ms` }}>
                        <svg 
                          className={`w-4 h-4 transition-all duration-300 ${requirement.test ? 'text-green-600 scale-110' : 'text-gray-500'}`} 
                          fill="currentColor" 
                          viewBox="0 0 20 20"
                        >
                          {requirement.test ? (
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          )}
                        </svg>
                        <span className={`text-sm lg:text-base transition-all duration-300 ${requirement.test ? 'text-green-800 font-bold' : 'text-gray-700 font-semibold'}`}>
                          {requirement.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-6 lg:pt-8 xl:pt-10">
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className={`w-full py-4 lg:py-5 xl:py-6 px-8 text-white text-base lg:text-lg xl:text-xl font-bold rounded-2xl shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-offset-4 transform ${
                    isLoading
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 cursor-not-allowed opacity-75'
                      : 'bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 hover:from-blue-700 hover:via-blue-800 hover:to-indigo-800 hover:shadow-2xl hover:scale-105 active:scale-95 focus:ring-blue-500/50'
                  }`}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center space-x-3">
                      <div className="w-5 h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7 border-3 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
                      <span className="font-bold animate-pulse">Resetting Password...</span>
                    </div>
                  ) : (
                    <span className="font-bold">Reset Password</span>
                  )}
                </button>
              </div>

              {/* Back to Login */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="text-blue-700 hover:text-blue-800 font-bold transition-all duration-200 hover:underline hover:scale-105 active:scale-95 hover:bg-blue-50/80 px-3 py-2 rounded-xl hover:shadow-md"
                >
                  Back to Login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword; 