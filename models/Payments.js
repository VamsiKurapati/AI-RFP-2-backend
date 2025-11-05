const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  subscription_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subscription",
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: "USD"
  },
  status: {
    type: String,
    enum: ['Success', 'Failed', 'Pending', 'Refunded', 'Pending Refund', 'Failed - Refund Required'],
    required: true
  },
  paid_at: {
    type: Date,
    required: false,
    default: null
  },
  transaction_id: {
    type: String,
    required: false,
    default: null
  },
  companyName: {
    type: String,
    required: false,
    default: null
  },
  payment_method: {
    type: String,
    required: false,
    default: null
  },
  // Refund fields
  refund_id: {
    type: String,
    required: false,
    default: null
  },
  refunded_at: {
    type: Date,
    required: false,
    default: null
  },
  refund_reason: {
    type: String,
    required: false,
    default: null
  },
  failure_reason: {
    type: String,
    required: false,
    default: null
  }
}, { timestamps: true });

// Database indexes for performance optimization
paymentSchema.index({ user_id: 1 });
paymentSchema.index({ subscription_id: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ paid_at: 1 });
paymentSchema.index({ transaction_id: 1 });
paymentSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
paymentSchema.index({ user_id: 1, status: 1 });
paymentSchema.index({ status: 1, paid_at: -1 });
paymentSchema.index({ subscription_id: 1, status: 1 });
paymentSchema.index({ refund_id: 1 });
paymentSchema.index({ refunded_at: -1 });

module.exports = mongoose.model("Payment", paymentSchema);