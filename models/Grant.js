const mongoose = require("mongoose");

const grantSchema = new mongoose.Schema({
    OPPORTUNITY_NUMBER: {
        type: String,
        default: "Not Provided"
    },
    OPPORTUNITY_ID: {
        type: String,
        default: "Not Provided"
    },
    OPPORTUNITY_NUMBER_LINK: {
        type: String,
        default: "Not Provided"
    },
    OPPORTUNITY_TITLE: {
        type: String,
        default: "Not Provided"
    },
    AGENCY_CODE: {
        type: String,
        default: "Not Provided"
    },
    AGENCY_NAME: {
        type: String,
        default: "Not Provided"
    },
    CATEGORY_OF_FUNDING_ACTIVITY: {
        type: String,
        default: "Not Provided"
    },
    FUNDING_CATEGORY_EXPLANATION: {
        type: String,
        default: "Not Provided"
    },
    FUNDING_INSTRUMENT_TYPE: {
        type: String,
        default: "Not Provided"
    },
    ASSISTANCE_LISTINGS: {
        type: String,
        default: "Not Provided"
    },
    ESTIMATED_TOTAL_FUNDING: {
        type: String,
        default: "Not Provided"
    },
    EXPECTED_NUMBER_OF_AWARDS: {
        type: String,
        default: "Not Provided"
    },
    AWARD_CEILING: {
        type: String,
        default: "Not Provided"
    },
    AWARD_FLOOR: {
        type: String,
        default: "Not Provided"
    },
    COST_SHARING_MATCH_REQUIRMENT: {
        type: String,
        default: "Not Provided"
    },
    LINK_TO_ADDITIONAL_INFORMATION: {
        type: String,
        default: "Not Provided"
    },
    GRANTOR_CONTACT: {
        type: String,
        default: "Not Provided"
    },
    GRANTOR_CONTACT_PHONE: {
        type: String,
        default: "Not Provided"
    },
    GRANTOR_CONTACT_EMAIL: {
        type: String,
        default: "Not Provided"
    },
    ESTIMATED_POST_DATE: {
        type: String,
        default: "Not Provided"
    },
    ESTIMATED_APPLICATION_DUE_DATE: {
        type: String,
        default: "Not Provided"
    },
    POSTED_DATE: {
        type: String,
        default: "Not Provided"
    },
    CLOSE_DATE: {
        type: String,
        default: "Not Provided"
    },
    OPPORTUNITY_STATUS: {
        type: String,
        enum: ["Posted", "Forecasted", "Closed", "Archived"]
    },
    FUNDING_DESCRIPTION: {
        type: String,
        default: "Not Provided"
    },
    ELIGIBLE_APPLICANTS: {
        type: String,
        default: "Not Provided"
    }
}, {
    timestamps: true
});

// Database indexes for performance optimization
grantSchema.index({ OPPORTUNITY_STATUS: 1 });
grantSchema.index({ AGENCY_CODE: 1 });
grantSchema.index({ AGENCY_NAME: 1 });
grantSchema.index({ CATEGORY_OF_FUNDING_ACTIVITY: 1 });
grantSchema.index({ ESTIMATED_TOTAL_FUNDING: 1 });
grantSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
grantSchema.index({ OPPORTUNITY_STATUS: 1, CATEGORY_OF_FUNDING_ACTIVITY: 1 });
grantSchema.index({ AGENCY_CODE: 1, OPPORTUNITY_STATUS: 1 });

module.exports = mongoose.model("Grant", grantSchema);
