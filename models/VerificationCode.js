const mongoose = require("mongoose");

const verificationCodeSchema = new mongoose.Schema({
    email: { type: String, required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("VerificationCode", verificationCodeSchema);