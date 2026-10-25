// Admin Navbar contract: renders the management chrome and the logout
// button, which clears the admin token (App gates every route on it).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import Navbar from '../../components/Navbar';

describe('Navbar (admin panel)', () => {
  it('renders the management dashboard chrome', () => {
    render(<Navbar setToken={vi.fn()} />);

    expect(screen.getByText('E-commerce Admin')).toBeInTheDocument();
    expect(screen.getByText('Management Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('logout clears the token', () => {
    const setToken = vi.fn();
    render(<Navbar setToken={setToken} />);

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    expect(setToken).toHaveBeenCalledWith('');
    expect(setToken).toHaveBeenCalledTimes(1);
  });
});
