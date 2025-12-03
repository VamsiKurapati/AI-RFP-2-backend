// // models/Proposal.js
const mongoose = require('mongoose');

const ProposalSchema = new mongoose.Schema({
  rfpId: { type: mongoose.Schema.Types.ObjectId, ref: "RFP", required: true },
  title: { type: String, required: true },
  client: { type: String, required: true },
  initialProposal: { type: Object, required: true, default: null },
  generatedProposal: { type: Object, default: null },
  docx_base64: { type: String, default: null },
  companyMail: { type: String, required: true },
  deadline: { type: Date, required: true },
  url: { type: String, required: false, default: "" },
  status: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now },
  noOfAttempts: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  restoreBy: { type: Date, default: null },
  restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  restoredAt: { type: Date, default: null },
  maxEditors: { type: Number, default: 0 },
  maxViewers: { type: Number, default: 0 },
  collaborators: {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Company email (owner)
    editors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }], // Array of editor emails
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }], // Array of viewer emails
  },
}, { timestamps: true });

// Database indexes for performance optimization
ProposalSchema.index({ rfpId: 1 });
ProposalSchema.index({ companyMail: 1 });
ProposalSchema.index({ status: 1 });
ProposalSchema.index({ isDeleted: 1 });
ProposalSchema.index({ deadline: 1 });
ProposalSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
ProposalSchema.index({ companyMail: 1, status: 1 });
ProposalSchema.index({ companyMail: 1, isDeleted: 1 });
ProposalSchema.index({ companyMail: 1, createdAt: -1 });
ProposalSchema.index({ "collaborators.owner": 1 });
ProposalSchema.index({ "collaborators.editors": 1 });
ProposalSchema.index({ "collaborators.viewers": 1 });

module.exports = mongoose.model('Proposal', ProposalSchema);
