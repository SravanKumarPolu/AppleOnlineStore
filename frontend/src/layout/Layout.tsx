// src/layout/Layout.tsx
import React, { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import NavBar from "../components/NavBar";
import Footer from "../components/Footer";
import SearchBar from "../components/SearchBar";
import MobileBottomNav from "../components/MobileBottomNav";
import { motion } from "framer-motion";
import { ScrollToTopButton } from "../utils/ScrollToTop";
import PerformanceMonitor from "../components/PerformanceMonitor";

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const isCollectionPage = location.pathname === '/collection';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Enhanced Navigation */}
      <NavBar />
{/* Enhanced Search Bar - Only render on Collection page */}
      {isCollectionPage && <SearchBar />}
      
      {/* Enhanced Main Content */}
      <motion.main 
        className="flex-1 relative pb-20 sm:pb-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Enhanced Background Pattern */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-blue-400/10 to-purple-600/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-gradient-to-br from-green-400/10 to-blue-600/10 rounded-full blur-3xl"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-br from-purple-400/5 to-pink-600/5 rounded-full blur-3xl"></div>
        </div>
        
        {/* Enhanced Content Container */}
        <div className="relative z-10">
          {children}
        </div>
      </motion.main>
      
      {/* Enhanced Scroll to Top Button */}
      <ScrollToTopButton />
      
      {/* Performance Monitor (Development Only) */}
      <PerformanceMonitor />
      
      {/* Enhanced Mobile Bottom Navigation */}
      <MobileBottomNav />
      
      {/* Enhanced Footer */}
      <Footer />
    </div>
  );
};

export default Layout;
