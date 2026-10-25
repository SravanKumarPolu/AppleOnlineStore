import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useCategories from '../../hooks/useCategories';

// useCategories feeds the Collection page's filter sidebar. The contract that
// matters: one GET on mount, categories on success, an error state on failure,
// and a manual refresh.

const categories = [
  {
    _id: 'c1',
    name: 'iPhone',
    description: '',
    isActive: true,
    sortOrder: 1,
    subCategories: [{ _id: 's1', name: 'Pro', description: '', isActive: true, sortOrder: 1 }],
  },
];

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe('useCategories', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(() => jsonResponse({ success: true, categories }));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads categories once on mount from the public endpoint', async () => {
    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/category/list');
    expect(result.current.categories).toEqual(categories);
    expect(result.current.error).toBeNull();
  });

  it('exposes an error state when the API rejects the request', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ success: false }));
    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch categories');
    expect(result.current.categories).toEqual([]);
  });

  it('exposes an error state on a network failure', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch categories');
  });

  it('refreshes on demand', async () => {
    const { result } = renderHook(() => useCategories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchMock.mockImplementation(() => jsonResponse({ success: true, categories: [] }));
    result.current.refreshCategories();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.categories).toEqual([]));
  });
});
