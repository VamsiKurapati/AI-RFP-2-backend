const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: new Date() },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 10 * 60 * 1000), index: { expires: 0 } } // deletes document once expiresAt is reached
}, { timestamps: true });

module.exports = mongoose.model('OTP', otpSchema);