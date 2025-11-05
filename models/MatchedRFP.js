const mongoose = require('mongoose');

const matchedRFPSchema = new mongoose.Schema({
  title: String,
  description: String,
  logo: String,
  match: Number,
  budget: String,
  deadline: String,
  organization: String,
  fundingType: String,
  organizationType: String,
  link: String,
  type: String,
  contact: String,
  timeline: String,
  baseType: {
    type: String,
    default: "Not specified"
  },
  setAside: {
    type: String,
    default: "Not specified"
  },
  solicitationNumber: {
    type: String,
    default: "Not specified"
  },
  email: { type: String, required: true },
}, {
  timestamps: true
});

// Database indexes for performance optimization
matchedRFPSchema.index({ email: 1 });
matchedRFPSchema.index({ match: -1 });
matchedRFPSchema.index({ organizationType: 1 });
matchedRFPSchema.index({ fundingType: 1 });
matchedRFPSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
matchedRFPSchema.index({ email: 1, match: -1 });
matchedRFPSchema.index({ email: 1, createdAt: -1 });
matchedRFPSchema.index({ organizationType: 1, match: -1 });

module.exports = mongoose.model('MatchedRFP', matchedRFPSchema);
