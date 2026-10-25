import type { Socket } from 'socket.io-client';

// Product related types
export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  image: string[];
  category: 'iPhone' | 'iPad' | 'Mac' | 'Watch' | 'AirPods' | 'Accessories';
  subCategory: 'Pro' | 'Air' | 'Mini' | 'Standard' | 'Max' | 'Ultra';
  color: string[];
  date: number;
  bestseller: boolean;
  inStock: boolean;
  stockQuantity: number;
  ratings: {
    average: number;
    count: number;
  };
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFilters {
  page?: number;
  limit?: number;
  category?: string;
  subCategory?: string;
  inStock?: boolean;
  bestseller?: boolean;
  search?: string;
}

export interface ProductResponse {
  success: boolean;
  products: Product[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalProducts: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Cart related types
export interface CartItem {
  _id: string;
  name: string;
  price: number;
  image: string[];
  quantity: number;
  size?: string;
  color?: string;
}

export interface CartData {
  [productId: string]: {
    [color: string]: number;
  };
}

// User related types
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  createdAt?: string;
  lastLogin?: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  message?: string;
  errors?: ValidationError[];
}

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: Array<{
    field: string;
    message: string;
    value: unknown;
  }>;
}

// Shop Context types
export interface ShopContextType {
  products: Product[];
  currency: string;
  delivery_fee: number;
  search: string;
  setSearch: (search: string) => void;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
  cartItems: CartData;
  addToCart: (itemId: string, color: string) => void;
  getCartCount: () => number;
  updateQuantity: (itemId: string, color: string, quantity: number) => void;
  getCartAmount: () => number;
  navigate: (path: string) => void;
  refreshProducts: () => void;
  forceRefreshProducts: () => Promise<void>;
  fetchProductsWithPagination: (filters: ProductFilters) => Promise<ProductResponse | null>;
  isLoading: boolean;
  isInitializing: boolean;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalProducts: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } | null;
  
  // Authentication related
  token: string;
  setToken: (token: string) => void;
  isLoggedIn: boolean;
  user: User | null;
  setUser: (user: User | null) => void;
  loginUser: (email: string, password: string) => Promise<boolean>;
  registerUser: (name: string, email: string, password: string) => Promise<boolean>;
  logoutUser: () => void;
  
  // Cart related
  setCartItems: (items: CartData) => void;
  loadCartFromDatabase: () => Promise<void>;
  syncCartOnAuth: () => Promise<void>;
  loadAndSyncCart: (userId: string) => Promise<boolean>;
  
  // WebSocket related
  webSocket: {
    isConnected: boolean;
    connectionError: string | null;
    connect: () => void;
    disconnect: () => void;
    joinOrderRoom: (orderId: string) => void;
    leaveOrderRoom: (orderId: string) => void;
    adminJoinOrder: (orderId: string) => void;
    adminLeaveOrder: (orderId: string) => void;
    sendTyping: (orderId: string) => void;
    sendStopTyping: (orderId: string) => void;
    socket: Socket | null;
  };
}

// Admin related types
export interface AdminUser {
  email: string;
  role: 'admin';
}

export interface AdminAuthResponse {
  success: boolean;
  token?: string;
  user?: AdminUser;
  message?: string;
}

// Form related types
export interface FormErrors {
  [key: string]: string;
}

export interface ValidationError {
  field: string;
  message: string;
  value: unknown;
}

// Delivery address captured at checkout
export interface DeliveryAddress {
  firstName: string;
  lastName: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  phone: string;
}

// Delivery address persisted on the user profile
export interface SavedAddress extends DeliveryAddress {
  _id: string;
  default?: boolean;
}

// WebSocket message payload (fields depend on the emitting event)
export interface WebSocketMessage {
  type?: string;
  orderId?: string;
  orderStatus?: string;
  paymentStatus?: string;
  message?: string;
  _id?: string;
  userId?: string | { name?: string };
  [key: string]: unknown;
}

// PayPal payment types
export interface PayPalApproveData {
  orderID: string;
}

export interface PayPalCreateOrderResponse {
  success: boolean;
  orderId?: string;
  message?: string;
  error?: string;
}

export interface PayPalCaptureResponse {
  success: boolean;
  order?: Order;
  captureDetails?: Record<string, unknown>;
  message?: string;
  error?: string;
}

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  [key: string]: unknown;
}

// Shape of errors surfaced by the PayPal SDK / backend payment layer.
// Only a subset of fields is consumed by the error-handling UI.
export interface PayPalErrorLike {
  message?: string;
  error?: string;
  stack?: string;
  details?: PayPalErrorDetail[];
}

// Order related types (for future implementation)
export interface OrderItem {
  productId: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
  color: string;
}

export interface Order {
  _id: string;
  userId: string;
  items: OrderItem[];
  amount: number;
  address: DeliveryAddress | SavedAddress;
  status: 'Order Placed' | 'Packing' | 'Shipped' | 'Out for delivery' | 'Delivered';
  paymentMethod: string;
  payment: boolean;
  date: number;
  createdAt: string;
  updatedAt: string;
}

// Payment related types
export interface PaymentData {
  amount: number;
  currency: string;
  items: OrderItem[];
  address: DeliveryAddress;
  paymentMethod: 'COD' | 'PayPal';
}

// Error types
export interface AppError {
  message: string;
  statusCode: number;
  errors?: ValidationError[];
}

// Utility types
export type LoadingState = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// Color options for products
export type ProductColor = 
  | 'Black' 
  | 'Black Titanium' 
  | 'Desert Titanium' 
  | 'Gold' 
  | 'Pink' 
  | 'Silver' 
  | 'Teal' 
  | 'Ultramarine' 
  | 'White' 
  | 'Yellow'; 