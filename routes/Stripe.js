const express = require('express');
const router = express.Router();

const { createPaymentIntent, activateSubscription, handleWebhook, createAddOnCheckoutSession, activateAddOnSubscription } = require('../controllers/stripeController');
const verifyUser = require('../utils/verifyUser');

// Apply authentication middleware to only create-payment-intent and activate-subscription routes
router.post('/create-checkout-session', verifyUser(["company"]), createPaymentIntent);
router.post('/activate-subscription', verifyUser(["company"]), activateSubscription);
router.post('/create-checkout-session-addOn', verifyUser(["company"]), createAddOnCheckoutSession);
router.post('/activate-addon-subscription', verifyUser(["company"]), activateAddOnSubscription);
router.post('/webhook', handleWebhook);

module.exports = router; 