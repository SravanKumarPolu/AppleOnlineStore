import { useState, useEffect } from 'react';

interface SubCategory {
  _id: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
}

interface Category {
  _id: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  subCategories: SubCategory[];
}

interface CategoriesResponse {
  success: boolean;
  categories: Category[];
}

const useCategories = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || "http://localhost:3001"}/api/category/list`);
      const data: CategoriesResponse = await response.json();
      
      if (data.success) {
        setCategories(data.categories);
      } else {
        setError('Failed to fetch categories');
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
      setError('Failed to fetch categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const refreshCategories = () => {
    fetchCategories();
  };

  return {
    categories,
    loading,
    error,
    refreshCategories
  };
};

export default useCategories; 