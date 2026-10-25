import { assets } from '../assets/assets';

interface NavbarProps {
  setToken: React.Dispatch<React.SetStateAction<string>>;
}

const Navbar: React.FC<NavbarProps> = ({ setToken }) => {
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-neutral-200/60 shadow-lg shadow-neutral-900/5">
      <div className="flex items-center justify-between px-8 py-6">
        {/* Enhanced Logo */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <img 
              className="h-14 w-auto hover:scale-105 transition-transform duration-300 hover:shadow-lg hover:shadow-neutral-900/10" 
              alt="Logo" 
              src={assets.logo} 
            />
            <div className="hidden sm:block">
              <h2 className="text-heading-4 font-bold text-neutral-900 gradient-text mb-1">
                E-commerce Admin
              </h2>
              <p className="text-caption text-neutral-500 font-semibold tracking-wide">
                Management Dashboard
              </p>
            </div>
          </div>
          
          {/* Enhanced breadcrumb indicator */}
          <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-neutral-50 rounded-xl border border-neutral-200/60 hover:bg-neutral-100 transition-all duration-300 hover:scale-[1.02] hover:shadow-md">
            <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse shadow-lg shadow-primary-500/50"></div>
            <span className="text-sm font-semibold text-neutral-600">Live Dashboard</span>
          </div>
        </div>

        {/* Enhanced Right Section */}
        <div className="flex items-center gap-6">
          {/* Enhanced User Info */}
          <div className="hidden md:flex items-center gap-4 px-6 py-4 bg-gradient-to-r from-neutral-50 via-white to-neutral-50 rounded-xl border border-neutral-200/60 shadow-sm hover:shadow-md hover:scale-105 transition-all duration-300">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 rounded-full flex items-center justify-center shadow-lg shadow-primary-500/30 border border-primary-400/20 hover:scale-110 transition-transform duration-300">
              <span className="text-white text-base font-bold">A</span>
            </div>
            <div>
              <p className="text-sm font-bold text-neutral-900 mb-1">Admin User</p>
              <p className="text-xs font-semibold text-neutral-500 tracking-wide">Administrator</p>
            </div>
            <div className="w-2.5 h-2.5 bg-success-500 rounded-full animate-pulse shadow-lg shadow-success-500/50"></div>
          </div>

          {/* Enhanced Logout Button */}
          <button 
            onClick={() => setToken('')} 
            className="btn-modern btn-secondary hover:bg-error-50 hover:border-error-200 hover:text-error-700 group px-6 py-3 hover:scale-105 transition-all duration-300"
          >
            <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="hidden sm:inline font-semibold">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
