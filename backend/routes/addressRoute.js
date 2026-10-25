import express from 'express';
import { saveAddress } from '../controllers/addressController.js';
import { authUser } from '../middleware/auth.js';

const router = express.Router();

// POST /api/address/save — requires authentication (Final gate Task 4: was
// fully unauthenticated, allowing anonymous writes into the shared
// address collection). authUser: 401 without a valid shopper token.
router.post('/save', authUser, saveAddress);

export default router;
