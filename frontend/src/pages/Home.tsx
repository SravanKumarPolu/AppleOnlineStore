import Hero from "../components/Hero";
import LatestCollection from "../components/LatestCollection";
import BestSeller from "../components/BestSeller";
import OurPolicy from "../components/OurPolicy";
import NewsletterBox from "../components/NewsLetterBox";
import { motion } from "framer-motion";

const Home = () => {
  return (
    <div className="space-y-24 sm:space-y-28 lg:space-y-32">
      {/* Enhanced Hero Section */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="section-padding"
      >
        <Hero />
      </motion.section>

      {/* Enhanced Latest Products */}
      <motion.section
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="section-padding"
      >
        <div className="max-width container-padding">
          <LatestCollection />
        </div>
      </motion.section>

      {/* Enhanced Best Sellers */}
      <motion.section
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        viewport={{ once: true }}
        className="section-padding bg-gradient-to-br from-gray-50 to-white"
      >
        <div className="max-width container-padding">
          <BestSeller />
        </div>
      </motion.section>

      {/* Enhanced Policies */}
      <motion.section
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        viewport={{ once: true }}
        className="section-padding"
      >
        <div className="max-width container-padding">
          <OurPolicy />
        </div>
      </motion.section>

      {/* Enhanced Newsletter */}
      <motion.section
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.6 }}
        viewport={{ once: true }}
        className="section-padding bg-gradient-to-br from-blue-50 to-purple-50"
      >
        <div className="max-width container-padding">
          <NewsletterBox />
        </div>
      </motion.section>
    </div>
  );
};

export default Home;
