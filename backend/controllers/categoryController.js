import categoryModel from "../models/categoryModel.js";
import mongoose from 'mongoose';

// Get all categories with their subcategories

// Escapes regex metacharacters so category names like ".*" are compared
// literally instead of acting as wildcards (duplicate-check bypass / ReDoS).
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const getCategories = async (req, res, next) => {
  try {
    console.log('🔍 Fetching categories...');
    console.log('Current DB:', mongoose.connection.name);
    
    const categories = await categoryModel.getActiveCategories();
    console.log('📂 Found categories:', categories.length);
    console.log('📂 Categories:', categories.map(c => ({ name: c.name, subCount: c.subCategories.length })));
    
    const response = {
      success: true,
      categories: categories
    };
    
    console.log('📤 Sending response with', categories.length, 'categories');
    
    res.json(response);
  } catch (error) {
    console.error('❌ Get categories error:', error);
    next(error);
  }
};

// Add a new category
const addCategory = async (req, res, next) => {
  try {
    const { name, description, subCategories = [], sortOrder = 0 } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category already exists
    const existingCategory = await categoryModel.findOne({ 
      name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') }
    });
    
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }

    // Create category data
    const categoryData = {
      name: name.trim(),
      description: description?.trim() || '',
      subCategories: subCategories.map(sub => ({
        name: sub.name.trim(),
        description: sub.description?.trim() || '',
        isActive: sub.isActive !== false,
        sortOrder: sub.sortOrder || 0
      })),
      sortOrder: Number(sortOrder) || 0
    };

    // Create and save category
    const category = new categoryModel(categoryData);
    await category.save();

    res.status(201).json({
      success: true,
      message: "Category added successfully",
      category: category
    });

  } catch (error) {
    console.error('Add category error:', error);
    next(error);
  }
};

// Update a category
const updateCategory = async (req, res, next) => {
  try {
    const { categoryId, name, description, subCategories, sortOrder, isActive } = req.body;
    
    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }

    // Find category
    const category = await categoryModel.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Check if new name conflicts with existing category
    if (name && name.toLowerCase() !== category.name.toLowerCase()) {
      const existingCategory = await categoryModel.findOne({ 
        name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') },
        _id: { $ne: categoryId }
      });
      
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Category name already exists'
        });
      }
    }

    // Update category
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update subcategories if provided
    if (subCategories !== undefined) {
      updateData.subCategories = subCategories.map(sub => ({
        name: sub.name.trim(),
        description: sub.description?.trim() || '',
        isActive: sub.isActive !== false,
        sortOrder: sub.sortOrder || 0
      }));
    }

    const updatedCategory = await categoryModel.findByIdAndUpdate(
      categoryId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Category updated successfully",
      category: updatedCategory
    });

  } catch (error) {
    console.error('Update category error:', error);
    next(error);
  }
};

// Delete a category
const deleteCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.body;
    
    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }

    // Check if category exists
    const category = await categoryModel.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Soft delete by setting isActive to false
    await categoryModel.findByIdAndUpdate(categoryId, { isActive: false });

    res.json({
      success: true,
      message: "Category deleted successfully"
    });

  } catch (error) {
    console.error('Delete category error:', error);
    next(error);
  }
};

// Add subcategory to existing category
const addSubCategory = async (req, res, next) => {
  try {
    const { categoryId, name, description, sortOrder = 0 } = req.body;
    
    if (!categoryId || !name) {
      return res.status(400).json({
        success: false,
        message: 'Category ID and subcategory name are required'
      });
    }

    // Find category
    const category = await categoryModel.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Check if subcategory already exists
    const existingSubCategory = category.subCategories.find(
      sub => sub.name.toLowerCase() === name.toLowerCase()
    );
    
    if (existingSubCategory) {
      return res.status(400).json({
        success: false,
        message: 'Subcategory already exists in this category'
      });
    }

    // Add subcategory
    await category.addSubCategory({
      name: name.trim(),
      description: description?.trim() || '',
      sortOrder: Number(sortOrder) || 0
    });

    res.json({
      success: true,
      message: "Subcategory added successfully",
      category: category
    });

  } catch (error) {
    console.error('Add subcategory error:', error);
    next(error);
  }
};

// Update subcategory
const updateSubCategory = async (req, res, next) => {
  try {
    const { categoryId, subCategoryName, newName, description, isActive, sortOrder } = req.body;
    
    if (!categoryId || !subCategoryName) {
      return res.status(400).json({
        success: false,
        message: 'Category ID and subcategory name are required'
      });
    }

    // Find category
    const category = await categoryModel.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Update subcategory
    const updateData = {};
    if (newName !== undefined) updateData.name = newName.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

    await category.updateSubCategory(subCategoryName, updateData);

    res.json({
      success: true,
      message: "Subcategory updated successfully",
      category: category
    });

  } catch (error) {
    console.error('Update subcategory error:', error);
    next(error);
  }
};

// Remove subcategory
const removeSubCategory = async (req, res, next) => {
  try {
    const { categoryId, subCategoryName } = req.body;
    
    if (!categoryId || !subCategoryName) {
      return res.status(400).json({
        success: false,
        message: 'Category ID and subcategory name are required'
      });
    }

    // Find category
    const category = await categoryModel.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Remove subcategory
    await category.removeSubCategory(subCategoryName);

    res.json({
      success: true,
      message: "Subcategory removed successfully",
      category: category
    });

  } catch (error) {
    console.error('Remove subcategory error:', error);
    next(error);
  }
};

export {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  addSubCategory,
  updateSubCategory,
  removeSubCategory
}; 