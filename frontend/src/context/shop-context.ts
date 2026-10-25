import { createContext, useContext } from 'react';
import type { ShopContextType } from '../types';

/**
 * The ShopContext object and its consumer hook live in this module so that
 * `ShopContext.tsx` only exports React components. This keeps React Fast
 * Refresh effective (editing the provider no longer reloads every consumer).
 */
export const ShopContext = createContext<ShopContextType | null>(null);

// Custom hook to use the ShopContext
export const useShopContext = () => {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error('useShopContext must be used within a ShopContextProvider');
  }
  return context;
};
