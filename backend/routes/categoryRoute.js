import express from 'express';
import {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  addSubCategory,
  updateSubCategory,
  removeSubCategory
} from '../controllers/categoryController.js';
import { authAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get all categories (public endpoint — used by the storefront catalog)
router.get('/list', getCategories);

// Category CRUD operations (admin only — Final gate Task 4: the comments used
// to SAY admin-only while the routes had no middleware; authAdmin now enforces
// it: 401 unauthenticated, 403 authenticated non-admin)
router.post('/add', authAdmin, addCategory);
router.put('/update', authAdmin, updateCategory);
router.delete('/delete', authAdmin, deleteCategory);

// Subcategory operations (admin only)
router.post('/subcategory/add', authAdmin, addSubCategory);
router.put('/subcategory/update', authAdmin, updateSubCategory);
router.delete('/subcategory/remove', authAdmin, removeSubCategory);

export default router;
