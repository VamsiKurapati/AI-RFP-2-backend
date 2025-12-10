const mongoose = require('mongoose');

const CompetitorAnalysisCacheSchema = new mongoose.Schema({
    rfpTitle: {
        type: String,
        required: true,
        unique: true
    },
    analysisData: {
        type: Object,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 } // MongoDB TTL index for automatic cleanup
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('CompetitorAnalysisCache', CompetitorAnalysisCacheSchema);

