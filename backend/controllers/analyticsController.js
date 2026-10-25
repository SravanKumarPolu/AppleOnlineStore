import { UserActivity, ProductPerformance, SearchAnalytics } from '../models/analyticsModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';

// Track user activity
export const trackUserActivity = async (req, res) => {
  try {
    const { action, productId, category, searchQuery, sessionId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const activityData = {
      userId,
      action,
      productId,
      category,
      searchQuery,
      sessionId,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress
    };

    await UserActivity.trackActivity(activityData);

    res.status(200).json({ message: 'Activity tracked successfully' });
  } catch (error) {
    console.error('Error tracking user activity:', error);
    res.status(500).json({ message: 'Error tracking activity' });
  }
};

// Get sales analytics
export const getSalesAnalytics = async (req, res) => {
  try {
    console.log('📊 Sales analytics request started');
    console.log('🔐 User from middleware:', req.user);
    console.log('📝 Query params:', req.query);
    
    const { startDate, endDate } = req.query;
    
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      // Default to last 30 days
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 30);
    }

    console.log('📅 Date range - Start:', start, 'End:', end);

    // Get sales data from orders
    console.log('📈 Fetching sales data...');
    const salesData = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          totalSales: { $sum: "$total" },
          totalOrders: { $sum: 1 },
          totalProducts: { $sum: { $size: "$items" } },
          averageOrderValue: { $avg: "$total" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    console.log('📈 Sales data count:', salesData.length);

    // Get category breakdown
    console.log('📊 Fetching category breakdown...');
    const categoryBreakdown = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $unwind: "$items"
      },
      {
        // K-12 fix: order items store productId as a STRING (per
        // orderModel.orderItemSchema) while products._id is an ObjectId, so a
        // direct localField/foreignField join never matches across BSON types
        // and the category breakdown was always []. Normalize the join key to
        // ObjectId first — $convert tolerates legacy ObjectId values,
        // non-ObjectId garbage (onError) and null/missing ids (onNull) by
        // producing null, which simply never joins.
        $addFields: {
          productObjectId: {
            $convert: {
              input: '$items.productId',
              to: 'objectId',
              onError: null,
              onNull: null
            }
          }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'productObjectId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $unwind: "$product"
      },
      {
        $group: {
          _id: "$product.category",
          sales: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          orders: { $addToSet: "$_id" },
          products: { $sum: "$items.quantity" }
        }
      },
      {
        $project: {
          category: "$_id",
          sales: 1,
          orders: { $size: "$orders" },
          products: 1
        }
      }
    ]);
    console.log('📊 Category breakdown count:', categoryBreakdown.length);

    // Get payment method breakdown
    console.log('💳 Fetching payment breakdown...');
    const paymentBreakdown = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $group: {
          _id: "$paymentMethod",
          count: { $sum: 1 },
          total: { $sum: "$total" }
        }
      }
    ]);
    console.log('💳 Payment breakdown count:', paymentBreakdown.length);

    // Get order status breakdown
    console.log('📋 Fetching status breakdown...');
    const statusBreakdown = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          isActive: true
        }
      },
      {
        $group: {
          _id: "$orderStatus",
          count: { $sum: 1 }
        }
      }
    ]);
    console.log('📋 Status breakdown count:', statusBreakdown.length);

    // Calculate summary statistics
    console.log('📊 Fetching summary statistics...');
    const summary = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: "$total" },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: "$total" },
          totalProducts: { $sum: { $size: "$items" } }
        }
      }
    ]);
    console.log('📊 Summary statistics:', summary);

    const responseData = {
      salesData,
      categoryBreakdown,
      paymentBreakdown,
      statusBreakdown,
      summary: summary[0] || {
        totalSales: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        totalProducts: 0
      },
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    };

    console.log('✅ Sales analytics completed successfully');

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('❌ Error getting sales analytics:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching sales analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get product performance analytics
export const getProductPerformance = async (req, res) => {
  try {
    console.log('📊 Product performance request started');
    console.log('🔐 User from middleware:', req.user);
    console.log('📝 Query params:', req.query);
    
    const { limit = 10, metric = 'revenue', category } = req.query;

    let query = {};
    if (category) {
      query['productId.category'] = category;
    }

    console.log('📈 Fetching top products...');
    const topProducts = await ProductPerformance.find(query)
      .sort({ [metric]: -1 })
      .limit(parseInt(limit))
      .populate('productId', 'name price image category subCategory');

    // Filter out products with null productId (deleted products)
    const validTopProducts = topProducts.filter(product => 
      product.productId && 
      product.productId.name && 
      product.productId._id
    );
    
    console.log('📈 Valid top products count:', validTopProducts.length, 'of', topProducts.length);

    // Get overall product statistics
    console.log('📊 Fetching product statistics...');
    const productStats = await ProductPerformance.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $match: {
          'product.0': { $exists: true } // Only include records with valid product references
        }
      },
      {
        $group: {
          _id: null,
          totalViews: { $sum: "$views" },
          totalAddToCart: { $sum: "$addToCartCount" },
          totalPurchases: { $sum: "$purchaseCount" },
          totalRevenue: { $sum: "$revenue" },
          averageConversionRate: { $avg: "$conversionRate" }
        }
      }
    ]);

    // Get category performance
    console.log('📊 Fetching category performance...');
    const categoryPerformance = await ProductPerformance.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $match: {
          'product.0': { $exists: true } // Only include records with valid product references
        }
      },
      {
        $unwind: "$product"
      },
      {
        $group: {
          _id: "$product.category",
          totalViews: { $sum: "$views" },
          totalAddToCart: { $sum: "$addToCartCount" },
          totalPurchases: { $sum: "$purchaseCount" },
          totalRevenue: { $sum: "$revenue" },
          productCount: { $sum: 1 }
        }
      },
      {
        $sort: { totalRevenue: -1 }
      }
    ]);
    
    console.log('📊 Category performance count:', categoryPerformance.length);
    console.log('✅ Product performance completed successfully');

    res.status(200).json({
      success: true,
      data: {
        topProducts: validTopProducts,
        productStats: productStats[0] || {
          totalViews: 0,
          totalAddToCart: 0,
          totalPurchases: 0,
          totalRevenue: 0,
          averageConversionRate: 0
        },
        categoryPerformance
      }
    });
  } catch (error) {
    console.error('❌ Error getting product performance:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching product performance',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get user behavior analytics
export const getUserBehavior = async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;
    
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 30);
    }

    let query = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      query.userId = userId;
    }

    // Get activity breakdown by action
    const activityBreakdown = await UserActivity.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get daily activity
    const dailyActivity = await UserActivity.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Get most active users
    const activeUsers = await UserActivity.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: "$userId",
          activityCount: { $sum: 1 }
        }
      },
      {
        $sort: { activityCount: -1 }
      },
      {
        $limit: 10
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: "$user"
      },
      {
        $project: {
          userId: "$_id",
          name: "$user.name",
          email: "$user.email",
          activityCount: 1
        }
      }
    ]);

    // Get product interaction analytics
    const productInteractions = await UserActivity.aggregate([
      {
        $match: {
          ...query,
          productId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: "$productId",
          views: {
            $sum: {
              $cond: [{ $eq: ["$action", "view_product"] }, 1, 0]
            }
          },
          addToCart: {
            $sum: {
              $cond: [{ $eq: ["$action", "add_to_cart"] }, 1, 0]
            }
          },
          purchases: {
            $sum: {
              $cond: [{ $eq: ["$action", "purchase"] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { views: -1 }
      },
      {
        $limit: 10
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $unwind: "$product"
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        activityBreakdown,
        dailyActivity,
        activeUsers,
        productInteractions,
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error getting user behavior:', error);
    res.status(500).json({ message: 'Error fetching user behavior analytics' });
  }
};

// Get search analytics
export const getSearchAnalytics = async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;
    
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 30);
    }

    // Get popular searches
    const popularSearches = await SearchAnalytics.find({
      date: { $gte: start, $lte: end }
    })
    .sort({ count: -1 })
    .limit(parseInt(limit));

    // Get search trends over time
    const searchTrends = await SearchAnalytics.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$date" }
          },
          totalSearches: { $sum: "$count" },
          uniqueQueries: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Get category search breakdown
    const categorySearches = await SearchAnalytics.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end },
          category: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: "$category",
          totalSearches: { $sum: "$count" },
          uniqueQueries: { $sum: 1 }
        }
      },
      {
        $sort: { totalSearches: -1 }
      }
    ]);

    // Get search performance metrics
    const searchStats = await SearchAnalytics.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          totalSearches: { $sum: "$count" },
          uniqueQueries: { $sum: 1 },
          averageResults: { $avg: "$resultsCount" }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        popularSearches,
        searchTrends,
        categorySearches,
        searchStats: searchStats[0] || {
          totalSearches: 0,
          uniqueQueries: 0,
          averageResults: 0
        },
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error getting search analytics:', error);
    res.status(500).json({ message: 'Error fetching search analytics' });
  }
};

// Update product metrics (called when user interacts with products)
export const updateProductMetrics = async (productId, action) => {
  try {
    const metrics = {};
    
    switch (action) {
      case 'view':
        metrics.views = 1;
        break;
      case 'add_to_cart':
        metrics.addToCartCount = 1;
        break;
      case 'purchase':
        metrics.purchaseCount = 1;
        break;
    }

    if (Object.keys(metrics).length > 0) {
      await ProductPerformance.updateProductMetrics(productId, metrics);
    }
  } catch (error) {
    console.error('Error updating product metrics:', error);
  }
};

// Track search query
export const trackSearch = async (query, resultsCount, category = null) => {
  try {
    await SearchAnalytics.trackSearch(query, resultsCount, category);
  } catch (error) {
    console.error('Error tracking search:', error);
  }
};

// Get dashboard summary
export const getDashboardSummary = async (req, res) => {
  try {
    console.log('📊 Dashboard summary request started');
    console.log('🔐 User from middleware:', req.user);
    
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    console.log('📅 Date range - Today:', today, 'Last month:', lastMonth);

    // Get today's stats
    console.log('📈 Fetching today\'s stats...');
    const todayStats = await orderModel.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
            $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
          },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          sales: { $sum: "$total" },
          orders: { $sum: 1 }
        }
      }
    ]);
    console.log('📈 Today\'s stats result:', todayStats);

    // Get this month's stats
    console.log('📊 Fetching month\'s stats...');
    const monthStats = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: lastMonth },
          paymentStatus: 'completed',
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          sales: { $sum: "$total" },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: "$total" }
        }
      }
    ]);
    console.log('📊 Month\'s stats result:', monthStats);

    // Get total users
    console.log('👥 Fetching total users...');
    const totalUsers = await userModel.countDocuments();
    console.log('👥 Total users:', totalUsers);

    // Get total products
    console.log('📦 Fetching total products...');
    const totalProducts = await productModel.countDocuments();
    console.log('📦 Total products:', totalProducts);

    // Get recent orders
    console.log('📋 Fetching recent orders...');
    const recentOrders = await orderModel.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('userId', 'name email');
    console.log('📋 Recent orders count:', recentOrders.length);

    // Get low stock products
    console.log('⚠️ Fetching low stock products...');
    const lowStockProducts = await productModel.find({
      stockQuantity: { $lt: 10, $gt: 0 }
    })
    .limit(5)
    .select('name stockQuantity');
    console.log('⚠️ Low stock products count:', lowStockProducts.length);

    const responseData = {
      today: todayStats[0] || { sales: 0, orders: 0 },
      month: monthStats[0] || { sales: 0, orders: 0, averageOrderValue: 0 },
      totalUsers,
      totalProducts,
      recentOrders,
      lowStockProducts
    };

    console.log('✅ Dashboard summary completed successfully');
    
    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('❌ Error getting dashboard summary:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching dashboard summary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}; 

// Clean up orphaned analytics records
export const cleanupOrphanedAnalytics = async () => {
  try {
    console.log('🧹 Starting analytics cleanup...');
    
    // Clean up ProductPerformance records with null or invalid productId
    const orphanedProductPerformance = await ProductPerformance.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $match: {
          'product.0': { $exists: false } // Records with no matching product
        }
      },
      {
        $project: { _id: 1 }
      }
    ]);

    if (orphanedProductPerformance.length > 0) {
      const orphanedIds = orphanedProductPerformance.map(record => record._id);
      await ProductPerformance.deleteMany({ _id: { $in: orphanedIds } });
      console.log(`🧹 Removed ${orphanedProductPerformance.length} orphaned ProductPerformance records`);
    }

    // Clean up UserActivity records with invalid productId references
    const orphanedUserActivity = await UserActivity.aggregate([
      {
        $match: {
          productId: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $match: {
          'product.0': { $exists: false }
        }
      },
      {
        $project: { _id: 1 }
      }
    ]);

    if (orphanedUserActivity.length > 0) {
      const orphanedIds = orphanedUserActivity.map(record => record._id);
      await UserActivity.deleteMany({ _id: { $in: orphanedIds } });
      console.log(`🧹 Removed ${orphanedUserActivity.length} orphaned UserActivity records`);
    }

    console.log('✅ Analytics cleanup completed');
    return {
      productPerformanceRecordsRemoved: orphanedProductPerformance.length,
      userActivityRecordsRemoved: orphanedUserActivity.length
    };
  } catch (error) {
    console.error('❌ Error during analytics cleanup:', error);
    throw error;
  }
};

// API endpoint for manual cleanup (admin only)
export const cleanupAnalytics = async (req, res) => {
  try {
    console.log('🧹 Manual analytics cleanup requested by:', req.user?.email);
    const result = await cleanupOrphanedAnalytics();
    
    res.status(200).json({
      success: true,
      message: 'Analytics cleanup completed successfully',
      data: result
    });
  } catch (error) {
    console.error('❌ Error in manual analytics cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Error during analytics cleanup',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}; 