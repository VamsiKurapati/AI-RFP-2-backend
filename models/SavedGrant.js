const mongoose = require('mongoose');

const SavedGrantSchema = new mongoose.Schema({
    grantId: { type: mongoose.Schema.Types.ObjectId, ref: "Grant", required: true },
    userEmail: { type: String, required: true },
    grant_data: { type: Object, required: true },
}, { timestamps: true });

// Database indexes for performance optimization
SavedGrantSchema.index({ userEmail: 1 });
SavedGrantSchema.index({ grantId: 1 });
SavedGrantSchema.index({ createdAt: -1 });
// Compound index for common query patterns
SavedGrantSchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.model("SavedGrant", SavedGrantSchema);