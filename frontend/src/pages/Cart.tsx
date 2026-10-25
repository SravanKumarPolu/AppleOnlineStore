import { useState, useEffect } from "react";
import { useShopContext } from "../context/shop-context";
import { motion, AnimatePresence } from "framer-motion";
import CartTotal from "../components/CartTotal";
import Title from "../components/Title";

interface CartItem {
  _id: string;
  color: string;
  quantity: number;
}

const Cart: React.FC = () => {
  const { products, currency, cartItems, updateQuantity, navigate, isLoggedIn } = useShopContext();
  const [cartData, setCartData] = useState<CartItem[]>([]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login');
      return;
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    if (!isLoggedIn) return; // Don't process cart if not logged in
    
    const tempData = [];
    for (const itemId in cartItems) {
      for (const color in cartItems[itemId]) {
        if (cartItems[itemId][color] > 0) {
          tempData.push({
            _id: itemId,
            color: color,
            quantity: cartItems[itemId][color],
          });
        }
      }
    }
    setCartData(tempData);
  }, [cartItems, isLoggedIn]);

  // Show loading or redirect message if not logged in
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
          <motion.div 
            className="text-center py-20"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-24 h-24 mx-auto mb-6 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">Please Login</h2>
            <p className="text-gray-600 mb-8 text-lg">You need to be logged in to view your cart.</p>
            <motion.button 
              onClick={() => navigate('/login')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-4 rounded-xl font-semibold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Go to Login
            </motion.button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        {/* Page Header */}
        <motion.div 
          className="text-center mb-12 sm:mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Title text1="Your Cart" text2="Items" />
          <motion.div 
            className="w-24 h-1 bg-gradient-to-r from-blue-600 to-purple-600 mx-auto mt-4 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: 96 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
        </motion.div>

        {/* Cart Content */}
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Cart Items */}
          <motion.div 
            className="flex-1 space-y-4"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <AnimatePresence>
              {cartData.length === 0 ? (
                <motion.div 
                  className="text-center py-16"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">Your cart is empty</h3>
                  <p className="text-gray-600 mb-6">Add some products to get started!</p>
                  <motion.button
                    onClick={() => navigate('/collection')}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Continue Shopping
                  </motion.button>
                </motion.div>
              ) : (
                cartData.map((item, index) => {
                  const productData = products.find((product) => product._id === item._id);

                  return (
                    <motion.div
                      key={index}
                      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-all duration-300"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                      whileHover={{ scale: 1.02 }}
                    >
                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {/* Product Image */}
                        <motion.div 
                          className="flex-shrink-0"
                          whileHover={{ scale: 1.05 }}
                        >
                          <img
                            className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl object-cover shadow-md"
                            src={productData?.image[0]}
                            alt={productData?.name}
                          />
                        </motion.div>

                        {/* Product Details */}
                        <div className="flex flex-col flex-grow text-center sm:text-left">
                          <h3 className="font-bold text-xl sm:text-2xl text-gray-800 mb-2">
                            {productData?.name}
                          </h3>
                          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-bold text-gray-900">
                                {currency}{productData?.price}
                              </span>
                              <span className="text-lg text-gray-500 line-through">
                                {currency}{Math.round((productData?.price || 0) * 1.2)}
                              </span>
                            </div>
                            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-semibold">
                              {(() => {
                                const colorString = String(item.color);
                                const cleanedString = colorString
                                  .replace(/[\]"'\\[]/g, '')
                                  .replace(/\s*,\s*/g, ',')
                                  .trim();
                                const firstColor = cleanedString.split(',')[0].trim();
                                return firstColor || 'Unknown';
                              })()}
                            </span>
                          </div>
                        </div>

                        {/* Quantity Control */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <motion.button
                              onClick={() => updateQuantity(item._id, item.color, Math.max(1, item.quantity - 1))}
                              aria-label={`Decrease quantity of ${productData?.name ?? 'item'}`}
                              className="w-10 h-10 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg flex items-center justify-center transition-colors"
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                              </svg>
                            </motion.button>
                            
                            <input
                              onChange={(e) => {
                                const value = parseInt(e.target.value);
                                if (value > 0) {
                                  updateQuantity(item._id, item.color, value);
                                }
                              }}
                              className="w-16 h-10 text-center bg-white text-gray-700 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-semibold"
                              type="number"
                              min={1}
                              defaultValue={item.quantity}
                            />
                            
                            <motion.button
                              onClick={() => updateQuantity(item._id, item.color, item.quantity + 1)}
                              aria-label={`Increase quantity of ${productData?.name ?? 'item'}`}
                              className="w-10 h-10 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg flex items-center justify-center transition-colors"
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </motion.button>
                          </div>

                          {/* Remove Button */}
                          <motion.button
                            onClick={() => updateQuantity(item._id, item.color, 0)}
                            className="p-3 bg-red-100 hover:bg-red-200 text-red-600 rounded-xl transition-colors"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            aria-label="Remove item"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </motion.div>

          {/* Cart Summary */}
          {cartData.length > 0 && (
            <motion.div 
              className="lg:w-96"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sticky top-6">
                <CartTotal />
                
                {/* Checkout Button */}
                <motion.div 
                  className="mt-8"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.6 }}
                >
                  <motion.button
                    onClick={() => navigate('/place-order')}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg py-4 px-6 rounded-xl shadow-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Proceed to Checkout
                  </motion.button>
                </motion.div>

                {/* Continue Shopping */}
                <motion.div 
                  className="mt-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.8 }}
                >
                  <motion.button
                    onClick={() => navigate('/collection')}
                    className="w-full bg-gray-100 text-gray-700 font-semibold text-lg py-4 px-6 rounded-xl hover:bg-gray-200 transition-all duration-300"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Continue Shopping
                  </motion.button>
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Cart;