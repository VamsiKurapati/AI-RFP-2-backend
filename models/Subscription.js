const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  plan_name: { type: String, required: true },
  plan_price: { type: Number, required: true, min: 0 },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  canceled_at: { type: Date, default: null },
  renewal_date: { type: Date, default: null },
  max_editors: { type: Number, required: true, min: 0 },
  max_viewers: { type: Number, required: true, min: 0 },
  max_rfp_proposal_generations: { type: Number, required: true, min: 0 },
  current_rfp_proposal_generations: { type: Number, default: 0, min: 0 },
  max_grant_proposal_generations: { type: Number, required: true, min: 0 },
  current_grant_proposal_generations: { type: Number, default: 0, min: 0 },
  max_magic_brush_usage: { type: Number, required: true, min: 0 },
  current_magic_brush_usage: { type: Number, default: 0, min: 0 },
  max_image_generation_usage: { type: Number, required: true, min: 0 },
  current_image_generation_usage: { type: Number, default: 0, min: 0 },
  auto_renewal: { type: Boolean, default: true },
  stripeSubscriptionId: { type: String, default: null },
  stripePriceId: { type: String, default: null },
  stripeProductId: { type: String, required: true },
}, { timestamps: true });

// Database indexes for performance optimization
subscriptionSchema.index({ user_id: 1 });
subscriptionSchema.index({ plan_name: 1 });
subscriptionSchema.index({ end_date: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });
subscriptionSchema.index({ stripePriceId: 1 });
subscriptionSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
subscriptionSchema.index({ user_id: 1, end_date: -1 });
subscriptionSchema.index({ user_id: 1, auto_renewal: 1 }); // Recommended index for user subscription queries
subscriptionSchema.index({ plan_name: 1, end_date: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);