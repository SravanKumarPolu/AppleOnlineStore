import { useState, useEffect } from "react";
import { useShopContext } from "../context/shop-context";
import AddressBook from "../components/AddressBook";
import CartTotal from "../components/CartTotal";
import Title from "../components/Title";
import PayPalPayment from "../components/PayPalPayment";
import { assets } from "../assets/assets";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { PayPalScriptProvider } from '@paypal/react-paypal-js';
import type { SavedAddress } from "../types";
import { toPayPalErrorLike } from "../utils/errorUtils";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const paymentMethods = [
  { key: "paypal", label: "PayPal", icon: assets.paypal_logo },
  { key: "stripe", label: "Credit/Debit Card", icon: null },
  { key: "cod", label: "Cash on Delivery", icon: null },
];

const validateEmail = (email: string) => /.+@.+\..+/.test(email);
const validatePhone = (phone: string) => /^\d{7,15}$/.test(phone);

// AF-1 idempotency: one key per checkout attempt. A double-submit (or a
// retried request) carrying the same key is replayed by the backend instead
// of creating a second order. A fresh key is minted after every successful
// placement so the next checkout is a new attempt.
const newIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID (older jsdom)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const PlaceOrder = () => {
  const { token, isLoggedIn, getCartAmount, delivery_fee, products, cartItems, setCartItems, navigate } = useShopContext();
  const [method, setMethod] = useState("cod");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [showPayPalPayment, setShowPayPalPayment] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: '',
    email: '',
    street: '',
    city: '',
    state: '',
    zipcode: '',
    country: '',
    phone: '',
  });
  const [defaultAddress, setDefaultAddress] = useState<SavedAddress | null>(null);
  const [allAddresses, setAllAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [mode, setMode] = useState<'add' | 'edit' | 'view'>('add');
  const [loading, setLoading] = useState(false);

  // Calculate total amount
  const subtotal = getCartAmount();
  const total = subtotal + delivery_fee;

  useEffect(() => {
    if (defaultAddress && mode === "add") {
      setFormData({
        firstName: defaultAddress.firstName || '',
        lastName: defaultAddress.lastName || '',
        email: defaultAddress.email || '',
        street: defaultAddress.street || '',
        city: defaultAddress.city || '',
        state: defaultAddress.state || '',
        zipcode: defaultAddress.zipcode || '',
        country: defaultAddress.country || '',
        phone: defaultAddress.phone || '',
      });
    }
  }, [defaultAddress, mode]);

  const handleUseAddress = (address: SavedAddress) => {
    setFormData({
      firstName: address.firstName || '',
      lastName: address.lastName || '',
      email: address.email || '',
      street: address.street || '',
      city: address.city || '',
      state: address.state || '',
      zipcode: address.zipcode || '',
      country: address.country || '',
      phone: address.phone || '',
    });
    setMode("view");
    setSelectedAddressId(address._id);
  };

  const handleNewAddress = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      street: '',
      city: '',
      state: '',
      zipcode: '',
      country: '',
      phone: '',
    });
    setMode("add");
    setSelectedAddressId(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) {
      toast.error("You must be logged in to save an address.");
      return;
    }
    if (!validateEmail(formData.email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (!validatePhone(formData.phone)) {
      toast.error("Please enter a valid phone number (7-15 digits).");
      return;
    }
    setLoading(true);
    try {
      // K-11 fix: POST to the routed plural /api/user/addresses (the old
      // singular /api/user/address literal 404'd, so saving from checkout
      // never worked).
      const response = await fetch(`${backendUrl}/api/user/addresses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token,
        },
        body: JSON.stringify(formData),
      });
      const res = await response.json();
      if (res.success) {
        toast.success("Address saved to your profile!");
        setMode("view");
      } else {
        toast.error(res.message || "Failed to save address.");
      }
    } catch {
      toast.error("Error saving address.");
    } finally {
      setLoading(false);
    }
  };

  // Build the order items payload from the cart. Mirrors the item shape used
  // by the PayPal checkout (PayPalPayment.getPayPalItems) so both paths send
  // the backend an identical contract: productId, name, image snapshot,
  // price, quantity and the selected color variant.
  const getOrderItems = () => {
    const items = [];
    for (const itemId in cartItems) {
      const product = products.find((p) => p._id === itemId);
      if (product) {
        for (const color in cartItems[itemId]) {
          const quantity = cartItems[itemId][color];
          if (quantity > 0) {
            items.push({
              productId: itemId,
              name: product.name,
              image: product.image[0],
              price: product.price,
              quantity: quantity,
              color: color,
            });
          }
        }
      }
    }
    return items;
  };

  const handlePlaceOrder = async () => {
    // Validate address
    if (!formData.firstName || !formData.email || !formData.street || !formData.city || !formData.state || !formData.zipcode || !formData.country || !formData.phone) {
      toast.error("Please fill in all address fields.");
      return;
    }

    if (method === "paypal") {
      setShowPayPalPayment(true);
      return;
    }

    // COD and Card checkouts create a real order through the generic order
    // API (K-1 fix): previously this branch only showed a success toast and
    // nothing was persisted. The order is created with paymentStatus
    // 'pending' — cash is collected on delivery for COD, and card payment is
    // arranged/collected by the store for Card.
    if (!isLoggedIn || !token) {
      toast.error("Please log in to place an order.");
      return;
    }

    const items = getOrderItems();
    if (items.length === 0) {
      toast.error("Your cart is empty.");
      return;
    }

    // Map the UI method keys to the backend paymentMethod enum values.
    const paymentMethod = method === "cod" ? "COD" : "Card";

    setPlacingOrder(true);
    try {
      const response = await fetch(`${backendUrl}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          items,
          address: formData,
          paymentMethod,
        }),
      });
      const res = await response.json();
      if (res.success) {
        // Mirror the server: the backend clears cartData on order creation,
        // so the local cart must be cleared as well. Mint a fresh
        // idempotency key so a future checkout is a new attempt (AF-1).
        setCartItems({});
        setIdempotencyKey(newIdempotencyKey());
        toast.success("Order placed successfully!");
        navigate("/orders");
      } else {
        toast.error(res.message || "Failed to place order. Please try again.");
      }
    } catch {
      toast.error("Error placing order. Please try again.");
    } finally {
      setPlacingOrder(false);
    }
  };

  const handlePayPalSuccess = () => {
    // Handle successful PayPal payment
    console.log('PayPal payment successful');
    // You can add additional logic here if needed
  };

  const handlePayPalError = (error: unknown) => {
    // Narrow the unknown error (SDK object, backend payload or Error) safely.
    const err = toPayPalErrorLike(error);
    console.error("PayPal payment error:", error);
    setShowPayPalPayment(false);

    // Enhanced error handling with automatic fallback
    let errorMessage = "PayPal payment failed. Please try a different payment method.";
    let shouldSwitchToAlternative = false;

    if (err.message) {
      if (err.message.includes('currency') || err.message.includes('CURRENCY')) {
        errorMessage = "PayPal currency issue detected. Switching to Credit/Debit Card.";
        shouldSwitchToAlternative = true;
      } else if (err.message.includes('seller') || err.message.includes('SELLER')) {
        errorMessage = "PayPal payment not available for your region. Switching to Credit/Debit Card.";
        shouldSwitchToAlternative = true;
      } else if (err.message.includes('country') || err.message.includes('COUNTRY')) {
        errorMessage = "PayPal payment not available for your country. Switching to Credit/Debit Card.";
        shouldSwitchToAlternative = true;
      } else if (err.message.includes('PAYPAL_UNAVAILABLE')) {
        errorMessage = "PayPal is currently unavailable. Switching to Credit/Debit Card.";
        shouldSwitchToAlternative = true;
      }
    }

    // Check for specific error codes from backend
    if (err.error === 'CURRENCY_NOT_SUPPORTED' || err.error === 'PAYPAL_UNAVAILABLE') {
      errorMessage = "PayPal payment not available. Switching to Credit/Debit Card.";
      shouldSwitchToAlternative = true;
    }
    
    toast.error(errorMessage);
    
    // Automatically switch to alternative payment method
    if (shouldSwitchToAlternative) {
      setTimeout(() => {
        setMethod("stripe");
        toast.info("Switched to Credit/Debit Card payment method.");
      }, 2000);
    } else {
      // Fallback to stripe if no specific error detected
      setMethod("stripe");
    }
  };

  const handlePayPalCancel = () => {
    setShowPayPalPayment(false);
    toast.info("PayPal payment cancelled.");
  };

  // Show PayPal payment component if selected
  if (showPayPalPayment) {
    // FIXED: Always use USD for PayPal sandbox compatibility
    const currency = 'USD';
    
    // SECURITY FIX: a live PayPal client ID must never be committed as a
    // fallback. Without VITE_PAYPAL_CLIENT_ID the checkout shows an explicit
    // configuration message instead of initializing the SDK with garbage.
    const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || "";

    if (!paypalClientId) {
      return (
        <div className="min-h-screen bg-gray-50 p-4" data-testid="paypal-unconfigured">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={() => setShowPayPalPayment(false)}
              className="text-blue-600 hover:text-blue-800 font-medium mb-6"
            >
              ← Back to checkout
            </button>
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">PayPal is not configured</h2>
              <p className="text-gray-600 text-sm">
                PayPal payments are unavailable because VITE_PAYPAL_CLIENT_ID is not set.
                Please use Credit/Debit Card or Cash on Delivery.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <PayPalScriptProvider 
        options={{ 
          clientId: paypalClientId,
          currency: currency,
          intent: "capture",
          components: "buttons"
        }}
      >
        <div className="min-h-screen bg-gray-50 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <button
                onClick={() => setShowPayPalPayment(false)}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                ← Back to checkout
              </button>
            </div>
            <PayPalPayment
              amount={total}
              address={formData}
              onSuccess={handlePayPalSuccess}
              onError={handlePayPalError}
              onCancel={handlePayPalCancel}
            />
          </div>
        </div>
      </PayPalScriptProvider>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-8 p-4 md:p-10 bg-gray-50 min-h-screen">
      {/* Left: Address and Delivery */}
      <div className="flex-1 max-w-xl mx-auto">
        <Title text1="DELIVERY " text2="INFORMATION" />
        <div className="mb-6">
          <AddressBook
            onDefaultAddress={setDefaultAddress}
            onAddresses={setAllAddresses}
          />
          {allAddresses.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold mb-2">Choose a saved address:</h3>
              <div className="flex flex-wrap gap-3">
                <AnimatePresence>
                  {allAddresses.map((addr) => (
                    <motion.div
                      key={addr._id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className={`p-3 border rounded w-64 cursor-pointer transition-all duration-150 shadow-sm bg-white hover:shadow-md ${addr.default ? "border-blue-500 bg-blue-50" : "border-gray-200"} ${selectedAddressId === addr._id ? "ring-2 ring-green-500" : ""}`}
                    >
                      <div className="font-semibold">
                        {addr.firstName} {addr.lastName} {addr.default && (
                          <span className="text-xs text-blue-600">(Default)</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-700">
                        {addr.street}, {addr.city}, {addr.state}, {addr.zipcode}, {addr.country}
                      </div>
                      <div className="text-sm text-gray-500">
                        Email: {addr.email} | Phone: {addr.phone}
                      </div>
                      <button
                        type="button"
                        aria-label="Use this address"
                        onClick={() => handleUseAddress(addr)}
                        className="mt-2 text-xs bg-blue-600 text-white px-2 py-1 rounded"
                      >
                        Use this address
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col justify-center"
                >
                  <button
                    type="button"
                    aria-label="Add new address"
                    onClick={handleNewAddress}
                    className="text-xs bg-green-600 text-white px-2 py-1 rounded"
                  >
                    New Address
                  </button>
                </motion.div>
              </div>
            </div>
          )}
        </div>
        {/* Delivery form as a card/modal */}
        <motion.form
          layout
          className="bg-white rounded-lg shadow p-6 space-y-4 relative"
          onSubmit={handleSubmit}
        >
          {loading && (
            <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-10">
              <div className="loader border-4 border-blue-200 border-t-blue-600 rounded-full w-10 h-10 animate-spin"></div>
            </div>
          )}
          <div className="flex gap-3">
            <div className="w-1/2">
              <input
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="First name"
                aria-label="First name"
                required
                disabled={mode === "view"}
              />
            </div>
            <div className="w-1/2">
              <input
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="Last name"
                aria-label="Last name"
                required
                disabled={mode === "view"}
              />
            </div>
          </div>
          <input
            name="email"
            value={formData.email}
            onChange={handleChange}
            type="email"
            className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
            placeholder="Email address "
            aria-label="Email address"
            required
            disabled={mode === "view"}
          />
          <input
            name="street"
            value={formData.street}
            onChange={handleChange}
            type="text"
            className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
            placeholder="Street"
            aria-label="Street"
            required
            disabled={mode === "view"}
          />
          <div className="flex gap-3">
            <div className="w-1/2">
              <input
                name="city"
                value={formData.city}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="City"
                aria-label="City"
                required
                disabled={mode === "view"}
              />
            </div>
            <div className="w-1/2">
              <input
                name="state"
                value={formData.state}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="State"
                aria-label="State"
                required
                disabled={mode === "view"}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-1/2">
              <input
                name="zipcode"
                value={formData.zipcode}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="ZipCode"
                aria-label="Zip code"
                required
                disabled={mode === "view"}
              />
            </div>
            <div className="w-1/2">
              <input
                name="country"
                value={formData.country}
                onChange={handleChange}
                type="text"
                className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
                placeholder="Country"
                aria-label="Country"
                required
                disabled={mode === "view"}
              />
            </div>
          </div>
          <input
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            type="text"
            className="border border-gray-300 rounded py-2 px-4 w-full focus:ring-2 focus:ring-blue-200"
            placeholder="Phone"
            aria-label="Phone"
            required
            disabled={mode === "view"}
          />
          <div className="flex gap-2 justify-end mt-4">
            {mode === "add" && (
              <button
                type="button"
                aria-label="Add address"
                onClick={() => setMode("edit")}
                className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"
              >
                Add
              </button>
            )}
            {mode === "view" && (
              <button
                type="button"
                aria-label="Edit address"
                onClick={() => setMode("edit")}
                className="bg-yellow-500 text-white px-4 py-2 rounded shadow hover:bg-yellow-600"
              >
                Edit
              </button>
            )}
            {mode === "edit" && (
              <button
                type="submit"
                aria-label="Save address"
                className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </motion.form>
      </div>
      {/* Right: Order Summary and Payment */}
      <div className="flex-1 max-w-md mx-auto">
        <div className="sticky top-8">
          <Title text1="ORDER " text2="SUMMARY" />
          <CartTotal />
          <div className="mt-8">
            <Title text1="PAYMENT " text2="METHOD" />
            <div className="flex flex-col gap-3 mt-4">
              {paymentMethods.map((pm) => (
                <button
                  key={pm.key}
                  type="button"
                  aria-label={`Select payment method: ${pm.label}`}
                  onClick={() => setMethod(pm.key)}
                  className={`flex items-center gap-3 border p-3 rounded-lg shadow-sm transition-all duration-150 ${method === pm.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300"} hover:shadow-md`}
                >
                  {pm.icon && (
                    <img src={pm.icon} alt={pm.label} className="h-6 w-6" />
                  )}
                  <span className="font-medium">{pm.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Place order"
              onClick={handlePlaceOrder}
              disabled={placingOrder}
              className="w-full mt-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-lg shadow-lg hover:scale-105 transition disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              {placingOrder ? "PLACING ORDER..." : "PLACE ORDER"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaceOrder;