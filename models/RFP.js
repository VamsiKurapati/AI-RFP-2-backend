const mongoose = require('mongoose');

const RFPSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  solicitationNumber: { type: String, required: false, default: "Not specified" },
  baseType: { type: String, required: false, default: "Not specified" },
  setAside: { type: String, required: false, default: "Not specified" },
  logo: { type: String, required: false, default: null },
  budget: { type: String, required: false, default: "Not specified" },
  deadline: { type: String, required: false, default: "Not specified" },
  organization: { type: String, required: false, default: "Not specified" },
  organizationType: { type: String, required: false, default: "Not specified" },
  link: { type: String, required: false, default: "Not specified" },
  contact: { type: String, required: false, default: "Not specified" },
  office: { type: String, required: false, default: "Not specified" },
  issuingOffice: { type: String, required: false, default: "Not specified" },
  country: { type: String, required: false, default: "Not specified" },
  state: { type: String, required: false, default: "Not specified" },
  docsLink: { type: String, required: false, default: null },
}, {
  timestamps: true
});

// Database indexes for performance optimization
RFPSchema.index({ organizationType: 1 });
RFPSchema.index({ organization: 1 });
RFPSchema.index({ solicitationNumber: 1 });
RFPSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
RFPSchema.index({ organizationType: 1, createdAt: -1 });
RFPSchema.index({ solicitationNumber: 1, createdAt: -1 });

module.exports = mongoose.model('RFP', RFPSchema);
