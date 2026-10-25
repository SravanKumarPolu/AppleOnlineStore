import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { useProducts } from '../../hooks/useProducts';

// useProducts is the storefront's catalog data source. It was untested: the
// query-string contract (limit=1000 default, filters, token header) and the
// failure paths are what the pages depend on.

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

const product = {
  _id: 'p1',
  name: 'Test Product',
  description: 'd',
  price: 100,
  image: ['/i.jpg'],
  category: 'iPhone',
  subCategory: 'Pro',
  color: ['Black'],
  date: 1,
  bestseller: false,
  inStock: true,
  stockQuantity: 5,
};

describe('useProducts', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(() =>
      jsonResponse({
        success: true,
        products: [product],
        pagination: { currentPage: 1, totalPages: 1, totalProducts: 1, hasNextPage: false, hasPrevPage: false },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fetches the whole catalog by default (limit=1000) and stores it', async () => {
    const { result } = renderHook(() => useProducts(''));

    await act(async () => {
      await result.current.fetchProducts();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/product/list?limit=1000');
    // No token → no authorization header at all.
    expect(init.headers).toEqual({});
    expect(result.current.products).toHaveLength(1);
    expect(result.current.products[0].name).toBe('Test Product');
    expect(result.current.pagination?.totalProducts).toBe(1);
  });

  it('serialises filters into the query string and omits empty values', async () => {
    const { result } = renderHook(() => useProducts(''));

    await act(async () => {
      await result.current.fetchProducts({
        category: 'iPhone',
        search: 'pro',
        bestseller: true,
        limit: 12,
        page: 2,
        subCategory: undefined,
      });
    });

    const [url] = fetchMock.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get('category')).toBe('iPhone');
    expect(params.get('search')).toBe('pro');
    expect(params.get('bestseller')).toBe('true');
    expect(params.get('limit')).toBe('12');
    expect(params.get('page')).toBe('2');
    expect(params.has('subCategory')).toBe(false);
  });

  it('sends the shopper token when one is provided', async () => {
    const { result } = renderHook(() => useProducts('jwt-token'));

    await act(async () => {
      await result.current.fetchProducts();
    });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ token: 'jwt-token' });
  });

  it('reports a rejected response with a toast and keeps the previous catalog', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ success: false }));
    const { result } = renderHook(() => useProducts(''));

    await act(async () => {
      await result.current.fetchProducts();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to fetch products');
    expect(result.current.products).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('reports a network failure with the error helper message', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const { result } = renderHook(() => useProducts(''));

    await act(async () => {
      await result.current.fetchProducts();
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('offline');
  });

  it('returns the payload (and null on failure) from the paginated variant', async () => {
    const { result } = renderHook(() => useProducts(''));

    let payload: Awaited<ReturnType<typeof result.current.fetchProductsWithPagination>>;
    await act(async () => {
      payload = await result.current.fetchProductsWithPagination({ limit: 5, page: 1 });
    });
    expect(payload!.products).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('limit')).toBe('5');

    fetchMock.mockImplementation(() => jsonResponse({ success: false }));
    await act(async () => {
      payload = await result.current.fetchProductsWithPagination({ limit: 5 });
    });
    expect(payload!).toBeNull();
  });

  it('refresh and forceRefresh both re-query (force also confirms to the user)', async () => {
    const { result } = renderHook(() => useProducts(''));

    await act(async () => {
      await result.current.fetchProducts();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refreshProducts();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.forceRefreshProducts();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(toast.info).toHaveBeenCalledWith('Products refreshed!');
  });
});
