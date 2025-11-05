// authRoute.js
const express = require('express');
const router = express.Router();

const { login, signupWithProfile, logout, forgotPassword, resetPassword, sendVerificationEmail, verifyEmail } = require('../controllers/authcontroller.js');

router.post('/login', login);
router.post('/signup', signupWithProfile);
router.post('/logout', logout);
router.post('/forgotPassword', forgotPassword);
router.post('/resetPassword', resetPassword);
router.post('/send-verification-email', sendVerificationEmail);
router.post('/verify-email-code', verifyEmail);

module.exports = router;
