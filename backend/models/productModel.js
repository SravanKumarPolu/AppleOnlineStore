import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    minlength: [2, 'Product name must be at least 2 characters long'],
    maxlength: [100, 'Product name cannot exceed 100 characters'],
    index: true // For search functionality
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    minlength: [10, 'Product description must be at least 10 characters long'],
    maxlength: [1000, 'Product description cannot exceed 1000 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0.01, 'Price must be greater than 0'],
    validate: {
      validator: function(value) {
        return value > 0;
      },
      message: 'Price must be a positive number'
    }
  },
  image: {
    type: [String],
    required: [true, 'At least one product image is required'],
    validate: {
      validator: function(images) {
        return images.length > 0 && images.length <= 4;
      },
      message: 'Product must have between 1 and 4 images'
    }
  },
  category: {
    type: String,
    required: [true, 'Product category is required'],
    trim: true,
    index: true // For filtering by category
  },
  subCategory: {
    type: String,
    required: [true, 'Product sub-category is required'],
    trim: true,
    index: true // For filtering by sub-category
  },
  color: {
    type: [String],
    required: [true, 'At least one color must be specified'],
    validate: {
      validator: function(colors) {
        const allowedColors = ["Black", "Black Titanium", "Desert Titanium", "Gold", "Pink", "Silver", "Teal", "Ultramarine", "White", "Yellow"];
        return colors.length > 0 && colors.every(color => allowedColors.includes(color));
      },
      message: 'Invalid color selection'
    }
  },
  bestseller: {
    type: Boolean,
    default: false,
    index: true // For filtering bestsellers
  },
  date: {
    type: Number,
    required: [true, 'Product date is required'],
    default: Date.now
  },
  inStock: {
    type: Boolean,
    default: true,
    index: true // For filtering available products
  },
  stockQuantity: {
    type: Number,
    default: 0,
    min: [0, 'Stock quantity cannot be negative']
  },
  ratings: {
    average: {
      type: Number,
      default: 0,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5']
    },
    count: {
      type: Number,
      default: 0,
      min: [0, 'Rating count cannot be negative']
    }
  },
  featured: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Create compound indexes for better query performance
productSchema.index({ category: 1, subCategory: 1 });
productSchema.index({ price: 1 });
productSchema.index({ bestseller: 1, featured: 1 });
productSchema.index({ inStock: 1, stockQuantity: 1 });
productSchema.index({ name: 'text', description: 'text' }); // Text search index

// Pre-save middleware to update stock status
productSchema.pre('save', function(next) {
  if (this.stockQuantity <= 0) {
    this.inStock = false;
  }
  next();
});

// Virtual for discounted price (if needed in future)
productSchema.virtual('discountedPrice').get(function() {
  return this.price; // Placeholder for future discount logic
});

// Instance method to update stock
productSchema.methods.updateStock = function(quantity) {
  this.stockQuantity += quantity;
  this.inStock = this.stockQuantity > 0;
  return this.save();
};

// Static method to find products in stock
productSchema.statics.findInStock = function() {
  return this.find({ inStock: true, stockQuantity: { $gt: 0 } });
};

// Static method to find bestsellers
productSchema.statics.findBestsellers = function() {
  return this.find({ bestseller: true });
};

// Transform output to clean up data
productSchema.methods.toJSON = function() {
  const product = this.toObject();
  delete product.__v;
  return product;
};

const productModel = mongoose.models.product || mongoose.model("product", productSchema);
export default productModel;
