import NewsletterBox from "../components/NewsLetterBox";
import Title from "../components/Title";
import { assets } from "../assets/assets";
import { motion } from "framer-motion";

const About = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        {/* About Us Title */}
        <motion.div 
          className="text-center mb-12 sm:mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Title text1={'ABOUT'} text2={'US'} />
          <motion.div 
            className="w-24 h-1 bg-gradient-to-r from-blue-600 to-purple-600 mx-auto mt-4 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: 96 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
        </motion.div>

        {/* About Content */}
        <motion.div 
          className="my-12 sm:my-16 flex flex-col lg:flex-row gap-12 lg:gap-16 items-center"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <motion.div
            className="w-full lg:w-1/2"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            <img
              src={assets.about_img}
              alt="About Apple Store"
              className="w-full rounded-2xl shadow-2xl hover:shadow-3xl transition-all duration-500 transform hover:scale-105"
            />
          </motion.div>
          
          <motion.div 
            className="flex flex-col justify-center gap-6 lg:w-1/2 text-gray-600 font-notoSans"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            <motion.p 
              className="leading-relaxed text-base sm:text-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            >
              At the Apple Store, we invite you to explore our latest range of products, from iPhones to Macs, designed to fit your lifestyle. Whether you're upgrading your current device or discovering new innovations, we have everything you need. Follow us for the latest updates, tech tips, and exclusive offers. Experience the future of technology today with Apple.
            </motion.p>
            
            <motion.p 
              className="leading-relaxed text-base sm:text-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.0 }}
            >
              <span className="font-raleway font-semibold text-gray-800">Our mission at Apple is clear:</span> to create the best products and deliver exceptional service that empowers our customers. We are committed to innovation, sustainability, and making technology accessible for everyone. Join us in shaping the future of tech with groundbreaking products and services.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.2 }}
            >
              <h3 className="text-gray-800 font-raleway text-xl sm:text-2xl font-semibold mb-3">
                Our Mission
              </h3>
              <p className="leading-relaxed text-base sm:text-lg">
                Our mission is simple: to create products that enrich people's lives and provide an unparalleled customer experience. From groundbreaking devices to unmatched customer support, we strive to make Apple a brand that inspires and empowers the world.
              </p>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Why Choose Us */}
        <motion.div 
          className="text-center py-12 sm:py-16"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <Title text1={'WHY'} text2={'CHOOSE US'} />
          <motion.div 
            className="w-24 h-1 bg-gradient-to-r from-green-600 to-blue-600 mx-auto mt-4 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: 96 }}
            transition={{ duration: 0.8, delay: 0.7 }}
          />
        </motion.div>

        {/* Benefits Section */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16 sm:mb-20"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
        >
          <motion.div 
            className="bg-white border border-gray-200 px-6 sm:px-8 py-8 sm:py-12 flex flex-col gap-4 sm:gap-6 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2"
            whileHover={{ scale: 1.02 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center mb-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-raleway font-semibold text-gray-800">Quality Assurance</h2>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              Each Apple product undergoes rigorous testing to ensure it meets the highest standards of quality, durability, and performance.
            </p>
          </motion.div>
          
          <motion.div 
            className="bg-white border border-gray-200 px-6 sm:px-8 py-8 sm:py-12 flex flex-col gap-4 sm:gap-6 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2"
            whileHover={{ scale: 1.02 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.0 }}
          >
            <div className="w-12 h-12 bg-gradient-to-r from-green-600 to-blue-600 rounded-xl flex items-center justify-center mb-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-raleway font-semibold text-gray-800">Affordable Prices</h2>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              We believe that innovation should be accessible to everyone, which is why we offer competitive pricing on all Apple devices and services.
            </p>
          </motion.div>
          
          <motion.div 
            className="bg-white border border-gray-200 px-6 sm:px-8 py-8 sm:py-12 flex flex-col gap-4 sm:gap-6 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2"
            whileHover={{ scale: 1.02 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <div className="w-12 h-12 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl flex items-center justify-center mb-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-raleway font-semibold text-gray-800">Exceptional Service</h2>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              From personalized support in-store to seamless online experiences, Apple's customer service is always ready to help you get the most out of your device.
            </p>
          </motion.div>
        </motion.div>
        
        {/* Newsletter Section */}
        <motion.div 
          className="py-8 sm:py-12"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <NewsletterBox />
        </motion.div>
      </div>
    </div>
  );
};

export default About;
