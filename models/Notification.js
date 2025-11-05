const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  type:
    { type: String, required: true }, // e.g., "User", "Payment", "Support","Subscription" etc.
  title: { type: String, required: true },
  description: { type: String, required: true },
  created_at: { type: Date, default: Date.now } // e.g., "2hr ago", "1day 3hr ago"
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);