// Admin Navbar contract: renders the management chrome and the logout
// button, which clears the admin token (App gates every route on it).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import Navbar from '../../components/Navbar';

describe('Navbar (admin panel)', () => {
  it('renders the management dashboard chrome', () => {
    render(<Navbar onLogout={vi.fn()} />);

    expect(screen.getByText('NovaCart Admin')).toBeInTheDocument();
    expect(screen.getByText('Management Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('calls the logout handler', () => {
    const onLogout = vi.fn();
    render(<Navbar onLogout={onLogout} />);

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
