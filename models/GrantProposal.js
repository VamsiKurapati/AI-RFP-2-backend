const mongoose = require('mongoose');

const GrantProposalSchema = new mongoose.Schema({
    grantId: { type: mongoose.Schema.Types.ObjectId, ref: "Grant", required: true },
    project_inputs: { type: Object, required: true },
    initialProposal: { type: Object, required: true },
    title: { type: String, required: true },
    client: { type: String, required: true },
    generatedProposal: { type: Object, default: null },
    docx_base64: { type: String, default: null },
    companyMail: { type: String, required: true },
    deadline: { type: Date, required: true },
    url: { type: String, required: false, default: "" },
    status: { type: String, required: true },
    submittedAt: { type: Date, default: Date.now },
    currentEditor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isSaved: { type: Boolean, default: false },
    savedAt: { type: Date, default: null },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isRestored: { type: Boolean, default: false },
    restoredAt: { type: Date, default: null },
    restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    restoredAt: { type: Date, default: null },
}, { timestamps: true });

// Database indexes for performance optimization
GrantProposalSchema.index({ grantId: 1 });
GrantProposalSchema.index({ companyMail: 1 });
GrantProposalSchema.index({ status: 1 });
GrantProposalSchema.index({ currentEditor: 1 });
GrantProposalSchema.index({ isDeleted: 1 });
GrantProposalSchema.index({ isSaved: 1 });
GrantProposalSchema.index({ deadline: 1 });
GrantProposalSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
GrantProposalSchema.index({ companyMail: 1, status: 1 });
GrantProposalSchema.index({ companyMail: 1, isDeleted: 1 });
GrantProposalSchema.index({ companyMail: 1, createdAt: -1 });

module.exports = mongoose.model("GrantProposal", GrantProposalSchema);