const mongoose = require("mongoose");
// const User = require("./User");
const customPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, required: true, unique: true },
  price: { type: Number, required: true },
  planType: { type: String, required: true },
  maxEditors: { type: Number, required: true },
  maxViewers: { type: Number, required: true },
  maxRFPProposalGenerations: { type: Number, required: true },
  maxGrantProposalGenerations: { type: Number, required: true },
  maxMagicBrushUsage: { type: Number, required: true },
  maxImageGenerationUsage: { type: Number, required: true },
  status: { type: String, required: true, enum: ['payment_link_generated', 'paid', 'failed'] },  // Controlled values
  stripeCheckoutSessionId: { type: String },  // Save the session ID
  checkoutUrl: { type: String },              // Save the session URL
  paymentIntentId: { type: String },          // Optional: might not exist before payment
  paidAt: { type: Date },                    // Optional: only when paid
}, { timestamps: true });

// Database indexes for performance optimization
customPlanSchema.index({ userId: 1 });
// Note: email index is automatically created by unique: true
customPlanSchema.index({ status: 1 });
customPlanSchema.index({ createdAt: -1 });
// Compound index for common query patterns
customPlanSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CustomPlan", customPlanSchema);