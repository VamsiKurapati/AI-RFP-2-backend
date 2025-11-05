const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  onboarding_status: { type: Boolean, default: false },
  mobile: { type: String, required: true },
  role: { type: String, enum: ["SuperAdmin", "company", "employee",], required: true },
  subscription_status: { type: String, enum: ["active", "inactive", "expired"], default: "inactive" },
  subscription_id: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },
  stripeCustomerId: { type: String, default: null },
  stripeSubscriptionId: { type: String, default: null },
  payment_method_id: { type: String, default: null }
}, { timestamps: true });

// Database indexes for performance optimization
// Note: email index is automatically created by unique: true
userSchema.index({ role: 1 });
userSchema.index({ subscription_status: 1 });
userSchema.index({ stripeCustomerId: 1 });
userSchema.index({ stripeSubscriptionId: 1 });
userSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
userSchema.index({ subscription_status: 1, role: 1 });

module.exports = mongoose.model("User", userSchema);
