import { addToCart, updateCart, getUserCart, syncLocalCart } from "../controllers/cartController.js";
import authUser from '../middleware/auth.js';

import express from 'express'

const cartRouter = express.Router();

// Final gate Task 4 — cart data belongs to the authenticated shopper.
// authUser verifies the token and the controllers derive userId from
// req.user.id (never from the request body), closing the cross-user
// read/write hole (IDOR) these routes previously had.
cartRouter.post('/add', authUser, addToCart)
cartRouter.post('/get', authUser, getUserCart)
cartRouter.post('/update', authUser, updateCart)
cartRouter.post('/sync-local', authUser, syncLocalCart)
export default cartRouter;
