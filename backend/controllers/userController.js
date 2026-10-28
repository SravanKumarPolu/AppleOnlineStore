import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import userModel from "../models/userModel.js";
import validator from 'validator';
import emailService from '../services/emailService.js';
import crypto from 'crypto';
import socketService from '../services/socketService.js';
import { revokeSession } from '../services/sessionRevocationService.js';

// JWT token creation with expiration. The `tv` claim pins the token to the
// user's tokenVersion at login; the auth middleware rejects tokens whose tv
// no longer matches (AF-2: password reset invalidates existing sessions).
// Legacy tokens signed before this change carry no tv and are treated as
// version 0.
const createToken = (id, tokenVersion = 0) => {
  return jwt.sign({ id, tv: tokenVersion, type: 'user' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
    jwtid: crypto.randomUUID(),
  });
};

// Route for user login
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Find user and include password field
    const user = await userModel.findOne({ email, isActive: true }).select('+password +loginAttempts +lockUntil');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid credentials" 
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: "Account is temporarily locked due to too many failed login attempts. Please try again later or reset your password."
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      // Increment login attempts
      await user.incrementLoginAttempts();
      
      return res.status(401).json({ 
        success: false, 
        message: "Invalid credentials" 
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Update last login
    await user.updateLastLogin();

    // Create token
    const token = createToken(user._id, user.tokenVersion ?? 0);
    
    res.json({ 
      success: true, 
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    next(error);
  }
};

// Route for user registration
const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await userModel.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email"
      });
    }

    // Additional server-side validation
    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long"
      });
    }

    // Check password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12); // Increased salt rounds
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new userModel({
      name: name.trim(),
      email: email.toLowerCase(),
      password: hashedPassword
    });

    const savedUser = await newUser.save();

    // Update last login
    await savedUser.updateLastLogin();

    // Send welcome email (non-blocking)
    emailService.sendWelcomeEmail(email, name).catch(error => {
      console.error('Error sending welcome email:', error);
    });

    // Create token
    const token = createToken(savedUser._id, savedUser.tokenVersion ?? 0);
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: savedUser._id,
        name: savedUser.name,
        email: savedUser.email,
        role: savedUser.role
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    next(error);
  }
};

// Route for password recovery request
const requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;
    const responseMessage = "If an account exists for this email, we'll attempt to send a reset link.";

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    // Find user by email
    const user = await userModel.findOne({ email, isActive: true }).select('+passwordResetToken +passwordResetExpires');
    
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(202).json({
        success: true,
        message: responseMessage
      });
    }

    // Create password reset token
    const resetToken = user.createPasswordResetToken();
    await user.save();

    // Send password reset email (K-4 fix). The service signature is
    // (email, name, resetToken) and it builds the reset link itself from
    // FRONTEND_URL + token — the raw token must go in the third argument,
    // NOT in the name slot (previously the token landed in the greeting and
    // the reset link was malformed).
    try {
      const emailAccepted = await emailService.sendPasswordResetEmail(email, user.name, resetToken);
      if (!emailAccepted) {
        await user.clearPasswordResetToken();
        console.error('Password reset email was not accepted by SMTP');
      }
    } catch {
      // Do not leave a usable token behind when its email could not be handed off.
      await user.clearPasswordResetToken();
      console.error('Password reset email handoff failed');
    }

    // Keep status and body identical for unknown, inactive, and existing
    // accounts; SMTP acceptance is not proof of inbox delivery.
    res.status(202).json({
      success: true,
      message: responseMessage
    });

  } catch (error) {
    console.error('Password reset request error:', error);
    next(error);
  }
};

// Route for password reset
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required"
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid reset token
    const user = await userModel.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    }).select('+password +passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset token"
      });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long"
      });
    }

    // Check password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and clear reset token
    user.password = hashedPassword;
    // AF-2: bumping tokenVersion invalidates every existing JWT for this
    // account (the auth middleware compares the token's tv claim against
    // the stored version), so a reset also logs out all other sessions.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.clearPasswordResetToken();
    socketService.revokeUserSessions(user._id, 'revoked');

    // Reset login attempts
    await user.resetLoginAttempts();

    res.json({
      success: true,
      message: "Password has been reset successfully"
    });

  } catch (error) {
    console.error('Password reset error:', error);
    next(error);
  }
};

// Route for admin login
const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizeAdminEmail = (value) =>
      typeof value === 'string' ? value.trim().toLowerCase() : '';
    const configuredAdminEmail = normalizeAdminEmail(process.env.ADMIN_EMAIL);
    const configuredAdminPassword = process.env.ADMIN_PASSWORD;

    // Validate environment variables
    if (
      !configuredAdminEmail ||
      typeof configuredAdminPassword !== 'string' ||
      configuredAdminPassword.trim().length === 0
    ) {
      return res.status(500).json({
        success: false,
        message: "Admin configuration error"
      });
    }

    // Check credentials
    const submittedAdminEmail = normalizeAdminEmail(email);
    if (submittedAdminEmail === configuredAdminEmail && password === configuredAdminPassword) {
      const token = jwt.sign(
        { 
          email: submittedAdminEmail,
          role: 'admin',
          type: 'admin' 
        }, 
        process.env.JWT_SECRET,
        { expiresIn: '1d', jwtid: crypto.randomUUID() } // Shorter expiration for admin
      );
      
      res.json({ 
        success: true, 
        token,
        user: {
          email: submittedAdminEmail,
          role: 'admin'
        }
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid admin credentials" 
      });
    }

  } catch (error) {
    console.error('Admin login error:', error);
    next(error);
  }
};

const logoutUser = async (req, res, next) => {
  try {
    const tokenId = req.auth?.tokenId;
    if (tokenId) {
      await revokeSession(tokenId, req.auth.expiresAt);
      socketService.revokeToken(tokenId, 'logout');
    } else {
      // Older shopper JWTs predate per-session ids. Invalidate those safely
      // by bumping the account version; new sessions use the targeted path.
      await userModel.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
      socketService.revokeUserSessions(req.user.id, 'logout');
    }

    return res.json({ success: true, message: 'Session ended' });
  } catch (error) {
    next(error);
  }
};

const logoutAdmin = async (req, res, next) => {
  try {
    await revokeSession(req.auth.tokenId, req.auth.expiresAt);
    socketService.revokeToken(req.auth.tokenId, 'logout');
    return res.json({ success: true, message: 'Session ended' });
  } catch (error) {
    next(error);
  }
};

// Route to get user profile
const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    next(error);
  }
};

// Route to update user profile
const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Validate email if provided
    if (email && !validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    // Check if email is already taken by another user
    if (email && email !== user.email) {
      const existingUser = await userModel.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email is already taken by another user"
        });
      }
    }

    // Update user fields
    if (name) user.name = name.trim();
    if (email) user.email = email.toLowerCase();

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    next(error);
  }
};

// Route to add user address
const addUserAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const addressData = req.body;

    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Set default address if it's the first one or if requested
    if (user.addresses.length === 0 || addressData.default) {
      user.addresses.forEach(addr => addr.default = false);
    }

    user.addresses.push(addressData);
    await user.save();

    res.json({
      success: true,
      message: "Address added successfully",
      addresses: user.addresses
    });

  } catch (error) {
    console.error('Add address error:', error);
    next(error);
  }
};

// Route to get user addresses
const getUserAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      addresses: user.addresses
    });

  } catch (error) {
    console.error('Get addresses error:', error);
    next(error);
  }
};

// Route to set default address
const setDefaultAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.body;

    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Reset all addresses to non-default
    user.addresses.forEach(addr => addr.default = false);

    // Set the specified address as default
    const address = user.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    address.default = true;
    await user.save();

    res.json({
      success: true,
      message: "Default address updated successfully",
      addresses: user.addresses
    });

  } catch (error) {
    console.error('Set default address error:', error);
    next(error);
  }
};

// Route to edit user address
const editUserAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;
    const addressData = req.body;

    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const address = user.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    // Update address fields
    Object.assign(address, addressData);
    await user.save();

    res.json({
      success: true,
      message: "Address updated successfully",
      addresses: user.addresses
    });

  } catch (error) {
    console.error('Edit address error:', error);
    next(error);
  }
};

// Route to delete user address
const deleteUserAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const user = await userModel.findById(userId);
    
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const address = user.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    address.deleteOne();
    await user.save();

    res.json({
      success: true,
      message: "Address deleted successfully",
      addresses: user.addresses
    });

  } catch (error) {
    console.error('Delete address error:', error);
    next(error);
  }
};

// Debug route to list all users (admin only).
// Phase 4: diagnostic endpoints are DISABLED in production unless explicitly
// opted back in with ENABLE_DEBUG_ENDPOINTS=true — this endpoint dumps user
// PII (names, emails, addresses, order history) and has no purpose in a
// production deployment. Non-production (development/test/staging) keeps the
// admin-only behavior.
const debugUsers = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }

    const users = await userModel.find({}).select('-password -passwordResetToken -passwordResetExpires -loginAttempts -lockUntil -twoFactorSecret -biometricCredentials');
    
    res.json({
      success: true,
      count: users.length,
      users: users
    });

  } catch (error) {
    console.error('Debug users error:', error);
    next(error);
  }
};

export {
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  adminLogin,
  logoutUser,
  logoutAdmin,
  getUserProfile,
  updateUserProfile,
  addUserAddress,
  getUserAddresses,
  setDefaultAddress,
  editUserAddress,
  deleteUserAddress,
  debugUsers
};