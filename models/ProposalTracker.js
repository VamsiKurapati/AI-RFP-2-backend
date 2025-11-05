const mongoose = require('mongoose');

const ProposalTrackerSchema = new mongoose.Schema({
    rfpId: { type: mongoose.Schema.Types.ObjectId, ref: "RFP", required: false, default: null },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal", required: false, default: null },
    grantId: { type: mongoose.Schema.Types.ObjectId, ref: "Grant", required: false, default: null },
    grantProposalId: { type: mongoose.Schema.Types.ObjectId, ref: "GrantProposal", required: false, default: null },
    companyMail: { type: String, required: true },
    status: { type: String, required: true },
    trackingId: { type: String, required: true },
    formData: { type: Object, required: false, default: null }
}, { timestamps: true });

// Database indexes for performance optimization
ProposalTrackerSchema.index({ rfpId: 1 });
ProposalTrackerSchema.index({ proposalId: 1 });
ProposalTrackerSchema.index({ grantId: 1 });
ProposalTrackerSchema.index({ grantProposalId: 1 });
ProposalTrackerSchema.index({ createdAt: -1 });
// Compound index for common query patterns
ProposalTrackerSchema.index({ rfpId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ proposalId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ grantId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ grantProposalId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ companyMail: 1, createdAt: -1 });
ProposalTrackerSchema.index({ status: 1, createdAt: -1 });
ProposalTrackerSchema.index({ trackingId: 1, createdAt: -1 });
// Compound index for common query patterns
ProposalTrackerSchema.index({ rfpId: 1, proposalId: 1, grantId: 1, grantProposalId: 1, companyMail: 1, status: 1, trackingId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ proposalId: 1, grantId: 1, grantProposalId: 1, companyMail: 1, status: 1, trackingId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ grantId: 1, grantProposalId: 1, companyMail: 1, status: 1, trackingId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ grantProposalId: 1, companyMail: 1, status: 1, trackingId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ companyMail: 1, status: 1, trackingId: 1, createdAt: -1 });
ProposalTrackerSchema.index({ status: 1, trackingId: 1, createdAt: -1 });

module.exports = mongoose.model('ProposalTracker', ProposalTrackerSchema);
