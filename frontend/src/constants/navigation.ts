export interface NavLink {
  label: string;
  path: string;
  icon?: string;
}

export const navLinks: NavLink[] = [
  { label: 'Home', path: '/' },
  { label: 'Collection', path: '/collection' },
  { label: 'About', path: '/about' },
  { label: 'Contact', path: '/contact' },
];

export const userMenuLinks: NavLink[] = [
  { label: 'My Profile', path: '/profile' },
  { label: 'Orders', path: '/orders' },
]; 