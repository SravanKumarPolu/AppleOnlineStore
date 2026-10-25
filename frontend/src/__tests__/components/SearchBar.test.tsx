import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import SearchBar from '../../components/SearchBar';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// SearchBar is the header search surface: it debounces keystrokes into the
// shared search state that the Collection page filters on. The debounce and
// the close/clear semantics were untested.

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderSearch = (overrides = {}) =>
    renderWithProviders(<SearchBar />, {
      contextValue: createMockContextValue({ showSearch: true, search: '', ...overrides }),
    });

  it('renders nothing while search is closed', () => {
    renderWithProviders(<SearchBar />, {
      contextValue: createMockContextValue({ showSearch: false }),
    });

    expect(screen.queryByLabelText('Search products')).not.toBeInTheDocument();
  });

  it('pushes the debounced value into the shared search state', async () => {
    const setSearch = vi.fn();
    renderSearch({ setSearch });

    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'iphone' } });

    // useDebounce delays propagation (300 ms in the component).
    await waitFor(() => expect(setSearch).toHaveBeenCalledWith('iphone'));
    // The input keeps rendering the immediate value (no lag for the typist).
    expect(screen.getByLabelText('Search products')).toHaveValue('iphone');
  });

  it('clears the input from the clear button', () => {
    const setSearch = vi.fn();
    renderSearch({ setSearch });

    const input = screen.getByLabelText('Search products');
    fireEvent.change(input, { target: { value: 'macbook' } });
    fireEvent.click(screen.getByLabelText('Clear search'));

    expect(input).toHaveValue('');
  });

  it('closes the bar and resets the shared search', () => {
    const setShowSearch = vi.fn();
    const setSearch = vi.fn();
    const { unmount } = renderSearch({ setShowSearch, setSearch, search: 'iphone' });

    fireEvent.click(screen.getByLabelText('Close search'));
    expect(setShowSearch).toHaveBeenCalledWith(false);
    expect(setSearch).toHaveBeenLastCalledWith('');
    unmount();
  });

  it('shows quick suggestions while the field is focused and non-empty', () => {
    const { unmount } = renderSearch();
    expect(screen.queryByText('Quick suggestions:')).not.toBeInTheDocument();
    unmount();

    renderSearch();
    const input = screen.getByLabelText('Search products');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ip' } });

    expect(screen.getByText('Quick suggestions:')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
  });
});
