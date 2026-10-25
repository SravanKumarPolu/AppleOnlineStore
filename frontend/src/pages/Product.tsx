import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useShopContext } from "../context/shop-context";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import RelatedProducts from "../components/RelatedProducts";
import type { Product } from '../types';

const Product: React.FC = () => {
  const { productId } = useParams<{ productId: string }>();
  const context = useShopContext();

  // All hooks must run before any early return (Rules of Hooks).
  const products = context?.products;

  const [productData, setProductData] = useState<Product | null>(null);
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string>("");

  useEffect(() => {
    if (products && productId) {
      const product = products.find((item: Product) => item._id === productId);
      if (product) {
        setProductData(product);
        setSelectedImage(product.image[0]);
      }
    }
  }, [products, productId]);

  // Ensure context is available (unreachable in practice: useShopContext throws
  // when the provider is missing — kept to preserve original fallback behavior).
  if (!context) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading authentication...</p>
        </div>
      </div>
    );
  }

  const { addToCart, isLoggedIn, navigate, currency } = context;

  if (!productData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading product...</p>
        </div>
      </div>
    );
  }

  const handleColorChange = (color: string) => {
    setSelectedColor(color);
  };

  const handleAddToCart = () => {
    if (!isLoggedIn) {
      toast.error("Please login to add items to cart");
      navigate('/login');
      return;
    }
    
    if (!selectedColor) {
      toast.error("Please select a color");
      return;
    }
    
    addToCart(productData._id, selectedColor);
  };

  return productData ? (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        <motion.div 
          className="flex flex-col lg:flex-row gap-8 lg:gap-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Image Section */}
          <motion.div 
            className="flex-1"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              {/* Thumbnail Images */}
              <div className="flex sm:flex-col gap-3 sm:gap-4 overflow-x-auto sm:overflow-y-auto sm:w-24 lg:w-28">
                {productData.image.map((img, index) => (
                  <motion.img
                    key={index}
                    src={img}
                    alt={`Thumbnail ${index}`}
                    className={`cursor-pointer rounded-xl shadow-md w-20 sm:w-full flex-shrink-0 transition-all duration-300 hover:shadow-lg ${
                      selectedImage === img ? "ring-2 ring-blue-500 shadow-lg" : "hover:scale-105"
                    }`}
                    onClick={() => setSelectedImage(img)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  />
                ))}
              </div>

              {/* Main Image */}
              <motion.div 
                className="flex-1 flex items-center justify-center bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-200"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <motion.img
                  src={selectedImage}
                  alt={productData.name}
                  className="w-full h-auto max-h-[600px] object-contain p-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  key={selectedImage}
                />
              </motion.div>
            </div>
          </motion.div>

          {/* Product Details Section */}
          <motion.div 
            className="flex-1 flex flex-col justify-start space-y-6"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            {/* Product Title */}
            <motion.h1 
              className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-800 leading-tight"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
            >
              {productData.name}
            </motion.h1>

            {/* Rating */}
            <motion.div 
              className="flex items-center gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            >
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, index) => (
                  <svg key={index} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <span className="text-gray-600 font-medium">(111 reviews)</span>
            </motion.div>

            {/* Price */}
            <motion.div 
              className="flex items-center gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.0 }}
            >
              <span className="text-3xl sm:text-4xl font-bold text-gray-900">
                {currency}{productData.price}
              </span>
              <span className="text-xl text-gray-500 line-through">
                {currency}{Math.round(productData.price * 1.2)}
              </span>
              <span className="bg-green-100 text-green-800 text-sm font-semibold px-3 py-1 rounded-full">
                -20% OFF
              </span>
            </motion.div>

            {/* Description */}
            <motion.p 
              className="text-lg text-gray-700 leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.2 }}
            >
              {productData.description}
            </motion.p>

            {/* Category Info */}
            <motion.div 
              className="bg-gray-50 rounded-xl p-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.4 }}
            >
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium text-gray-800">Category:</span>
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                  {productData.category}
                </span>
                <span className="text-gray-400">/</span>
                <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs font-medium">
                  {productData.subCategory}
                </span>
              </div>
            </motion.div>

            {/* Color Selection */}
            <motion.div 
              className="space-y-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.6 }}
            >
              <label className="text-lg font-semibold text-gray-800">
                Select Color:
              </label>
              <div className="flex flex-wrap gap-3">
                {productData.color && productData.color.length > 0 ? (
                  (() => {
                    let colorString = '';
                    
                    if (Array.isArray(productData.color)) {
                      colorString = productData.color.join(',');
                    } else {
                      colorString = String(productData.color);
                    }
                    
                    const cleanedString = colorString
                      .replace(/[\]"'\\[]/g, '')
                      .replace(/\s*,\s*/g, ',')
                      .trim();
                    
                    const colors = cleanedString
                      .split(',')
                      .map((color: string) => color.trim())
                      .filter((color: string) => color.length > 0);
                    
                    return colors.map((color: string, index: number) => (
                      <motion.button
                        key={index}
                        onClick={() => handleColorChange(color)}
                        className={`px-6 py-3 border-2 rounded-xl font-medium transition-all duration-300 ${
                          selectedColor === color
                            ? "bg-blue-600 text-white border-blue-600 shadow-lg"
                            : "bg-white text-gray-700 hover:bg-gray-50 border-gray-300 hover:border-blue-400"
                        }`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {color}
                      </motion.button>
                    ));
                  })()
                ) : (
                  <p className="text-gray-500">No colors available</p>
                )}
              </div>
            </motion.div>

            {/* Date Added */}
            <motion.div 
              className="text-sm text-gray-600"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.8 }}
            >
              <span className="font-medium text-gray-800">Date Added:</span>{" "}
              {new Date(productData.date).toLocaleDateString()}
            </motion.div>

            {/* Add to Cart Button */}
            <motion.div 
              className="space-y-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 2.0 }}
            >
              {!isLoggedIn ? (
                <div className="space-y-4">
                  <motion.div 
                    className="bg-yellow-50 border border-yellow-200 rounded-xl p-4"
                    whileHover={{ scale: 1.02 }}
                  >
                    <div className="flex items-center gap-3">
                      <svg className="w-6 h-6 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <p className="text-yellow-800 font-medium">Please login to add items to your cart</p>
                    </div>
                  </motion.div>
                  <motion.button
                    onClick={() => navigate('/login')}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-semibold py-4 px-8 rounded-xl shadow-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Login to Shop
                  </motion.button>
                </div>
              ) : (
                <motion.button
                  onClick={handleAddToCart}
                  className={`w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-semibold py-4 px-8 rounded-xl shadow-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300 ${
                    !selectedColor ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  disabled={!selectedColor}
                  whileHover={selectedColor ? { scale: 1.02 } : {}}
                  whileTap={selectedColor ? { scale: 0.98 } : {}}
                >
                  {selectedColor ? "Add to Cart" : "Select a Color First"}
                </motion.button>
              )}
            </motion.div>

            {/* Product Benefits */}
            <motion.div 
              className="bg-gray-50 rounded-xl p-6 space-y-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 2.2 }}
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-700">100% Original product</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Cash on delivery available</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Easy return policy</span>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Description and Reviews Tabs */}
        <motion.div 
          className="mt-16 sm:mt-20"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
        >
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            <div className="flex border-b border-gray-200">
              <button className="flex-1 px-6 py-4 text-left font-semibold text-gray-800 bg-blue-50 border-b-2 border-blue-600">
                Description
              </button>
              <button className="flex-1 px-6 py-4 text-left font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition-colors">
                Reviews (111)
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-700 leading-relaxed">
                {productData.description}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Related Products */}
        <motion.div 
          className="mt-16 sm:mt-20"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <RelatedProducts category={productData.category} subCategory={productData.subCategory} />
        </motion.div>
      </div>
    </div>
  ) : (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12H3" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Product not found</h3>
        <p className="text-gray-600">The product you're looking for doesn't exist.</p>
      </div>
    </div>
  );
};

export default Product;
