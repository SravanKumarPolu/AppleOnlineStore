import { Link, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { assets } from '../assets/assets';
import { useShopContext } from '../context/shop-context';
import { navLinks, userMenuLinks } from '../constants/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWAInstall } from '../context/pwa-install-context';

const NavBar = () => {
  const [visible, setVisible] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const { setShowSearch, getCartCount, isLoggedIn, logoutUser } = useShopContext();
  const { isInstalled, openGuide } = usePWAInstall();
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isCollectionPage = location.pathname === '/collection';

  // Handle scroll effect for navbar
  useEffect(() => {
    const handleScroll = () => {
      const isScrolled = window.scrollY > 10;
      setScrolled(isScrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
    };

    if (showProfileDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProfileDropdown]);

  const handleLogout = () => {
    logoutUser();
    setVisible(false);
    setShowProfileDropdown(false);
  };

  const toggleProfileDropdown = () => {
    setShowProfileDropdown(!showProfileDropdown);
  };

  return (
    <>
      <motion.nav 
        className={`sticky top-0 z-50 transition-all duration-500 ${
          scrolled 
            ? 'glass backdrop-blur-xl bg-white/95 shadow-xl border-b border-gray-100' 
            : 'bg-white border-b border-gray-100'
        }`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="font-ui flex items-center justify-between py-4 px-4 sm:py-5 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          {/* Enhanced Logo with better animation */}
          <Link to="/" aria-label="Go to homepage" className="group">
            <motion.img 
              src={assets.logo} 
              className="w-12 sm:w-14 transition-transform duration-300 group-hover:scale-110" 
              alt="Logo"
              whileHover={{ rotate: 5 }}
              whileTap={{ scale: 0.95 }}
            />
          </Link>

          {/* Enhanced Desktop Navigation */}
          <div role="tablist" className="hidden sm:flex text-sm text-gray-900 gap-2">
            {navLinks.map((navItem, index) => (
              <motion.div
                key={navItem.path}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <NavLink
                  to={navItem.path}
                  role="tab"
                  className={({ isActive }) =>
                    `nav-link px-6 py-3 transition-all duration-300 font-semibold ${
                      isActive 
                        ? 'text-blue-600 bg-blue-50 shadow-sm' 
                        : 'hover:text-blue-600 hover:bg-gray-50'
                    }`
                  }
                >
                  {navItem.label}
                </NavLink>
              </motion.div>
            ))}
          </div>

          {/* Enhanced Right Icons */}
          <div className="flex items-center gap-3 sm:gap-4">
            {!isInstalled && (
              <motion.button
                type="button"
                onClick={(event) => openGuide(event.currentTarget)}
                className="px-3 py-2 text-xs sm:text-sm font-semibold text-blue-600 rounded-xl hover:bg-blue-50 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label="Install App"
              >
                Install App
              </motion.button>
            )}

            {/* Enhanced Search */}
            {isCollectionPage && (
              <motion.button
                onClick={() => setShowSearch(true)}
                className="p-3 rounded-xl hover:bg-gray-100 transition-all duration-300"
                whileHover={{ scale: 1.1, y: -2 }}
                whileTap={{ scale: 0.95 }}
                aria-label="Search"
              >
                <img
                  src={assets.search_icon}
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  alt="Search"
                />
              </motion.button>
            )}

            {/* Enhanced Profile Dropdown */}
            <div className="relative" ref={profileDropdownRef}>
              {isLoggedIn ? (
                <>
                  <motion.button
                    onClick={toggleProfileDropdown}
                    className={`p-3 rounded-xl transition-all duration-300 ${
                      showProfileDropdown ? 'bg-blue-100 text-blue-600 shadow-md' : 'hover:bg-gray-100'
                    }`}
                    whileHover={{ scale: 1.1, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    aria-label="Profile"
                    aria-expanded={showProfileDropdown}
                  >
                    <img
                      src={assets.profile_icon}
                      className="w-5 h-5 sm:w-6 sm:h-6"
                      alt="Profile"
                    />
                  </motion.button>
                  
                  <AnimatePresence>
                    {showProfileDropdown && (
                      <motion.div 
                        className="absolute right-0 pt-4 z-40"
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="glass backdrop-blur-xl bg-white/95 shadow-2xl rounded-2xl p-3 min-w-[200px] border border-gray-200">
                          {userMenuLinks.map((link, index) => (
                            <motion.div
                              key={link.path}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05 }}
                            >
                              <Link 
                                to={link.path} 
                                onClick={() => setShowProfileDropdown(false)}
                                className="block px-4 py-3 text-sm text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all duration-300 font-semibold"
                              >
                                {link.label}
                              </Link>
                            </motion.div>
                          ))}
                          <hr className="my-2 border-gray-200" />
                          <motion.button 
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all duration-300 font-semibold"
                            whileHover={{ x: 5 }}
                          >
                            Logout
                          </motion.button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <Link to="/login">
                  <motion.button
                    className="p-3 rounded-xl hover:bg-gray-100 transition-all duration-300"
                    whileHover={{ scale: 1.1, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    aria-label="Login"
                  >
                    <img
                      src={assets.profile_icon}
                      className="w-5 h-5 sm:w-6 sm:h-6"
                      alt="Login"
                    />
                  </motion.button>
                </Link>
              )}
            </div>

            {/* Enhanced Cart with better badge */}
            <Link to="/cart" className="relative group" aria-label="Cart">
              <motion.div
                className="p-3 rounded-xl hover:bg-gray-100 transition-all duration-300"
                whileHover={{ scale: 1.1, y: -2 }}
                whileTap={{ scale: 0.95 }}
              >
                <img
                  src={assets.cart_icon}
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  alt="Cart"
                />
                
                {/* Enhanced Cart Badge */}
                {getCartCount() > 0 && (
                  <motion.div
                    className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  >
                    {getCartCount()}
                  </motion.div>
                )}
              </motion.div>
            </Link>

            {/* Enhanced Mobile Menu Button */}
            <motion.button
              className="hidden p-3 rounded-xl hover:bg-gray-100 transition-all duration-300"
              onClick={() => setVisible(!visible)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              aria-label="Toggle menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {visible ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </motion.button>
          </div>
        </div>

        {/* Enhanced Mobile Menu */}
        <AnimatePresence>
          {visible && (
            <motion.div
              className="sm:hidden bg-white border-t border-gray-100 shadow-xl"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="px-4 py-6 space-y-4">
                {navLinks.map((navItem, index) => (
                  <motion.div
                    key={navItem.path}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <NavLink
                      to={navItem.path}
                      onClick={() => setVisible(false)}
                      className={({ isActive }) =>
                        `block px-4 py-3 text-base font-semibold rounded-xl transition-all duration-300 ${
                          isActive 
                            ? 'text-blue-600 bg-blue-50' 
                            : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                        }`
                      }
                    >
                      {navItem.label}
                    </NavLink>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </>
  );
};

export default NavBar;
