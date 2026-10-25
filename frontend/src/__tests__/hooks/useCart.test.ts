import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCart } from '../../hooks/useCart';
import { makeProduct } from '../../test/helpers';

// Each interaction gets its own act() so React flushes the re-render before
// the next hook call reads state (avoids stale-closure double-writes).
describe('useCart (cart interactions)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const renderCart = () => renderHook(() => useCart('', undefined));

  it('adds an item with a color and persists to localStorage', async () => {
    const { result } = renderCart();

    await act(async () => {
      await result.current.addToCart('p1', 'Black');
    });

    expect(result.current.cartItems).toEqual({ p1: { Black: 1 } });
    expect(window.localStorage.getItem('cartItems')).toBe(JSON.stringify({ p1: { Black: 1 } }));
  });

  it('increments quantity when the same item/color is added again', async () => {
    const { result } = renderCart();

    await act(async () => {
      await result.current.addToCart('p1', 'Black');
    });
    await act(async () => {
      await result.current.addToCart('p1', 'Black');
    });

    expect(result.current.cartItems).toEqual({ p1: { Black: 2 } });
    expect(result.current.getCartCount()).toBe(2);
  });

  it('updates quantity and removes the entry when quantity reaches zero', async () => {
    const { result } = renderCart();

    await act(async () => {
      await result.current.addToCart('p1', 'Black');
    });
    await act(async () => {
      await result.current.updateQuantity('p1', 'Black', 3);
    });
    expect(result.current.cartItems).toEqual({ p1: { Black: 3 } });
    expect(result.current.getCartCount()).toBe(3);

    await act(async () => {
      await result.current.updateQuantity('p1', 'Black', 0);
    });
    expect(result.current.cartItems).toEqual({});
    expect(result.current.getCartCount()).toBe(0);
  });

  it('computes the cart amount from the product catalog', async () => {
    const { result } = renderCart();
    const catalog = [
      makeProduct({ _id: 'p1', price: 10 }),
      makeProduct({ _id: 'p2', price: 25 }),
    ];

    await act(async () => {
      await result.current.addToCart('p1', 'Black');
    });
    await act(async () => {
      await result.current.addToCart('p2', 'Silver');
    });
    await act(async () => {
      await result.current.updateQuantity('p2', 'Silver', 2);
    });

    // 1 x $10 + 2 x $25 = $60
    expect(result.current.getCartAmount(catalog)).toBe(60);
  });

  it('ignores cart entries whose product is missing from the catalog', async () => {
    const { result } = renderCart();

    await act(async () => {
      await result.current.addToCart('ghost', 'Black');
    });

    expect(result.current.getCartAmount([makeProduct({ _id: 'p1', price: 10 })])).toBe(0);
  });
});
