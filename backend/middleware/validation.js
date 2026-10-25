import { body, validationResult } from 'express-validator';

// Validation error handler
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Middleware to process FormData for product validation
export const processProductFormData = (req, res, next) => {
  try {
    // Convert string values to appropriate types for validation
    if (req.body.price) {
      req.body.price = parseFloat(req.body.price);
    }
    
    if (req.body.bestseller) {
      req.body.bestseller = req.body.bestseller === 'true' || req.body.bestseller === true;
    }
    
    if (req.body.color) {
      try {
        req.body.color = typeof req.body.color === 'string' ? JSON.parse(req.body.color) : req.body.color;
      } catch (e) {
        req.body.color = [];
      }
    }
    
    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Invalid form data format'
    });
  }
};

// User registration validation
export const validateUserRegistration = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  handleValidationErrors
];

// User login validation
export const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// Admin login validation
export const validateAdminLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// Product validation for FormData uploads
export const validateProduct = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  
  body('description')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Product description must be between 10 and 1000 characters'),
  
  body('price')
    .isFloat({ min: 0.01 })
    .withMessage('Price must be a positive number'),
  
  body('category')
    .trim()
    .isIn(['iPhone', 'iPad', 'Mac', 'Watch', 'AirPods', 'Accessories'])
    .withMessage('Category must be one of: iPhone, iPad, Mac, Watch, AirPods, Accessories'),
  
  body('subCategory')
    .trim()
    .isIn(['Pro', 'Air', 'Mini', 'Standard', 'Max', 'Ultra'])
    .withMessage('Sub-category must be one of: Pro, Air, Mini, Standard, Max, Ultra'),
  
  body('color')
    .isArray({ min: 1 })
    .withMessage('At least one color must be selected'),
  
  body('bestseller')
    .isBoolean()
    .withMessage('Bestseller must be a boolean value'),
  
  body('stockQuantity')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Stock quantity must be a non-negative integer'),
  
  handleValidationErrors
];

// Product ID validation
export const validateProductId = [
  body('productId')
    .isMongoId()
    .withMessage('Invalid product ID format'),
  
  handleValidationErrors
];

// Remove product validation
export const validateRemoveProduct = [
  body('id')
    .isMongoId()
    .withMessage('Invalid product ID format'),
  
  handleValidationErrors
]; 