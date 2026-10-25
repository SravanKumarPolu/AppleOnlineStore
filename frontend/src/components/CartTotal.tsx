import Title from "./Title";
import { useShopContext } from "../context/shop-context";

const CartTotal = () => {
  const { currency, delivery_fee, getCartAmount } = useShopContext();

  const subtotal = getCartAmount();
  const shipping = subtotal === 0 ? 0 : delivery_fee;
  const total = subtotal + shipping;

  return (
    <section className="w-full bg-white shadow-md rounded-2xl p-6 md:p-8">
      {/* Title */}
      <div className="mb-4">
        <Title text1="Cart" text2="Summary" />
        <p className="text-sm text-neutral-500 mt-1">
          Review your items and proceed to checkout.
        </p>
      </div>

      {/* Price Details */}
      <div className="space-y-4 text-base text-neutral-700">
        <div className="flex justify-between">
          <span className="text-neutral-500">Subtotal</span>
          <span>{currency}{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Shipping Fee</span>
          <span>{currency}{shipping.toFixed(2)}</span>
        </div>
        <hr className="border-neutral-200" />
        <div className="flex justify-between font-semibold text-lg text-green-700">
          <span>Total</span>
          <span>{currency}{total.toFixed(2)}</span>
        </div>
      </div>


    </section>
  );
};

export default CartTotal;
