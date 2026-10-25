// Admin Add-product page contract: submits the form as multipart FormData
// to /api/product/add with the admin token, pins the exact field encoding
// (bestseller/color JSON-encoded, stockQuantity default, optional images),
// resets the form on success and maps backend validation errors to
// per-field toasts. axios.post is spied so apiTypes' AxiosError triage
// (used by the page) keeps working.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-toastify';

import Add from '../../pages/add';
import { backendUrl } from '../../config';

const config = {} as InternalAxiosRequestConfig;
const responseOf = (status: number, data: unknown): AxiosResponse =>
  ({ status, statusText: '', data, headers: {}, config }) as AxiosResponse;

const renderAdd = () =>
  render(
    <MemoryRouter>
      <Add token="admin-token-123" />
    </MemoryRouter>
  );

const fillBasics = async () => {
  await userEvent.type(screen.getByPlaceholderText('Enter product name'), 'iPhone 16 Pro');
  await userEvent.type(
    screen.getByPlaceholderText('Write a detailed product description'),
    'The newest flagship phone.'
  );
  await userEvent.type(screen.getByPlaceholderText('0.00'), '999');
};

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /add product/i }));

describe('Add product (admin panel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits multipart FormData to /api/product/add with the exact field encoding', async () => {
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { success: true, message: 'Product Added' } });

    renderAdd();
    await fillBasics();
    // Toggle one color on (colors are JSON-encoded string arrays).
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));

    submit();

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [url, formData, init] = postSpy.mock.calls[0] as [
      string,
      FormData,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(`${backendUrl}/api/product/add`);
    expect(init).toEqual({ headers: { token: 'admin-token-123' } });

    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('name')).toBe('iPhone 16 Pro');
    expect(formData.get('description')).toBe('The newest flagship phone.');
    expect(formData.get('price')).toBe('999');
    expect(formData.get('category')).toBe('iPhone'); // select default
    expect(formData.get('subCategory')).toBe('Pro'); // select default
    expect(formData.get('bestseller')).toBe('false'); // JSON-encoded boolean
    expect(formData.get('color')).toBe('["Black"]'); // JSON-encoded array
    expect(formData.get('stockQuantity')).toBe('100'); // input default
    expect(formData.get('image1')).toBeNull(); // images are optional

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Product Added')
    );
    // The form resets after a successful add.
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter product name')).toHaveValue('')
    );
  });

  it('surfaces backend field-level validation errors as per-field toasts', async () => {
    const error = new AxiosError(
      'Request failed with status code 400',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      responseOf(400, {
        success: false,
        errors: [
          { field: 'price', message: 'Price must be a positive number' },
          { field: 'name', message: 'Name is required' },
        ],
      })
    );
    const postSpy = vi.spyOn(axios, 'post').mockRejectedValue(error);

    renderAdd();
    await fillBasics();
    submit();

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'price: Price must be a positive number'
      )
    );
    expect(toast.error).toHaveBeenCalledWith('name: Name is required');
  });

  it('maps a plain server error to its message toast', async () => {
    const error = new AxiosError(
      'Request failed with status code 403',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      responseOf(403, { success: false, message: 'Not authorized' })
    );
    vi.spyOn(axios, 'post').mockRejectedValue(error);

    renderAdd();
    await fillBasics();
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not authorized'));
  });

  it('marks the required fields as required (HTML validation guards)', () => {
    const postSpy = vi.spyOn(axios, 'post');
    renderAdd();

    expect(
      (screen.getByPlaceholderText('Enter product name') as HTMLInputElement).required
    ).toBe(true);
    expect(
      (screen.getByPlaceholderText('Write a detailed product description') as HTMLTextAreaElement)
        .required
    ).toBe(true);
    expect(
      (screen.getByPlaceholderText('0.00') as HTMLInputElement).required
    ).toBe(true);

    submit();
    expect(postSpy).not.toHaveBeenCalled();
  });
});
