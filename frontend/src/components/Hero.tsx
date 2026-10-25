import { assets } from "../assets/assets";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

const heroSlides = [
  { type: "image", src: assets.hero_1, alt: "Hero 1" },
  { type: "image", src: assets.hero_2, alt: "Hero 2" },
  { type: "image", src: assets.hero_3, alt: "Hero 3" },
  { type: "image", src: assets.hero_4, alt: "Hero 4" },
  { type: "image", src: assets.hero_5 || assets.hero_img, alt: "Hero Main" },
];

const AUTO_ADVANCE = 5000;

const Hero = () => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDirection(1);
      setIndex((prev) => (prev + 1) % heroSlides.length);
    }, AUTO_ADVANCE);
    return () => clearTimeout(timer);
  }, [index]);

  const goTo = (i: number) => {
    setDirection(i > index ? 1 : -1);
    setIndex(i);
  };

  const prev = () => {
    setDirection(-1);
    setIndex((prev) => (prev - 1 + heroSlides.length) % heroSlides.length);
  };
  
  const next = () => {
    setDirection(1);
    setIndex((prev) => (prev + 1) % heroSlides.length);
  };

  return (
    <motion.div 
      className="relative overflow-hidden rounded-3xl shadow-2xl bg-gradient-to-br from-gray-50 to-white mx-4 sm:mx-6 lg:mx-8"
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
      viewport={{ once: true }}
    >
      <div className="flex flex-col lg:flex-row items-stretch min-h-[500px] sm:min-h-[600px] lg:min-h-[700px]">
        {/* Enhanced Left Section - Content */}
        <motion.div
          className="w-full lg:w-1/2 px-6 sm:px-8 lg:px-12 py-8 sm:py-12 lg:py-16 flex flex-col justify-center relative z-10"
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          viewport={{ once: true }}
        >
          {/* Enhanced Background Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full blur-3xl transform -translate-x-1/2 -translate-y-1/2 w-96 h-96"></div>
          </div>

          {/* Enhanced Badge */}
          <motion.div 
            className="flex items-center gap-3 mb-8"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            viewport={{ once: true }}
          >
            <div className="w-12 h-[3px] bg-gradient-to-r from-blue-600 to-purple-600 rounded-full" />
            <span className="uppercase tracking-wider text-sm font-bold text-gray-600 bg-gray-100 px-4 py-2 rounded-full shadow-sm">
              Our Bestseller
            </span>
          </motion.div>

          {/* Enhanced Heading */}
          <motion.h1 
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-gray-900 leading-tight mb-8"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            viewport={{ once: true }}
          >
            <span className="gradient-text font-display">Latest</span>
            <br />
            <span className="text-gray-800 font-display">Arrivals</span>
          </motion.h1>

          {/* Enhanced Description */}
          <motion.p 
            className="text-lg sm:text-xl text-gray-600 mb-10 leading-relaxed max-w-lg font-body"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            viewport={{ once: true }}
          >
            Discover the latest trends and innovations in technology. 
            Experience premium quality with cutting-edge design.
          </motion.p>

          {/* Enhanced CTA Section */}
          <motion.div 
            className="flex flex-col sm:flex-row items-start sm:items-center gap-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            viewport={{ once: true }}
          >
            <motion.button 
              className="btn-modern btn-primary px-8 py-4 text-lg font-semibold rounded-2xl"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Shop Now
            </motion.button>
            
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-r from-green-400 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-base text-gray-600 font-semibold">
                Discover the trends
              </p>
            </div>
          </motion.div>

          {/* Enhanced Stats Section */}
          <motion.div 
            className="flex items-center gap-8 mt-12 pt-8 border-t border-gray-200"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            viewport={{ once: true }}
          >
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">10K+</div>
              <div className="text-sm text-gray-600 font-medium">Happy Customers</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">500+</div>
              <div className="text-sm text-gray-600 font-medium">Products</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">24/7</div>
              <div className="text-sm text-gray-600 font-medium">Support</div>
            </div>
          </motion.div>
        </motion.div>

        {/* Enhanced Right Section: Carousel */}
        <div className="w-full lg:w-1/2 h-[400px] sm:h-[500px] lg:h-auto relative overflow-hidden">
          {/* Enhanced Background Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-black" />
          
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={index}
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, x: direction > 0 ? 100 : -100, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: direction > 0 ? -100 : 100, scale: 0.95 }}
              transition={{ duration: 0.8, ease: "easeInOut" }}
            >
              {heroSlides[index].type === "image" ? (
                <div className="relative w-full h-full">
                  <img
                    src={heroSlides[index].src}
                    alt={heroSlides[index].alt}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  {/* Enhanced Overlay for better text readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {/* Enhanced Navigation Buttons */}
          <motion.button
            aria-label="Previous slide"
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 glass backdrop-blur-xl bg-white/20 hover:bg-white/30 rounded-full p-3 shadow-xl hover:shadow-2xl transition-all duration-300 z-20"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="24" height="24" className="text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </motion.button>
          
          <motion.button
            aria-label="Next slide"
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 glass backdrop-blur-xl bg-white/20 hover:bg-white/30 rounded-full p-3 shadow-xl hover:shadow-2xl transition-all duration-300 z-20"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="24" height="24" className="text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </motion.button>

          {/* Enhanced Dots Navigation */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-3 z-20">
            {heroSlides.map((_, i) => (
              <motion.button
                key={i}
                onClick={() => goTo(i)}
                className={`w-4 h-4 rounded-full transition-all duration-300 ${
                  i === index 
                    ? 'bg-white shadow-lg scale-125' 
                    : 'bg-white/50 hover:bg-white/75'
                }`}
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default Hero;
