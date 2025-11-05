const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { createPaymentIntent, activateSubscription } = require('../controllers/stripeController');

// Simple token verification middleware
const verifyToken = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Missing or malformed token'
            });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Token is empty or incorrect'
            });
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Invalid token'
                });
            }

            //If the user is not a company, return error
            if (decoded.user.role !== "company") {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: User is not a company'
                });
            }

            req.user = decoded.user;
            next();
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// Apply authentication middleware to all routes
router.use(verifyToken);

// Payment Intent Routes
router.post('/create-payment-intent', createPaymentIntent);

// Subscription Management Routes
router.post('/activate-subscription', activateSubscription);

// Webhook Routes
// router.post('/webhook', handleWebhook);

module.exports = router; 