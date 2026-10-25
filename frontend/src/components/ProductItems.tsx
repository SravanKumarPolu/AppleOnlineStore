import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShopContext } from '../context/shop-context';
import { motion } from 'framer-motion';

interface ProductItemsProps {
  id: string;
  image: string[];
  name: string;
  price: number;
  bestseller?: boolean;
}

const ProductItems: React.FC<ProductItemsProps> = ({ id, image, name, price, bestseller = false }) => {
  const context = useContext(ShopContext);
  const navigate = useNavigate();
  if (!context) return null;

  const { currency } = context;

  return (
    <Link
      to={`/product/${id}`}
      className="group block focus:outline-none h-full w-full"
      aria-label={`View details for ${name}`}
    >
      <motion.div 
        className="card-product group"
        whileHover={{ y: -8 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        {/* Product Image Container */}
        <div className="product-image-container">
          <motion.img
            src={image[0]}
            alt={name || 'Product image'}
            className="product-image"
            loading="lazy"
            whileHover={{ scale: 1.1 }}
            transition={{ duration: 0.7 }}
          />
          
          {/* Enhanced Overlay with quick actions */}
          <div className="product-overlay">
            <motion.div
              className="product-actions"
              initial={{ opacity: 0, y: 20 }}
              whileHover={{ opacity: 1, y: 0 }}
            >
              <div className="flex gap-3">
                <motion.button
                  className="product-action-btn"
                  whileHover={{ scale: 1.1, y: -2 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Quick view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </motion.button>
                
                <motion.button
                  className="product-action-btn"
                  whileHover={{ scale: 1.1, y: -2 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Add to wishlist"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </motion.button>
              </div>
            </motion.div>
          </div>

          {/* Enhanced Badge for new products */}
          <div className="absolute top-4 left-4">
            <span className="badge badge-primary shadow-md">
              New
            </span>
          </div>

          {/* Enhanced Bestseller Badge */}
          {bestseller && (
            <div className="absolute top-4 right-4">
              <span className="badge badge-warning shadow-md">
                Bestseller
              </span>
            </div>
          )}

          {/* Enhanced Rating stars */}
          <div className={`absolute ${bestseller ? 'top-16' : 'top-4'} right-4 flex items-center gap-2`}>
            <div className="flex">
              {[...Array(5)].map((_, i) => (
                <svg key={i} className="w-3 h-3 text-yellow-400 fill-current" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-white text-xs font-semibold bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full shadow-sm">
              4.8
            </span>
          </div>
        </div>

        {/* Enhanced Product Info */}
        <div className="p-6 space-y-4 flex-1 flex flex-col justify-between">
          {/* Enhanced Product Name */}
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors duration-300 line-clamp-2 leading-tight font-display">
            {name}
          </h3>
          
          {/* Enhanced Price with better styling */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="price-current">
                {currency}{price}
              </span>
              <span className="price-original">
                {currency}{Math.round(price * 1.2)}
              </span>
            </div>
            
            {/* Enhanced Discount badge */}
            <span className="badge badge-success">
              -20%
            </span>
          </div>

          {/* Enhanced Color options */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 font-medium">Colors:</span>
            <div className="flex gap-2">
              <div className="w-5 h-5 bg-black rounded-full border-2 border-white shadow-md ring-1 ring-gray-200 hover:scale-110 transition-transform duration-200"></div>
              <div className="w-5 h-5 bg-gray-400 rounded-full border-2 border-white shadow-md ring-1 ring-gray-200 hover:scale-110 transition-transform duration-200"></div>
              <div className="w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-md ring-1 ring-gray-200 hover:scale-110 transition-transform duration-200"></div>
            </div>
          </div>

          {/* Enhanced Quick add to cart button */}
          <motion.button
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-300 shadow-md hover:shadow-lg opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 text-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
           
            onClick={(e) => {
              e.preventDefault();
              navigate(`/product/${id}`);
              // Add to cart functionality would go here
            }}
           
          >
            Add to Cart
          </motion.button>

          {/* Enhanced Stock status */}
          <div className="flex items-center gap-2 text-sm">
            <div className="status-indicator status-in-stock"></div>
            <span className="text-green-600 font-medium">In Stock</span>
            <span className="text-gray-500">• Free Shipping</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};

export default ProductItems;
