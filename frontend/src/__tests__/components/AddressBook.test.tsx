// K-11 fix lock: every AddressBook mutation now calls the ROUTED plural
// /api/user/addresses endpoints (previously add/edit/delete/set-default all
// posted to the unrouted singular /api/user/address... and 404'd — only the
// GET list worked). These specs pin the exact URL + method + payload of all
// five operations against the backend contract in userAddressBook.spec.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import AddressBook from '../../components/AddressBook';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// VITE_BACKEND_URL is unset under vitest, so the page falls back to this.
const backendUrl = 'http://localhost:3001';

const fixture = {
  _id: 'addr-1',
  firstName: 'Ada',
  lastName: 'Shopper',
  email: 'ada@example.com',
  street: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100123',
  deliveryInstructions: '',
  default: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const renderAddressBook = () =>
  renderWithProviders(<AddressBook />, {
    contextValue: createMockContextValue({
      token: 'test-token',
      isLoggedIn: true,
    }),
  });

const calls = () => fetchMock.mock.calls as Array<[string, RequestInit?]>;
const callFor = (method: string, url: string) =>
  calls().find(([u, init]) => u === url && (init?.method || 'GET') === method);

const fillForm = (overrides: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    'First name': 'Grace',
    'Last name': 'Hopper',
    Email: 'grace@example.com',
    Street: '2 Oak Ave',
    City: 'Chicago',
    State: 'IL',
    'Zip code': '60601',
    Country: 'USA',
    Phone: '5550109999',
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};

beforeEach(() => {
  // Every call succeeds and answers with the fixture list — the specs below
  // assert the REQUEST side (URL / method / headers / body) of each call.
  fetchMock = vi.fn().mockImplementation(async () =>
    ok({ success: true, addresses: [fixture] })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AddressBook — K-11 fix: mutations use the routed plural endpoints', () => {
  it('loads the saved list from GET /api/user/addresses with the token header', async () => {
    renderAddressBook();

    // The per-address action buttons are the "list rendered" signal (the
    // address text itself is split across text nodes by the JSX layout).
    expect(
      await screen.findByRole('button', { name: 'Edit address' })
    ).toBeInTheDocument();

    const [url, init] = calls()[0];
    expect(url).toBe(`${backendUrl}/api/user/addresses`);
    expect(init?.method).toBeUndefined(); // plain GET
    expect(init?.headers).toEqual({ token: 'test-token' });
  });

  it('adds a new address via POST /api/user/addresses (collection endpoint)', async () => {
    renderAddressBook();
    await screen.findByRole('button', { name: 'Edit address' });

    fireEvent.click(screen.getByRole('button', { name: 'Add new address' }));
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => expect(callFor('POST', `${backendUrl}/api/user/addresses`)).toBeTruthy());

    const [, init] = callFor('POST', `${backendUrl}/api/user/addresses`)!;
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      token: 'test-token',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      city: 'Chicago',
      country: 'USA',
    });
    expect(body._id).toBeUndefined();
  });

  it('edits an address via PUT /api/user/addresses/:addressId with fields only', async () => {
    renderAddressBook();
    await screen.findByRole('button', { name: 'Edit address' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit address' }));
    // The form was populated from the fixture; change the city and save.
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    const url = `${backendUrl}/api/user/addresses/${fixture._id}`;
    await waitFor(() => expect(callFor('PUT', url)).toBeTruthy());

    const [, init] = callFor('PUT', url)!;
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      token: 'test-token',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.city).toBe('Chicago');
    expect(body.street).toBe('1 Main St'); // untouched fixture fields ride along
    // The identity travels ONLY in the route param — no _id / addressId in
    // the body (Object.assign in editUserAddress would persist them).
    expect(body._id).toBeUndefined();
    expect(body.addressId).toBeUndefined();
  });

  it('deletes an address via DELETE /api/user/addresses/:addressId', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAddressBook();
    await screen.findByRole('button', { name: 'Edit address' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete address' }));

    const url = `${backendUrl}/api/user/addresses/${fixture._id}`;
    await waitFor(() => expect(callFor('DELETE', url)).toBeTruthy());

    const [, init] = callFor('DELETE', url)!;
    expect(init?.headers).toEqual({ token: 'test-token' });
    expect(init?.body).toBeUndefined(); // the id is in the route param
  });

  it('sets the default via PUT /api/user/addresses/default with { addressId }', async () => {
    renderAddressBook();
    await screen.findByRole('button', { name: 'Edit address' });

    fireEvent.click(screen.getByRole('button', { name: 'Set as default address' }));

    const url = `${backendUrl}/api/user/addresses/default`;
    await waitFor(() => expect(callFor('PUT', url)).toBeTruthy());

    const [, init] = callFor('PUT', url)!;
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      token: 'test-token',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ addressId: fixture._id });
  });
});
