import { useCallback, useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/shop-context';
import Title from './Title';
import { motion, AnimatePresence } from 'framer-motion';
import ProductItems from './ProductItems';
import type { Product } from '../types';

const BestSeller: React.FC = () => {
  const context = useContext(ShopContext);

  // All hooks must be called before any early return (Rules of Hooks).
  // The original conditional rendering/early-return behavior is preserved below.
  const products = context?.products;

  const [bestSeller, setBestSeller] = useState<Product[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');

  useEffect(() => {
    if (products && products.length > 0) {
      // Filter products that are marked as bestsellers
      const bestsellerProducts = products.filter(product => product.bestseller === true);
      // Take up to 12 bestseller products for multiple slides
      setBestSeller(bestsellerProducts.slice(0, 12));
    }
  }, [products]);

  const itemsPerSlide = 4;
  const totalSlides = Math.ceil(bestSeller.length / itemsPerSlide);

  const nextSlide = useCallback(() => {
    if (totalSlides <= 1) return;

    setSlideDirection('right');
    setCurrentSlide((prev) => {
      if (prev === totalSlides - 1) {
        // Loop back to first slide
        return 0;
      }
      return prev + 1;
    });
  }, [totalSlides]);

  const prevSlide = useCallback(() => {
    if (totalSlides <= 1) return;

    setSlideDirection('left');
    setCurrentSlide((prev) => {
      if (prev === 0) {
        // Loop back to last slide
        return totalSlides - 1;
      }
      return prev - 1;
    });
  }, [totalSlides]);

  const goToSlide = useCallback((slideIndex: number) => {
    if (slideIndex === currentSlide) return;

    // Determine slide direction based on target index
    const direction = slideIndex > currentSlide ? 'right' : 'left';
    setSlideDirection(direction);
    setCurrentSlide(slideIndex);
  }, [currentSlide]);

  const getCurrentSlideItems = () => {
    const startIndex = currentSlide * itemsPerSlide;
    return bestSeller.slice(startIndex, startIndex + itemsPerSlide);
  };

  // Keyboard navigation with improved logic
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (totalSlides <= 1) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevSlide();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextSlide();
      } else if (event.key >= '1' && event.key <= '9') {
        const slideIndex = parseInt(event.key) - 1;
        if (slideIndex < totalSlides) {
          event.preventDefault();
          goToSlide(slideIndex);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalSlides, nextSlide, prevSlide, goToSlide]);

  if (!context) {
    return null;
  }

  if (!products || products.length === 0) {
    return (
      <section className="py-16 text-center text-gray-500">
        Loading best sellers...
      </section>
    );
  }

  // Get animation variants based on slide direction
  const getSlideVariants = () => ({
    enter: (direction: 'left' | 'right') => ({
      x: direction === 'right' ? 300 : -300,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: 'left' | 'right') => ({
      zIndex: 0,
      x: direction === 'right' ? -300 : 300,
      opacity: 0
    })
  });

  return (
    <section className="px-4 sm:px-6 md:px-8 lg:px-12 ">
      {/* Enhanced Section Title */}
      <header className="text-center mb-16">
        <Title text1="Best" text2="Seller" />
        <p className="w-3/4 mx-auto text-base sm:text-lg text-gray-600 mt-4 font-medium">
          Discover our top-selling products loved by customers worldwide.
        </p>
      </header>

      {/* Enhanced Product Carousel */}
      {bestSeller.length > 0 ? (
        <div className="relative">
          {/* Enhanced Carousel Container */}
          <div className=" p-2">
            <AnimatePresence mode="wait" custom={slideDirection}>
              <motion.div
                key={currentSlide}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8"
                custom={slideDirection}
                variants={getSlideVariants()}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 }
                }}
              >
                {getCurrentSlideItems().map((item, index) => (
                  <motion.div
                    key={item._id}
                    className="h-full min-h-[500px] flex"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                  >
                    <ProductItems
                      id={item._id}
                      image={item.image}
                      name={item.name}
                      price={item.price}
                      bestseller={item.bestseller}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Enhanced Navigation Buttons */}
          {totalSlides > 1 && (
            <>
              {/* Enhanced Previous Button */}
              <motion.button
                onClick={prevSlide}
                className="carousel-nav-button left-0 -translate-x-4 sm:-translate-x-6"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                aria-label="Previous slide"
                disabled={totalSlides <= 1}
              >
                <svg 
                  className="w-6 h-6 text-gray-600 group-hover:text-blue-600 transition-colors duration-300" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </motion.button>

              {/* Enhanced Next Button */}
              <motion.button
                onClick={nextSlide}
                className="carousel-nav-button right-0 translate-x-4 sm:translate-x-6"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                aria-label="Next slide"
                disabled={totalSlides <= 1}
              >
                <svg 
                  className="w-6 h-6 text-gray-600 group-hover:text-blue-600 transition-colors duration-300" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.button>
            </>
          )}

          {/* Enhanced Slide Indicators */}
          {totalSlides > 1 && (
            <div className="flex justify-center mt-12 space-x-3" role="tablist" aria-label="Carousel navigation">
              {Array.from({ length: totalSlides }, (_, i) => (
                <motion.button
                  key={i}
                  onClick={() => goToSlide(i)}
                  className={`carousel-indicator ${
                    i === currentSlide ? 'active' : 'inactive'
                  }`}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: i * 0.1 }}
                  role="tab"
                  aria-selected={i === currentSlide}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Enhanced Slide Counter */}
          {totalSlides > 1 && (
            <motion.div
              className="text-center mt-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <p className="text-sm text-gray-600 font-medium" aria-live="polite">
                {currentSlide + 1} of {totalSlides}
              </p>
            </motion.div>
          )}
        </div>
      ) : (
        <motion.div 
          className="text-center py-16"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          <p className="text-gray-600 text-lg font-medium">No bestseller products available at the moment.</p>
          <p className="text-gray-500 text-sm mt-3">Check back soon for our featured products!</p>
        </motion.div>
      )}
    </section>
  );
};

export default BestSeller;
