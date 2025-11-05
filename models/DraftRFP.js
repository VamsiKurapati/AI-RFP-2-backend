const mongoose = require('mongoose');

const DraftRFPSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    rfpId: { type: mongoose.Schema.Types.ObjectId, ref: "RFP", required: true },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal", required: false, default: null },
    rfp: {
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
        contact: String,
        timeline: String
    },
    generatedProposal: { type: Object, required: false, default: null },
    docx_base64: { type: String, default: null },
    currentEditor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Database indexes for performance optimization
DraftRFPSchema.index({ userEmail: 1 });
DraftRFPSchema.index({ rfpId: 1 });
DraftRFPSchema.index({ proposalId: 1 });
DraftRFPSchema.index({ currentEditor: 1 });
DraftRFPSchema.index({ createdAt: -1 });
// Compound index for common query patterns
DraftRFPSchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.models.DraftRFP || mongoose.model('DraftRFP', DraftRFPSchema);
