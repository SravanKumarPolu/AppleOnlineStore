import { useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Product, ProductResponse, ProductFilters } from '../types';
import { getErrorMessage } from '../utils/errorUtils';

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

export const useProducts = (token: string) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pagination, setPagination] = useState<{
    currentPage: number;
    totalPages: number;
    totalProducts: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } | null>(null);

  // Fetch products from backend with optional pagination
  const fetchProducts = useCallback(async (filters?: ProductFilters) => {
    try {
      setIsLoading(true);
      
      // Build query parameters
      const params = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, value.toString());
          }
        });
      }
      
      // If no limit is specified, fetch all products (use a large limit)
      if (!filters?.limit) {
        params.append('limit', '1000'); // Large limit to get all products
      }
      
      const response = await fetch(`${backendUrl}/api/product/list?${params}`, {
        headers: token ? { 'token': token } : {},
      });
      
      const data: ProductResponse = await response.json();
      
      if (data.success) {
        console.log("📦 Fetched products:", data.products.map(p => ({
          name: p.name,
          inStock: p.inStock,
          stockQuantity: p.stockQuantity
        })));
        setProducts(data.products);
        
        // Update pagination info if available
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        toast.error("Failed to fetch products");
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error(getErrorMessage(error, 'Error fetching products'));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Fetch products with pagination
  const fetchProductsWithPagination = useCallback(async (filters: ProductFilters) => {
    try {
      setIsLoading(true);
      
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
      
      const response = await fetch(`${backendUrl}/api/product/list?${params}`, {
        headers: token ? { 'token': token } : {},
      });
      
      const data: ProductResponse = await response.json();
      
      if (data.success) {
        setProducts(data.products);
        if (data.pagination) {
          setPagination(data.pagination);
        }
        return data;
      } else {
        toast.error("Failed to fetch products");
        return null;
      }
    } catch (error) {
      console.error('Error fetching products with pagination:', error);
      toast.error(getErrorMessage(error, 'Error fetching products'));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Force refresh products (clears cache)
  const forceRefreshProducts = useCallback(async () => {
    console.log("🔄 Force refreshing products...");
    await fetchProducts();
    toast.info("Products refreshed!");
  }, [fetchProducts]);

  // Refresh products function
  const refreshProducts = useCallback(() => {
    fetchProducts();
  }, [fetchProducts]);

  return {
    products,
    setProducts,
    isLoading,
    pagination,
    fetchProducts,
    fetchProductsWithPagination,
    refreshProducts,
    forceRefreshProducts,
  };
}; 