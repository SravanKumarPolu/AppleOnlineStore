import { assets } from '../assets/assets';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const policies = [
  {
    icon: assets.exchange_icon,
    title: "Easy Exchange Policy",
    desc: "We offer a hassle-free exchange policy with no questions asked. Exchange your product within 30 days of purchase.",
    alt: "Exchange Policy",
    gradient: "from-blue-500 to-purple-600",
    bgGradient: "from-blue-50 to-purple-50"
  },
  {
    icon: assets.quality_icon,
    title: "7 Days Return Policy",
    desc: "We provide a 7-day free return policy with full refund. Your satisfaction is our top priority.",
    alt: "Return Policy",
    gradient: "from-green-500 to-blue-600",
    bgGradient: "from-green-50 to-blue-50"
  },
  {
    icon: assets.support_img,
    title: "24/7 Customer Support",
    desc: "Our dedicated team provides round-the-clock customer support to assist you with any questions or concerns.",
    alt: "Customer Support",
    gradient: "from-purple-500 to-pink-600",
    bgGradient: "from-purple-50 to-pink-50"
  },
];

const OurPolicy = () => {
  const navigate = useNavigate();

  const handleContactSupport = () => {
    navigate('/contact');
  };

  return (
    <section className=" section-padding bg-gradient-to-br from-gray-50 to-white relative overflow-hidden">
      {/* Enhanced Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-br from-green-500 to-blue-600 rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2"></div>
      </div>

      <div className="max-width  container-padding relative z-10">
        {/* Enhanced Section Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <div className="flex items-center justify-center gap-4 mb-8">
            <div className="w-12 h-[3px] bg-gradient-to-r from-blue-600 to-purple-600 rounded-full" />
            <span className="uppercase tracking-wider text-sm font-bold text-gray-600 bg-gray-100 px-4 py-2 rounded-full shadow-sm">
              Our Promise
            </span>
            <div className="w-12 h-[3px] bg-gradient-to-r from-purple-600 to-blue-600 rounded-full" />
          </div>
          
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 font-display mb-6">
            Our <span className="gradient-text">Policies</span>
          </h2>
          
          <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed font-body">
            We believe in transparency and customer satisfaction. Our policies are designed to provide you with the best shopping experience possible.
          </p>
        </motion.div>

        {/* Enhanced Policy Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-12">
          {policies.map((item, index) => (
            <motion.div
              key={index}
              className="group relative"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              viewport={{ once: true }}
              role="region"
              aria-label={item.alt}
            >
              {/* Enhanced Card */}
              <div className="card-elevated h-full p-8 text-center relative overflow-hidden">
                {/* Enhanced Background Gradient */}
                <div className={`absolute inset-0 bg-gradient-to-br ${item.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                
                {/* Enhanced Icon Container */}
                <motion.div
                  className={`relative z-10 w-20 h-20 bg-gradient-to-r ${item.gradient} rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-xl transition-all duration-300`}
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <img 
                    src={item.icon} 
                    alt={item.alt} 
                    className="w-10 h-10 filter brightness-0 invert" 
                  />
                </motion.div>

                {/* Enhanced Content */}
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-gray-800 transition-colors duration-300">
                    {item.title}
                  </h3>
                  <p className="text-base text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
                    {item.desc}
                  </p>
                </div>

                {/* Enhanced Hover Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-purple-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Enhanced Call to Action */}
        <motion.div
          className="text-center mt-16 pt-8 border-t border-gray-200"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          viewport={{ once: true }}
        >
          <p className="text-lg text-gray-600 mb-6 font-medium">
            Have questions about our policies?
          </p>
          <motion.button
            onClick={handleContactSupport}
            className="btn-modern btn-outline px-8 py-4 text-lg font-semibold rounded-2xl"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Navigate to contact page for support"
          >
            Contact Support
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
};

export default OurPolicy;
