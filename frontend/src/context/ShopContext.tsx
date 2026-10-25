import React, { ReactNode, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShopContextType,
  WebSocketMessage,
} from "../types";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { useProducts } from "../hooks/useProducts";
import { useWebSocket } from "../hooks/useWebSocket";
import { ShopContext } from "./shop-context";

interface ShopContextProviderProps {
  children: ReactNode;
}

const ShopContextProvider: React.FC<ShopContextProviderProps> = ({ children }) => {
  const currency = "$";
  const delivery_fee = 10;
  const navigate = useNavigate();
  
  // State management
  const [search, setSearch] = useState<string>('');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Custom hooks for separated concerns
  const auth = useAuth();
  const products = useProducts(auth.token);
  const cart = useCart(auth.token, auth.user?.id);

  // Stable (useCallback-backed) functions used inside the effects below.
  // Destructured so the dependency arrays list the actual functions rather
  // than the whole hook objects, whose identity changes every render.
  const { fetchProducts } = products;
  const { syncCartOnAuth, setCartItems } = cart;

  // WebSocket handlers
  const handleOrderUpdate = (data: WebSocketMessage) => {
    console.log('📦 Order update in context:', data);
    // Refresh orders if user is on orders page
    // This will be handled by individual components
  };

  const handleNewOrder = (data: WebSocketMessage) => {
    console.log('🆕 New order in context:', data);
    // Handle new order notification
  };

  const handlePaymentUpdate = (data: WebSocketMessage) => {
    console.log('💳 Payment update in context:', data);
    // Handle payment status updates
  };

  const handleShippingUpdate = (data: WebSocketMessage) => {
    console.log('🚚 Shipping update in context:', data);
    // Handle shipping status updates
  };

  // WebSocket hook
  const webSocket = useWebSocket({
    token: auth.token,
    userId: auth.user?.id,
    userRole: auth.user?.role,
    onOrderUpdate: handleOrderUpdate,
    onNewOrder: handleNewOrder,
    onPaymentUpdate: handlePaymentUpdate,
    onShippingUpdate: handleShippingUpdate
  });

  // Navigation helper
  const navigateTo = (path: string) => {
    navigate(path);
  };

  // Initialize the app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Fetch products first
        await fetchProducts();

        // If user is authenticated, sync cart
        if (auth.isLoggedIn && auth.user?.id) {
          await syncCartOnAuth();
        } else {
          // Load cart from localStorage for non-authenticated users
          const localCart = localStorage.getItem('cartItems');
          if (localCart) {
            try {
              const parsedCart = JSON.parse(localCart);
              setCartItems(parsedCart);
            } catch (error) {
              console.error('Error parsing localStorage cart:', error);
              setCartItems({});
            }
          }
        }
      } catch (error) {
        console.error('Error initializing app:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, [auth.isLoggedIn, auth.user?.id, fetchProducts, syncCartOnAuth, setCartItems]);

  // Sync cart when user authentication status changes
  useEffect(() => {
    if (auth.isLoggedIn && auth.user?.id && !isInitializing) {
      syncCartOnAuth();
    }
  }, [auth.isLoggedIn, auth.user?.id, isInitializing, syncCartOnAuth]);

  // Enhanced getCartAmount that uses products
  const getCartAmount = () => {
    return cart.getCartAmount(products.products);
  };

  // Load and sync cart helper function
  const loadAndSyncCart = async (): Promise<boolean> => {
    try {
      await cart.loadCartFromDatabase();
      return true;
    } catch (error) {
      console.error('Error loading and syncing cart:', error);
      return false;
    }
  };

  const value: ShopContextType = {
    products: products.products,
    currency,
    delivery_fee,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    cartItems: cart.cartItems,
    addToCart: cart.addToCart,
    getCartCount: cart.getCartCount,
    updateQuantity: cart.updateQuantity,
    getCartAmount,
    navigate: navigateTo,
    refreshProducts: products.refreshProducts,
    forceRefreshProducts: products.forceRefreshProducts,
    fetchProductsWithPagination: products.fetchProductsWithPagination,
    isLoading: products.isLoading || auth.isLoading,
    isInitializing,
    pagination: products.pagination,
    
    // Authentication related
    token: auth.token,
    setToken: auth.setToken,
    isLoggedIn: auth.isLoggedIn,
    user: auth.user,
    // Exposed so a page can adopt a server-returned user (e.g. the profile
    // update response) without re-fetching the whole session.
    setUser: auth.setUser,
    loginUser: auth.loginUser,
    registerUser: auth.registerUser,
    logoutUser: auth.logoutUser,
    
    // Cart related
    setCartItems: cart.setCartItems,
    loadCartFromDatabase: cart.loadCartFromDatabase,
    syncCartOnAuth: cart.syncCartOnAuth,
    loadAndSyncCart,
    
    // WebSocket related
    webSocket
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
};

export default ShopContextProvider;
