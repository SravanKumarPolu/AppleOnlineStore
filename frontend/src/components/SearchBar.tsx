import { useEffect, useState } from 'react';
import { assets } from '../assets/assets';
import { useShopContext } from '../context/shop-context';
import { useDebounce } from '../hooks/useDebounce';
import { motion, AnimatePresence } from 'framer-motion';

const SearchBar = () => {
  const { search, setSearch, showSearch, setShowSearch } = useShopContext();
  const [localSearch, setLocalSearch] = useState(search);
  const [isFocused, setIsFocused] = useState(false);
  const debouncedSearch = useDebounce(localSearch, 300); // 300ms delay

  // Update the context search when debounced value changes
  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch, setSearch]);

  // Sync local search with context search
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  const handleClose = () => {
    setShowSearch(false);
    setLocalSearch('');
    setSearch('');
  };

  return (
    <AnimatePresence>
      {showSearch && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="relative bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 shadow-sm"
        >
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600"></div>
          </div>

          <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              {/* Search Input Container */}
              <motion.div
                className={`relative flex-1 max-w-2xl transition-all duration-300 ${
                  isFocused ? 'scale-105' : 'scale-100'
                }`}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <div className={`relative rounded-xl sm:rounded-2xl shadow-lg transition-all duration-300 ${
                  isFocused 
                    ? 'shadow-xl ring-2 ring-blue-500 ring-opacity-50' 
                    : 'shadow-md'
                }`}>
                  {/* Search Icon */}
                  <div className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2">
                    <motion.div
                      animate={{ scale: isFocused ? 1.1 : 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <img 
                        className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" 
                        src={assets.search_icon} 
                        alt="Search icon" 
                      />
                    </motion.div>
                  </div>

                  {/* Input Field */}
                  <input
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    className="w-full pl-10 sm:pl-12 pr-12 sm:pr-16 py-3 sm:py-4 bg-white rounded-xl sm:rounded-2xl text-base sm:text-lg placeholder-gray-400 focus:outline-none transition-all duration-300"
                    type="text"
                    placeholder="Search for products, categories, or brands..."
                    aria-label="Search products"
                    autoFocus
                  />

                  {/* Clear Button */}
                  {localSearch && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      onClick={() => setLocalSearch('')}
                      className="absolute right-3 sm:right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 sm:w-6 sm:h-6 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center transition-colors duration-200"
                      aria-label="Clear search"
                    >
                      <svg className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </motion.button>
                  )}
                </div>

                {/* Search Suggestions (if needed) */}
                {isFocused && localSearch && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50"
                  >
                    <div className="p-3 sm:p-4">
                      <div className="text-xs sm:text-sm text-gray-500 mb-2">Quick suggestions:</div>
                      <div className="space-y-1 sm:space-y-2">
                        {['iPhone 15 Pro', 'MacBook Air', 'iPad Pro', 'Apple Watch'].map((suggestion, index) => (
                          <motion.div
                            key={suggestion}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="flex items-center gap-2 sm:gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors duration-200"
                          >
                            <img className="w-3 h-3 sm:w-4 sm:h-4" src={assets.search_icon} alt="" />
                            <span className="text-sm sm:text-base text-gray-700">{suggestion}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>

              {/* Close Button */}
              <motion.button
                onClick={handleClose}
                className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:shadow-xl transition-all duration-300 group"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                aria-label="Close search"
              >
                <motion.img
                  className="w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-300 group-hover:scale-110"
                  src={assets.cross_icon}
                  alt="Close search"
                />
              </motion.button>
            </div>

            {/* Search Tips */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="mt-3 sm:mt-4 text-center"
            >
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6 text-xs sm:text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-100 rounded text-xs">⌘</kbd>
                  <span>+</span>
                  <kbd className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-100 rounded text-xs">K</kbd>
                  <span>to search</span>
                </span>
                <span className="hidden sm:inline">•</span>
                <span>Press Enter to search</span>
                <span className="hidden sm:inline">•</span>
                <span>Use filters to narrow results</span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SearchBar;
