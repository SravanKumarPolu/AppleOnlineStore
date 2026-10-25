import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ShoppingBag, Info, Mail } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSwipeable } from 'react-swipeable';

const navItems = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/collection', label: 'Shop', icon: ShoppingBag },
  { path: '/about', label: 'About', icon: Info },
  { path: '/contact', label: 'Contact', icon: Mail },
];

const MobileBottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isReducedMotion = useMemo(() => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  };

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);

  // Long press to show tooltip
  const handleLongPress = (index: number) => {
    setTooltipIndex(index);
    setTimeout(() => setTooltipIndex(null), 2000); // Auto hide tooltip
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const total = navItems.length;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      itemRefs.current[(index + 1) % total]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      itemRefs.current[(index - 1 + total) % total]?.focus();
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const currentIndex = navItems.findIndex(item => item.path === location.pathname);
      const nextPath = navItems[(currentIndex + 1) % navItems.length].path;
      navigate(nextPath);
    },
    onSwipedRight: () => {
      const currentIndex = navItems.findIndex(item => item.path === location.pathname);
      const prevPath = navItems[(currentIndex - 1 + navItems.length) % navItems.length].path;
      navigate(prevPath);
    },
    delta: 30, // minimum distance(px) to be considered swipe
    trackTouch: true,
    preventScrollOnSwipe: true,
  });

  return (
    <motion.nav
      {...swipeHandlers}
      role="navigation"
      aria-label="Mobile Bottom Navigation"
      className="fixed bottom-0 left-0 w-full max-w-[480px] sm:hidden z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={
        isReducedMotion
          ? { duration: 0 }
          : { type: 'spring', damping: 20, stiffness: 300 }
      }
    >
      <div className="relative mx-4 mb-4">
        <motion.div
          className="absolute inset-0 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-gray-100/50 dark:border-gray-700/50"
          layoutId="nav-background"
        />
        <div className="relative flex items-center justify-evenly p-2">
          {navItems.map(({ path, label, icon: Icon }, index) => {
            const isActive = location.pathname === path;

            return (
              <Link
                key={path}
                ref={(el) => (itemRefs.current[index] = el)}
                to={path}
                tabIndex={0}
                onClick={triggerHaptic}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onPointerDown={() => {
                  setTimeout(() => handleLongPress(index), 500);
                }}
                className="flex-1 flex items-center justify-center min-w-0 relative z-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                title={label}
              >
                <motion.div
                  className={`flex flex-col items-center justify-center gap-1 p-3 w-full rounded-xl relative transition-colors duration-200 ease-in-out ${
                    isActive
                      ? 'text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                  whileHover={isReducedMotion ? {} : { scale: 1.05 }}
                  whileTap={isReducedMotion ? {} : { scale: 0.95 }}
                  transition={
                    isReducedMotion
                      ? {}
                      : { type: 'spring', stiffness: 300, damping: 30 }
                  }
                >
                  {isActive ? (
                    <>
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
                        layoutId="active-item"
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      />
                      <motion.div
                        className="absolute -inset-1 rounded-2xl bg-blue-500/30 blur-xl opacity-60"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6 }}
                      />
                    </>
                  ) : (
                    <motion.div
                      className="absolute inset-0 rounded-xl border border-transparent group-hover:border-blue-400 group-hover:shadow-[0_0_12px_2px_rgba(59,130,246,0.4)] pointer-events-none"
                      initial={{ opacity: 0 }}
                      whileHover={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    />
                  )}

                  <Icon
                    className="w-6 h-6 relative z-10 transition-colors duration-200"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium relative z-10 transition-colors duration-200">
                    {label}
                  </span>

                  {/* Tooltip */}
                  {tooltipIndex === index && (
                    <div className="absolute bottom-full mb-2 px-2 py-1 rounded bg-black text-white text-xs z-50">
                      {label}
                    </div>
                  )}
                </motion.div>
              </Link>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
};

export default MobileBottomNav;
