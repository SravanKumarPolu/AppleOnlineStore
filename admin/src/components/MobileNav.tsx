import { NavLink } from 'react-router-dom';
import {
  AddIcon,
  ListIcon,
  OrdersIcon,
  DashboardIcon,
  SalesIcon,
  ProductsIcon,
  UsersIcon,
  SearchIcon,
} from '../assets/SidebarIcons';

// Mobile navigation for the admin panel (K-6 fix).
// The desktop Sidebar is `hidden lg:block`, which previously left screens
// below the `lg` breakpoint with NO navigation at all. This compact,
// horizontally scrollable strip — hidden on lg and above — restores access
// to every admin destination on small screens. Destinations mirror the
// Sidebar exactly (same 8 routes; the four analytics labels are shortened
// to fit the compact strip).
function MobileNav() {
  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-1 min-w-[4.5rem] px-3 py-2 rounded-xl transition-all duration-300 font-semibold text-xs whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${
      isActive
        ? 'active bg-gradient-to-r from-primary-600 via-primary-700 to-primary-800 text-white shadow-lg shadow-primary-500/30'
        : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
    }`;

  return (
    <nav
      aria-label="Admin mobile navigation"
      className="lg:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur-xl border-t border-neutral-200/60 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] px-2 py-2"
    >
      <div className="flex items-center gap-1 overflow-x-auto">
        <NavLink to="/dashboard" className={linkClasses}>
          <DashboardIcon />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/add" className={linkClasses}>
          <AddIcon />
          <span>Add Products</span>
        </NavLink>
        <NavLink to="/list" className={linkClasses}>
          <ListIcon />
          <span>Product List</span>
        </NavLink>
        <NavLink to="/orders" className={linkClasses}>
          <OrdersIcon />
          <span>Orders</span>
        </NavLink>
        <NavLink to="/analytics/sales" className={linkClasses}>
          <SalesIcon />
          <span>Sales</span>
        </NavLink>
        <NavLink to="/analytics/products" className={linkClasses}>
          <ProductsIcon />
          <span>Products</span>
        </NavLink>
        <NavLink to="/analytics/users" className={linkClasses}>
          <UsersIcon />
          <span>Users</span>
        </NavLink>
        <NavLink to="/analytics/search" className={linkClasses}>
          <SearchIcon />
          <span>Search</span>
        </NavLink>
      </div>
    </nav>
  );
}

export default MobileNav;
