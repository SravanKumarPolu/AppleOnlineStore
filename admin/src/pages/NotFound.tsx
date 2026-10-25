import { Link } from 'react-router-dom';

// Catch-all 404 page for the admin panel (K-6 fix).
// Previously an unknown admin route (e.g. /nonexistent) rendered a blank
// content area — no message, no way back. This page matches the admin
// design language and always offers a route home.
const NotFound = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-20 h-20 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 rounded-3xl flex items-center justify-center shadow-xl shadow-primary-500/30 border border-primary-400/20 mb-8">
        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <h1 className="text-heading-1 font-bold bg-gradient-to-r from-primary-600 via-primary-700 to-primary-800 bg-clip-text text-transparent mb-3">
        404
      </h1>
      <h2 className="text-heading-4 font-bold text-neutral-900 mb-2">Page not found</h2>
      <p className="text-sm text-neutral-500 font-medium max-w-md mb-8">
        The admin page you are looking for does not exist or may have been moved.
        Check the URL or head back to the dashboard.
      </p>

      <Link
        to="/dashboard"
        className="btn-modern btn-primary px-8 py-3 font-semibold hover:scale-105 transition-all duration-300"
      >
        Back to Dashboard
      </Link>
    </div>
  );
};

export default NotFound;
