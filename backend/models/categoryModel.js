import mongoose from 'mongoose';

const subCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  subCategories: [subCategorySchema]
}, { timestamps: true });

// Index for better query performance
categorySchema.index({ isActive: 1, sortOrder: 1 });
// NOTE: `name` must NOT be re-declared here. The field already carries
// `unique: true`, which creates the `name_1` index; a second plain
// `index({ name: 1 })` collided with it (same auto-generated name, different
// uniqueness) and made Model.init() fail — caught by the readiness change that
// awaits index construction before the server listens.

// Static method to get active categories
categorySchema.statics.getActiveCategories = function() {
  return this.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .select('-__v');
};

// Instance method to add subcategory
categorySchema.methods.addSubCategory = function(subCategoryData) {
  this.subCategories.push(subCategoryData);
  return this.save();
};

// Instance method to update subcategory
categorySchema.methods.updateSubCategory = function(subCategoryName, updateData) {
  const subCategory = this.subCategories.find(sub => sub.name === subCategoryName);
  if (subCategory) {
    Object.assign(subCategory, updateData);
    return this.save();
  }
  throw new Error('Subcategory not found');
};

// Instance method to remove subcategory
categorySchema.methods.removeSubCategory = function(subCategoryName) {
  this.subCategories = this.subCategories.filter(sub => sub.name !== subCategoryName);
  return this.save();
};

const categoryModel = mongoose.model('Category', categorySchema);

export default categoryModel; 