import { useContext } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShopContext, useShopContext } from '../../context/shop-context';
import { createMockContextValue } from '../../test/helpers';

describe('shop-context module (Fast Refresh split)', () => {
  it('exposes the raw ShopContext whose default value is null', () => {
    // Consumers that read the context directly must tolerate a missing
    // provider (BestSeller/LatestCollection/ProductItems rely on this).
    const Consumer = () => {
      const value = useRawContext();
      return <span data-testid="raw-value">{value === null ? 'null' : 'provided'}</span>;
    };
    render(<Consumer />);
    expect(screen.getByTestId('raw-value')).toHaveTextContent('null');
  });

  it('throws a descriptive error when useShopContext is used without a provider', () => {
    const Consumer = () => {
      useShopContext();
      return <span>unreachable</span>;
    };

    // React logs the error; assert on the thrown message via render failure.
    expect(() => render(<Consumer />)).toThrowError(
      /useShopContext must be used within a ShopContextProvider/,
    );
  });

  it('returns the provider value when mounted inside ShopContext.Provider', () => {
    const contextValue = createMockContextValue({ currency: '€' });
    const Consumer = () => {
      const { currency } = useShopContext();
      return <span data-testid="currency">{currency}</span>;
    };

    render(
      <ShopContext.Provider value={contextValue}>
        <Consumer />
      </ShopContext.Provider>,
    );
    expect(screen.getByTestId('currency')).toHaveTextContent('€');
  });
});

// Local helper kept tiny: reads the context without the guard.
function useRawContext() {
  return useContext(ShopContext);
}
