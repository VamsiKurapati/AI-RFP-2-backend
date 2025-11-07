const mongoose = require('mongoose');

const SavedRFPSchema = new mongoose.Schema({
  userEmail: { type: String, required: true },
  rfpId: { type: String, required: true },
  rfp: {
    title: String,
    description: String,
    logo: String,
    match: Number,
    budget: String,
    deadline: String,
    organization: String,
    organizationType: String,
    link: String,
    contact: String,
    docsLink: String,
    office: String,
    issuingOffice: String,
    country: String,
    state: String,
    baseType: String,
    setAside: String,
    solicitationNumber: String,
  }
}, { timestamps: true });

// Database indexes for performance optimization
SavedRFPSchema.index({ userEmail: 1 });
SavedRFPSchema.index({ rfpId: 1 });
SavedRFPSchema.index({ createdAt: -1 });
// Compound index for common query patterns
SavedRFPSchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.models.SavedRFP || mongoose.model('SavedRFP', SavedRFPSchema);
