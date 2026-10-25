// Admin List-products page contract: loads the public paginated catalog
// from /api/product/list (NO auth header — public endpoint), renders the
// product rows with prices, pages through results, refreshes, and deletes
// products via POST /api/product/remove with the admin token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-toastify';

import List from '../../pages/list';
import { backendUrl } from '../../config';

const config = {} as InternalAxiosRequestConfig;
const responseOf = (status: number, data: unknown): AxiosResponse =>
  ({ status, statusText: '', data, headers: {}, config }) as AxiosResponse;

const productA = {
  _id: 'p1',
  name: 'iPhone 15 Pro',
  category: 'iPhone',
  price: 100,
  image: ['https://example.com/a.png'],
};
const productB = {
  _id: 'p2',
  name: 'MacBook Air',
  category: 'Mac',
  price: 50,
  image: ['https://example.com/b.png'],
};

const listResponse = {
  success: true,
  products: [productA, productB],
  pagination: { currentPage: 1, totalPages: 1, totalProducts: 2 },
};

describe('List products (admin panel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the catalog from the public list endpoint and renders the rows', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: listResponse });

    render(<List token="admin-token-123" />);

    // Each product row renders twice (mobile + desktop layouts) — the names,
    // categories and prices all appear multiple times.
    expect((await screen.findAllByText('iPhone 15 Pro')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('MacBook Air').length).toBeGreaterThan(0);
    expect(screen.getAllByText('iPhone').length).toBeGreaterThan(0); // category badge
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Showing 2 of 2 products')).toBeInTheDocument();

    // The list endpoint is public — no token header is attached.
    expect(getSpy).toHaveBeenCalledWith(
      `${backendUrl}/api/product/list?page=1&limit=20`
    );
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.spyOn(axios, 'get').mockImplementation(() => new Promise(() => {}));

    render(<List token="admin-token-123" />);

    expect(screen.getByText('Loading products...')).toBeInTheDocument();
    expect(screen.queryByText('Product Management')).not.toBeInTheDocument();
  });

  it('pages through results (page param travels in the query string)', async () => {
    const twoPageResponse = {
      ...listResponse,
      pagination: { currentPage: 1, totalPages: 2, totalProducts: 25 },
    };
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: twoPageResponse });
    window.scrollTo = vi.fn(); // jsdom does not implement smooth scrolling

    render(<List token="admin-token-123" />);

    // The header shows the parenthesized page position; the footer pager
    // has one numbered button per visible page.
    expect(await screen.findByText('(Page 1 of 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(
        `${backendUrl}/api/product/list?page=2&limit=20`
      )
    );
  });

  it('deletes a product via POST /api/product/remove and refreshes', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: listResponse });
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { success: true, message: 'Product removed' } });

    render(<List token="admin-token-123" />);
    await screen.findAllByText('iPhone 15 Pro');
    expect(getSpy).toHaveBeenCalledTimes(1);

    // Each row renders two delete buttons (mobile + desktop layouts).
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete product' })[0]);

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        `${backendUrl}/api/product/remove`,
        { id: 'p1' },
        { headers: { token: 'admin-token-123' } }
      )
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Product removed')
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it('refreshes the current page via the Refresh button', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: listResponse });

    render(<List token="admin-token-123" />);
    await screen.findAllByText('iPhone 15 Pro');
    expect(getSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    expect(getSpy).toHaveBeenLastCalledWith(
      `${backendUrl}/api/product/list?page=1&limit=20`
    );
  });

  it('maps a failed load to the server error toast', async () => {
    const error = new AxiosError(
      'Request failed with status code 500',
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      responseOf(500, { success: false, message: 'Catalog unavailable' })
    );
    vi.spyOn(axios, 'get').mockRejectedValue(error);

    render(<List token="admin-token-123" />);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Catalog unavailable')
    );
  });

  it('shows the empty state when the catalog has no products', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({
      data: { success: true, products: [], pagination: null },
    });

    render(<List token="admin-token-123" />);

    expect(await screen.findByText('No Products Found')).toBeInTheDocument();
  });
});
