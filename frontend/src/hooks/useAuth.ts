import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { User, AuthResponse } from '../types';

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

export const useAuth = () => {
  const navigate = useNavigate();
  const [token, setToken] = useState<string>(localStorage.getItem('token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Computed value for login status
  const isLoggedIn = token !== '';

  // Sync token with localStorage
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  // Login user
  const loginUser = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await fetch(`${backendUrl}/api/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data: AuthResponse = await response.json();

      if (data.success && data.token && data.user) {
        setToken(data.token);
        setUser(data.user);
        toast.success('Login successful!');
        return true;
      } else {
        toast.error(data.message || 'Login failed');
        return false;
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Login failed. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Register user
  const registerUser = useCallback(async (name: string, email: string, password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await fetch(`${backendUrl}/api/user/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, password }),
      });

      const data: AuthResponse = await response.json();

      if (data.success && data.token && data.user) {
        setToken(data.token);
        setUser(data.user);
        toast.success('Registration successful!');
        return true;
      } else {
        toast.error(data.message || 'Registration failed');
        return false;
      }
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Registration failed. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Logout user
  const logoutUser = useCallback(() => {
    setToken('');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('cartItems');
    toast.success('Logged out successfully');
    navigate('/login');
  }, [navigate]);

  // Fetch user profile
  const fetchUserProfile = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`${backendUrl}/api/user/profile`, {
        headers: {
          'token': token,
        },
      });

      const data = await response.json();

      if (data.success && data.user) {
        setUser(data.user);
      } else if (response.status === 401) {
        // Token expired
        setToken('');
        setUser(null);
        toast.error('Session expired. Please login again.');
        navigate('/login');
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  }, [token, navigate]);

  // Initialize auth on mount
  useEffect(() => {
    if (token && !user) {
      fetchUserProfile();
    }
  }, [token, user, fetchUserProfile]);

  return {
    token,
    setToken,
    user,
    setUser,
    isLoggedIn,
    isLoading,
    loginUser,
    registerUser,
    logoutUser,
    fetchUserProfile,
  };
}; 