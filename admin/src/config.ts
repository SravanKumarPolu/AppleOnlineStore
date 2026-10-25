// Shared app constants. Previously exported from App.tsx, which broke React
// Fast Refresh (a file exporting components must only export components).
export const backendUrl: string = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
export const currency = '$';
