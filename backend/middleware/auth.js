import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';

const authUser = async (req, res, next) => {
  try {
    // Try to get token from multiple header formats
    let token = req.headers.token;
    
    // If not found in 'token' header, try 'authorization' header
    if (!token && req.headers.authorization) {
      if (req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7); // Remove 'Bearer ' prefix
      } else {
        token = req.headers.authorization;
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

      // Phase 3 security fix: shopper middleware must NEVER accept admin
      // tokens. Admin tokens (type:'admin', issued by POST /api/user/admin)
      // carry no user id and no tokenVersion binding — accepting them here
      // previously let them pass every authUser-protected route with
      // req.user.id = null, relying on each controller to reject the null id
      // individually. The boundary is now enforced centrally: admin tokens
      // are rejected with 403 before any shopper route logic runs.
      // (Admin-only routes use authAdmin; the admin analytics routes were
      // updated to drop their redundant authUser layer accordingly.)
      if (decoded.type === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin tokens cannot access shopper endpoints'
        });
      }

      // For regular user tokens
      const user = await userModel.findById(decoded.id);
      
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      // AF-2 session invalidation: reject tokens minted before the user's
      // current tokenVersion (bumped on password reset). Tokens without a
      // tv claim are legacy pre-AF-2 tokens and count as version 0, so the
      // rollout does not log out existing sessions until a reset occurs.
      const tokenTv = Number.isInteger(decoded.tv) ? decoded.tv : 0;
      const currentTv = user.tokenVersion ?? 0;
      if (tokenTv !== currentTv) {
        return res.status(401).json({
          success: false,
          message: 'Session expired, please login again'
        });
      }

      req.user = {
        id: user._id,
        email: user.email,
        role: user.role
      };

      next();

    } catch (tokenError) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Admin-only middleware
const authAdmin = async (req, res, next) => {
  try {
    // Try to get token from multiple header formats
    let token = req.headers.token;
    
    // If not found in 'token' header, try 'authorization' header
    if (!token && req.headers.authorization) {
      if (req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7); // Remove 'Bearer ' prefix
      } else {
        token = req.headers.authorization;
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      
      // Check if it's an admin token
      if (decoded.type === 'admin' && decoded.role === 'admin') {
        req.user = {
          id: null,
          email: decoded.email,
          role: 'admin'
        };
        return next();
      }

      // For regular user tokens, check if user has admin role
      if (decoded.id) {
        const user = await userModel.findById(decoded.id);
        
        if (!user || !user.isActive || user.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Admin privileges required.'
          });
        }

        req.user = {
          id: user._id,
          email: user.email,
          role: user.role
        };

        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });

    } catch (tokenError) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

  } catch (error) {
    console.error('Admin auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Both named and default exports are provided so route files can use either
// import style consistently (`import authUser from ...` / `import { authUser } from ...`).
export { authUser, authAdmin };
export default authUser; 