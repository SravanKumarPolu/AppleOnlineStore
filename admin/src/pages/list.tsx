import { backendUrl, currency } from "../config";
import { useCallback, useEffect, useState } from "react";
import DeleteIcon from "../assets/DeleteIcon";
import axios from "axios";
import { toast } from "react-toastify";
import { getApiErrorMessage } from "../apiTypes";

interface ListProps {
  token: string;
}

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  image: string[];
}

const List: React.FC<ListProps> = ({ token }) => {
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalProducts, setTotalProducts] = useState<number>(0);
  const [productsPerPage] = useState<number>(20); // Show 20 products per page for admin

  const fetchList = useCallback(async (page: number = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: productsPerPage.toString()
      });

      const response = await axios.get(`${backendUrl}/api/product/list?${params}`);
      if (response.data.success) {
        setList(response.data.products);

        // Update pagination info
        if (response.data.pagination) {
          setCurrentPage(response.data.pagination.currentPage);
          setTotalPages(response.data.pagination.totalPages);
          setTotalProducts(response.data.pagination.totalProducts);
        }
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Something went wrong!"));
    } finally {
      setLoading(false);
    }
  }, [productsPerPage]);

  const removeProduct = async (id: string) => {
    try {
      setDeletingId(id);
      const response = await axios.post(
        `${backendUrl}/api/product/remove`,
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        // Refresh current page, but if it's the last page and we're deleting the last item, go to previous page
        if (list.length === 1 && currentPage > 1) {
          fetchList(currentPage - 1);
        } else {
          fetchList(currentPage);
        }
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "An unexpected error occurred"));
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    fetchList(1);
  }, [fetchList]);

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchList(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      handlePageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      handlePageChange(currentPage + 1);
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 7;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 4) {
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-neutral-600">Loading products...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-1 font-bold text-neutral-900 mb-2">Product Management</h1>
          <p className="text-body text-neutral-600">Manage all products in your store</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-caption text-neutral-500">
            Showing {list.length} of {totalProducts} products
            {totalPages > 1 && (
              <span className="ml-2 text-neutral-400">
                (Page {currentPage} of {totalPages})
              </span>
            )}
          </span>
          <button
            onClick={() => fetchList(currentPage)}
            className="btn-modern btn-secondary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card-modern p-12 text-center">
          <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h3 className="text-heading-3 font-semibold text-neutral-900 mb-2">No Products Found</h3>
          <p className="text-body text-neutral-600 mb-6">Get started by adding your first product to the store.</p>
          <button className="btn-modern btn-primary">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>Add Product</span>
          </button>
        </div>
      ) : (
        <>
          <div className="card-modern overflow-hidden">
            {/* Desktop Header */}
            <div className="hidden lg:grid grid-cols-[80px_2fr_1fr_1fr_100px] items-center py-4 px-6 bg-neutral-50 border-b border-neutral-200">
              <span className="text-caption font-semibold text-neutral-600">Image</span>
              <span className="text-caption font-semibold text-neutral-600">Product Name</span>
              <span className="text-caption font-semibold text-neutral-600">Category</span>
              <span className="text-caption font-semibold text-neutral-600">Price</span>
              <span className="text-caption font-semibold text-neutral-600 text-center">Actions</span>
            </div>

            {/* Product List */}
            <div className="divide-y divide-neutral-200">
              {list.map((item) => (
                <div
                  key={item._id}
                  className="grid grid-cols-1 lg:grid-cols-[80px_2fr_1fr_1fr_100px] items-center p-4 lg:p-6 hover:bg-neutral-50 transition-smooth"
                >
                  {/* Mobile Layout */}
                  <div className="lg:hidden flex items-center gap-4 mb-4">
                    <img 
                      src={item.image[0]} 
                      alt={item.name} 
                      className="w-16 h-16 object-cover rounded-lg border border-neutral-200" 
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-neutral-900 mb-1">{item.name}</h3>
                      <p className="text-body-small text-neutral-600 mb-2">{item.category}</p>
                      <p className="text-heading-4 font-bold text-primary-600">
                        {currency}{item.price.toFixed(2)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeProduct(item._id)}
                      disabled={deletingId === item._id}
                      className="p-2 text-error-500 hover:text-error-600 hover:bg-error-50 rounded-lg transition-smooth disabled:opacity-50"
                      aria-label="Delete product"
                    >
                      {deletingId === item._id ? (
                        <div className="loading-spinner w-5 h-5"></div>
                      ) : (
                        <DeleteIcon />
                      )}
                    </button>
                  </div>

                  {/* Desktop Layout */}
                  <div className="hidden lg:flex items-center">
                    <img 
                      src={item.image[0]} 
                      alt={item.name} 
                      className="w-12 h-12 object-cover rounded-lg border border-neutral-200" 
                    />
                  </div>
                  
                  <div className="hidden lg:block">
                    <h3 className="font-semibold text-neutral-900">{item.name}</h3>
                  </div>
                  
                  <div className="hidden lg:block">
                    <span className="badge badge-info">{item.category}</span>
                  </div>
                  
                  <div className="hidden lg:block">
                    <p className="text-heading-4 font-bold text-primary-600">
                      {currency}{item.price.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="hidden lg:flex justify-center">
                    <button
                      onClick={() => removeProduct(item._id)}
                      disabled={deletingId === item._id}
                      className="p-2 text-error-500 hover:text-error-600 hover:bg-error-50 rounded-lg transition-smooth disabled:opacity-50"
                      aria-label="Delete product"
                    >
                      {deletingId === item._id ? (
                        <div className="loading-spinner w-5 h-5"></div>
                      ) : (
                        <DeleteIcon />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm border border-neutral-200 p-2">
                {/* Previous Button */}
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium text-neutral-600 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-neutral-600 disabled:hover:border-neutral-300 transition-all duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                  {getPageNumbers().map((page, index) => (
                    <div key={index}>
                      {page === '...' ? (
                        <span className="px-3 py-2 text-sm text-neutral-500">...</span>
                      ) : (
                        <button
                          onClick={() => handlePageChange(page as number)}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                            currentPage === page
                              ? 'bg-blue-600 text-white border border-blue-600 shadow-md hover:bg-blue-700 hover:border-blue-700 cursor-pointer'
                              : 'text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 hover:border-neutral-400 cursor-pointer hover:text-neutral-900'
                          }`}
                        >
                          {page}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Next Button */}
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium text-neutral-600 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-neutral-600 disabled:hover:border-neutral-300 transition-all duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default List;
