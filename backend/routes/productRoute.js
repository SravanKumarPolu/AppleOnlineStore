import express from 'express';
import { addProduct, singleProduct, removeProduct, listProducts } from '../controllers/productController.js';
import { validateProduct, validateProductId, validateRemoveProduct, processProductFormData } from '../middleware/validation.js';
import { authAdmin } from '../middleware/auth.js';
import upload from '../middleware/multer.js';

const productRouter = express.Router();

// Public routes
productRouter.get('/list', listProducts);
productRouter.post('/single', validateProductId, singleProduct);

// Admin-only routes
productRouter.post('/add', authAdmin, upload.fields([
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 },
  { name: 'image3', maxCount: 1 },
  { name: 'image4', maxCount: 1 }
]), processProductFormData, validateProduct, addProduct);

productRouter.post('/remove', authAdmin, validateRemoveProduct, removeProduct);

export default productRouter;
