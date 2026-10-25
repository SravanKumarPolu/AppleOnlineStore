import { Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";

import Add from "./pages/add";
import List from "./pages/list";
import Login from "./components/Login";
import Navbar from "./components/Navbar";
import Orders from "./pages/orders";
import Dashboard from "./pages/dashboard";
import SalesAnalytics from "./pages/salesAnalytics";
import ProductAnalytics from "./pages/productAnalytics";
import UserAnalytics from "./pages/userAnalytics";
import SearchAnalytics from "./pages/searchAnalytics";
import Sidebar from "./components/Sidebar";
import MobileNav from "./components/MobileNav";
import NotFound from "./pages/NotFound";
import { ToastContainer } from "react-toastify";

const App = () => {
  const [token, setToken] = useState<string>(localStorage.getItem("token") || "");

  useEffect(() => {
    localStorage.setItem("token", token);
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100 text-neutral-800">
      <ToastContainer 
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        toastClassName="!bg-white !text-neutral-800 !border !border-neutral-200 !shadow-lg !rounded-xl"
      />
      
      {token === '' ? (
        <Login setToken={setToken} />
      ) : (
        <div className="flex flex-col h-screen">
          {/* Sticky Navbar */}
          <Navbar setToken={setToken} />

          {/* Main layout */}
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar (desktop) */}
            <Sidebar />

            {/* Content */}
            <main className="flex-1 overflow-y-auto bg-gradient-to-br from-neutral-50 via-white to-neutral-100">
              <div className="max-w-7xl mx-auto px-8 py-10">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/add" element={<Add token={token} />} />
                  <Route path="/list" element={<List token={token} />} />
                  <Route path="/orders" element={<Orders token={token} />} />
                  <Route path="/analytics/sales" element={<SalesAnalytics />} />
                  <Route path="/analytics/products" element={<ProductAnalytics />} />
                  <Route path="/analytics/users" element={<UserAnalytics />} />
                  <Route path="/analytics/search" element={<SearchAnalytics />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
            </main>
          </div>

          {/* Mobile navigation (below lg, where the Sidebar is hidden — K-6 fix) */}
          <MobileNav />
        </div>
      )}
    </div>
  );
}

export default App;
