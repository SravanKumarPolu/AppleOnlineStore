import userModel from '../models/userModel.js';
import { UserActivity, ProductPerformance } from '../models/analyticsModel.js';
import { redactError } from '../utils/redact.js';

// Final gate Task 4 — cross-user access closed. userId is ALWAYS derived from
// the verified token (req.user.id set by authUser middleware); a userId in the
// request body is ignored. Admin tokens carry no user id (req.user.id === null)
// and are rejected with 403 — carts are per-shopper records.

function resolveCartUserId(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    // Admin token or token without a user id — carts belong to shoppers.
    res.status(403).json({
      success: false,
      message: 'Shopper authentication required'
    });
    return null;
  }
  return userId;
}

const addToCart = async (req, res) => {
  try {
    const { itemId, color } = req.body;
    const userId = resolveCartUserId(req, res);
    if (!userId) return;

    if (!itemId || !color) {
      return res.status(400).json({
        success: false,
        message: 'itemId and color are required'
      });
    }

    const userData = await userModel.findById(userId);
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let cartData = userData.cartData || {};

    // Initialize product in cart if doesn't exist
    if (!cartData[itemId]) {
      cartData[itemId] = {};
    }

    // Add or increment quantity for the color
    cartData[itemId][color] = (cartData[itemId][color] || 0) + 1;

    // Update user's cart data in database
    await userModel.findByIdAndUpdate(userId, { cartData });

    // Track add to cart analytics
    try {
      await UserActivity.trackActivity({
        userId,
        action: 'add_to_cart',
        productId: itemId,
        sessionId: req.session?.id
      });

      await ProductPerformance.updateProductMetrics(itemId, {
        addToCartCount: 1
      });
    } catch (analyticsError) {
      console.error('Add to cart analytics tracking error:', redactError(analyticsError));
      // Don't fail the request if analytics tracking fails
    }

    res.json({
      success: true,
      message: 'Item added to cart successfully',
      cartData
    });

  } catch (error) {
    console.error('Add to cart error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const updateCart = async (req, res) => {
  try {
    const { itemId, color, quantity } = req.body;
    const userId = resolveCartUserId(req, res);
    if (!userId) return;

    if (!itemId || !color || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'itemId, color, and quantity are required'
      });
    }

    const userData = await userModel.findById(userId);
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let cartData = userData.cartData || {};
    const previousQuantity = cartData[itemId]?.[color] || 0;

    if (quantity <= 0) {
      // Remove item if quantity is 0 or negative
      if (cartData[itemId] && cartData[itemId][color]) {
        delete cartData[itemId][color];
        // Remove product entry if no colors left
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      }

      // Track remove from cart analytics
      if (previousQuantity > 0) {
        try {
          await UserActivity.trackActivity({
            userId,
            action: 'remove_from_cart',
            productId: itemId,
            sessionId: req.session?.id
          });
        } catch (analyticsError) {
          console.error('Remove from cart analytics tracking error:', redactError(analyticsError));
        }
      }
    } else {
      // Update quantity
      if (!cartData[itemId]) {
        cartData[itemId] = {};
      }
      cartData[itemId][color] = quantity;
    }

    // Update user's cart data in database
    await userModel.findByIdAndUpdate(userId, { cartData });

    res.json({
      success: true,
      message: 'Cart updated successfully',
      cartData
    });

  } catch (error) {
    console.error('Update cart error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const getUserCart = async (req, res) => {
  try {
    const userId = resolveCartUserId(req, res);
    if (!userId) return;

    const userData = await userModel.findById(userId);
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      cartData: userData.cartData || {}
    });

  } catch (error) {
    console.error('Get user cart error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Sync localStorage cart to database
const syncLocalCart = async (req, res) => {
  try {
    const { cartData } = req.body;
    const userId = resolveCartUserId(req, res);
    if (!userId) return;

    if (!cartData || typeof cartData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'cartData is required'
      });
    }

    const userData = await userModel.findById(userId);
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user's cart data in database
    await userModel.findByIdAndUpdate(userId, { cartData });

    res.json({
      success: true,
      message: 'Cart synced successfully',
      cartData
    });

  } catch (error) {
    console.error('Sync local cart error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

export { addToCart, updateCart, getUserCart, syncLocalCart }
