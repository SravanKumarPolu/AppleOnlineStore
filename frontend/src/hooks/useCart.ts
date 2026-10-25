import { useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { CartData, Product } from '../types';

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

export const useCart = (token: string, userId: string | undefined) => {
  const [cartItems, setCartItems] = useState<CartData>({});

  // Add item to cart
  const addToCart = useCallback(async (itemId: string, color: string) => {
    if (!color) {
      toast.error('Please select a color');
      return;
    }

    const cartData = structuredClone(cartItems);

    if (cartData[itemId]) {
      if (cartData[itemId][color]) {
        cartData[itemId][color] += 1;
      } else {
        cartData[itemId][color] = 1;
      }
    } else {
      cartData[itemId] = {};
      cartData[itemId][color] = 1;
    }

    setCartItems(cartData);
    toast.success('Added to cart');

    // Sync with backend if user is logged in
    if (token && userId) {
      try {
        await fetch(`${backendUrl}/api/cart/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': token,
          },
          body: JSON.stringify({
            userId,
            itemId,
            color,
            quantity: 1,
          }),
        });
      } catch (error) {
        console.error('Error syncing cart with backend:', error);
      }
    } else {
      // Save to localStorage for non-logged-in users
      localStorage.setItem('cartItems', JSON.stringify(cartData));
    }
  }, [cartItems, token, userId]);

  // Update quantity in cart
  const updateQuantity = useCallback(async (itemId: string, color: string, quantity: number) => {
    const cartData = structuredClone(cartItems);

    if (quantity <= 0) {
      // Remove item if quantity is 0 or less
      if (cartData[itemId] && cartData[itemId][color]) {
        delete cartData[itemId][color];
        
        // Remove the product entirely if no colors left
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      }
    } else {
      // Update quantity
      if (!cartData[itemId]) {
        cartData[itemId] = {};
      }
      cartData[itemId][color] = quantity;
    }

    setCartItems(cartData);

    // Sync with backend if user is logged in
    if (token && userId) {
      try {
        await fetch(`${backendUrl}/api/cart/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': token,
          },
          body: JSON.stringify({
            userId,
            itemId,
            color,
            quantity,
          }),
        });
      } catch (error) {
        console.error('Error syncing cart with backend:', error);
      }
    } else {
      // Save to localStorage for non-logged-in users
      localStorage.setItem('cartItems', JSON.stringify(cartData));
    }
  }, [cartItems, token, userId]);

  // Get total cart count
  const getCartCount = useCallback(() => {
    let totalCount = 0;
    for (const items in cartItems) {
      for (const item in cartItems[items]) {
        try {
          if (cartItems[items][item] > 0) {
            totalCount += cartItems[items][item];
          }
        } catch (error) {
          console.error('Error calculating cart count:', error);
        }
      }
    }
    return totalCount;
  }, [cartItems]);

  // Get total cart amount
  const getCartAmount = useCallback((products: Product[]) => {
    let totalAmount = 0;
    for (const items in cartItems) {
      const itemInfo = products.find((product) => product._id === items);
      for (const item in cartItems[items]) {
        try {
          if (cartItems[items][item] > 0) {
            // Skip cart entries whose product is no longer in the catalog
            // (previously this crashed on undefined and was swallowed by
            // the try/catch below; behavior for the total is unchanged).
            if (itemInfo) {
              totalAmount += itemInfo.price * cartItems[items][item];
            }
          }
        } catch (error) {
          console.error('Error calculating cart amount:', error);
        }
      }
    }
    return totalAmount;
  }, [cartItems]);

  // Load cart from database
  const loadCartFromDatabase = useCallback(async () => {
    if (!token || !userId) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/cart/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (data.success) {
        const dbCartData = data.cartData || {};
        console.log("📦 Loaded cart from database:", dbCartData);
        setCartItems(dbCartData);
      } else {
        console.error("❌ Failed to load cart from database:", data.message);
      }
    } catch (error) {
      console.error("❌ Error loading cart from database:", error);
    }
  }, [token, userId]);

  // Sync local cart to database
  const syncLocalCartToDatabase = useCallback(async (cartData: CartData) => {
    if (!token || !userId) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/cart/sync-local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token,
        },
        body: JSON.stringify({
          userId,
          cartData,
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        console.log("✅ Local cart synced to database");
      }
    } catch (error) {
      console.error("❌ Error syncing local cart to database:", error);
    }
  }, [token, userId]);

  // Sync cart on authentication
  const syncCartOnAuth = useCallback(async () => {
    if (!token || !userId) {
      console.log("🔄 Skipping cart sync - user not authenticated");
      return;
    }
    
    try {
      console.log("🔄 Starting cart sync for user:", userId);
      
      // First, try to load cart from database
      const response = await fetch(`${backendUrl}/api/cart/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (data.success) {
        const dbCartData = data.cartData || {};
        console.log("📦 Database cart data:", dbCartData);
        
        // If database has cart data, use it
        if (Object.keys(dbCartData).length > 0) {
          console.log("✅ Using database cart data");
          setCartItems(dbCartData);
        } else {
          console.log("📭 Database cart is empty, checking localStorage");
          
          // If database is empty but localStorage has data, sync localStorage to database
          const localCart = localStorage.getItem('cartItems');
          if (localCart) {
            try {
              const parsedLocalCart = JSON.parse(localCart);
              console.log("📱 localStorage cart:", parsedLocalCart);
              
              if (Object.keys(parsedLocalCart).length > 0) {
                console.log("📤 Syncing localStorage cart to database");
                await syncLocalCartToDatabase(parsedLocalCart);
                setCartItems(parsedLocalCart);
              } else {
                console.log("📭 Both database and localStorage are empty");
                setCartItems({});
              }
            } catch (error) {
              console.error("❌ Error parsing localStorage cart:", error);
              setCartItems({});
            }
          } else {
            console.log("📭 localStorage cart is empty");
            setCartItems({});
          }
        }
        
        // Clear localStorage after syncing
        localStorage.removeItem('cartItems');
      } else {
        console.error("❌ Failed to load cart from database:", data.message);
      }
    } catch (error) {
      console.error("❌ Error during cart sync:", error);
    }
  }, [token, userId, syncLocalCartToDatabase]);

  return {
    cartItems,
    setCartItems,
    addToCart,
    updateQuantity,
    getCartCount,
    getCartAmount,
    loadCartFromDatabase,
    syncCartOnAuth,
    syncLocalCartToDatabase,
  };
}; 