import mongoose from "mongoose";

// User Activity Schema
const userActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: ['login', 'logout', 'view_product', 'add_to_cart', 'remove_from_cart', 'purchase', 'search', 'filter']
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'product',
    sparse: true
  },
  category: {
    type: String,
    sparse: true
  },
  searchQuery: {
    type: String,
    sparse: true
  },
  sessionId: {
    type: String,
    sparse: true
  },
  userAgent: {
    type: String,
    sparse: true
  },
  ipAddress: {
    type: String,
    sparse: true
  }
}, {
  timestamps: true
});

// Sales Analytics Schema
const salesAnalyticsSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  totalSales: {
    type: Number,
    required: true,
    default: 0
  },
  totalOrders: {
    type: Number,
    required: true,
    default: 0
  },
  averageOrderValue: {
    type: Number,
    required: true,
    default: 0
  },
  totalProducts: {
    type: Number,
    required: true,
    default: 0
  },
  categorySales: {
    type: Map,
    of: {
      sales: Number,
      orders: Number,
      products: Number
    },
    default: {}
  },
  paymentMethodBreakdown: {
    type: Map,
    of: Number,
    default: {}
  },
  orderStatusBreakdown: {
    type: Map,
    of: Number,
    default: {}
  }
}, {
  timestamps: true
});

// Product Performance Schema
const productPerformanceSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'product',
    required: true
  },
  views: {
    type: Number,
    default: 0
  },
  addToCartCount: {
    type: Number,
    default: 0
  },
  purchaseCount: {
    type: Number,
    default: 0
  },
  revenue: {
    type: Number,
    default: 0
  },
  conversionRate: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Search Analytics Schema
const searchAnalyticsSchema = new mongoose.Schema({
  query: {
    type: String,
    required: true
  },
  count: {
    type: Number,
    default: 1
  },
  resultsCount: {
    type: Number,
    default: 0
  },
  category: {
    type: String,
    sparse: true
  },
  date: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Create indexes for better performance
userActivitySchema.index({ userId: 1, createdAt: -1 });
userActivitySchema.index({ action: 1, createdAt: -1 });
userActivitySchema.index({ productId: 1, createdAt: -1 });

salesAnalyticsSchema.index({ date: -1 });
salesAnalyticsSchema.index({ 'categorySales.category': 1 });

productPerformanceSchema.index({ productId: 1 });
productPerformanceSchema.index({ views: -1 });
productPerformanceSchema.index({ revenue: -1 });

searchAnalyticsSchema.index({ query: 1 });
searchAnalyticsSchema.index({ count: -1 });
searchAnalyticsSchema.index({ date: -1 });

// Static methods for UserActivity
userActivitySchema.statics.trackActivity = function(data) {
  return this.create(data);
};

userActivitySchema.statics.getUserActivity = function(userId, options = {}) {
  const { page = 1, limit = 50, action } = options;
  const skip = (page - 1) * limit;
  
  let query = { userId };
  if (action) {
    query.action = action;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static methods for SalesAnalytics
salesAnalyticsSchema.statics.getDailySales = function(startDate, endDate) {
  return this.find({
    date: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ date: 1 });
};

salesAnalyticsSchema.statics.getSalesSummary = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        date: {
          $gte: startDate,
          $lte: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$totalSales' },
        totalOrders: { $sum: '$totalOrders' },
        averageOrderValue: { $avg: '$averageOrderValue' },
        totalProducts: { $sum: '$totalProducts' }
      }
    }
  ]);
};

// Static methods for ProductPerformance
productPerformanceSchema.statics.updateProductMetrics = function(productId, metrics) {
  return this.findOneAndUpdate(
    { productId },
    {
      $inc: {
        views: metrics.views || 0,
        addToCartCount: metrics.addToCartCount || 0,
        purchaseCount: metrics.purchaseCount || 0,
        revenue: metrics.revenue || 0
      },
      lastUpdated: new Date()
    },
    { upsert: true, new: true }
  );
};

productPerformanceSchema.statics.getTopProducts = function(limit = 10, metric = 'revenue') {
  const sortField = {};
  sortField[metric] = -1;
  
  return this.find()
    .sort(sortField)
    .limit(limit)
    .populate('productId', 'name price image category');
};

// Static methods for SearchAnalytics
searchAnalyticsSchema.statics.trackSearch = function(query, resultsCount, category = null) {
  return this.findOneAndUpdate(
    { query: query.toLowerCase() },
    {
      $inc: { count: 1 },
      $set: {
        resultsCount,
        category,
        date: new Date()
      }
    },
    { upsert: true, new: true }
  );
};

searchAnalyticsSchema.statics.getPopularSearches = function(limit = 10) {
  return this.find()
    .sort({ count: -1 })
    .limit(limit);
};

// Create models
const UserActivity = mongoose.models.UserActivity || mongoose.model('UserActivity', userActivitySchema);
const SalesAnalytics = mongoose.models.SalesAnalytics || mongoose.model('SalesAnalytics', salesAnalyticsSchema);
const ProductPerformance = mongoose.models.ProductPerformance || mongoose.model('ProductPerformance', productPerformanceSchema);
const SearchAnalytics = mongoose.models.SearchAnalytics || mongoose.model('SearchAnalytics', searchAnalyticsSchema);

export { UserActivity, SalesAnalytics, ProductPerformance, SearchAnalytics }; 