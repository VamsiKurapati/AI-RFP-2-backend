const axios = require('axios');
const dotenv = require('dotenv');
const pako = require('pako');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
dotenv.config();

const Grant = require('../models/Grant');
const Support = require('../models/Support');
const RFP = require('../models/RFP');
const DraftRFP = require('../models/DraftRFP');
const Proposal = require('../models/Proposal');
const ProposalTracker = require('../models/ProposalTracker');
const GrantProposal = require('../models/GrantProposal');
const DraftGrant = require('../models/DraftGrant');
const Payment = require('../models/Payments');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const CompanyProfile = require('../models/CompanyProfile');

//Trigger Grant Cron Job to fetch Grants from the Grant API and save them to the database
exports.fetchGrants = async () => {
    try {
        console.log('Starting grant fetch cron job...');
        const grants = await axios.get(`${process.env.PIPELINE_URL}/grants/getGrants`);

        const grants_data = grants.data;
        console.log(`Fetched ${grants_data.length} grants from API`);

        await Promise.all(grants_data.map(async (grant) => {
            //check if the grant is already in the database
            const existingGrant = await Grant.findOne({ OPPORTUNITY_NUMBER: grant.OPPORTUNITY_NUMBER });
            if (existingGrant) {
                await Grant.findByIdAndUpdate(existingGrant._id, {
                    OPPORTUNITY_ID: grant.OPPORTUNITY_ID || existingGrant.OPPORTUNITY_ID,
                    OPPORTUNITY_NUMBER_LINK: grant.OPPORTUNITY_NUMBER_LINK || existingGrant.OPPORTUNITY_NUMBER_LINK,
                    OPPORTUNITY_TITLE: grant.OPPORTUNITY_TITLE || existingGrant.OPPORTUNITY_TITLE,
                    AGENCY_CODE: grant.AGENCY_CODE || existingGrant.AGENCY_CODE,
                    AGENCY_NAME: grant.AGENCY_NAME || existingGrant.AGENCY_NAME,
                    CATEGORY_OF_FUNDING_ACTIVITY: grant.CATEGORY_OF_FUNDING_ACTIVITY || existingGrant.CATEGORY_OF_FUNDING_ACTIVITY,
                    FUNDING_CATEGORY_EXPLANATION: grant.FUNDING_CATEGORY_EXPLANATION || existingGrant.FUNDING_CATEGORY_EXPLANATION,
                    FUNDING_INSTRUMENT_TYPE: grant.FUNDING_INSTRUMENT_TYPE || existingGrant.FUNDING_INSTRUMENT_TYPE,
                    ASSISTANCE_LISTINGS: grant.ASSISTANCE_LISTINGS || existingGrant.ASSISTANCE_LISTINGS,
                    ESTIMATED_TOTAL_FUNDING: grant.ESTIMATED_TOTAL_FUNDING || existingGrant.ESTIMATED_TOTAL_FUNDING,
                    EXPECTED_NUMBER_OF_AWARDS: grant.EXPECTED_NUMBER_OF_AWARDS || existingGrant.EXPECTED_NUMBER_OF_AWARDS,
                    AWARD_CEILING: grant.AWARD_CEILING || existingGrant.AWARD_CEILING,
                    AWARD_FLOOR: grant.AWARD_FLOOR || existingGrant.AWARD_FLOOR,
                    COST_SHARING_MATCH_REQUIRMENT: grant.COST_SHARING_MATCH_REQUIRMENT || existingGrant.COST_SHARING_MATCH_REQUIRMENT,
                    LINK_TO_ADDITIONAL_INFORMATION: grant.LINK_TO_ADDITIONAL_INFORMATION || existingGrant.LINK_TO_ADDITIONAL_INFORMATION,
                    GRANTOR_CONTACT: grant.GRANTOR_CONTACT || existingGrant.GRANTOR_CONTACT,
                    GRANTOR_CONTACT_PHONE: grant.GRANTOR_CONTACT_PHONE || existingGrant.GRANTOR_CONTACT_PHONE,
                    GRANTOR_CONTACT_EMAIL: grant.GRANTOR_CONTACT_EMAIL || existingGrant.GRANTOR_CONTACT_EMAIL,
                    ESTIMATED_POST_DATE: grant.ESTIMATED_POST_DATE || existingGrant.ESTIMATED_POST_DATE,
                    ESTIMATED_APPLICATION_DUE_DATE: grant.ESTIMATED_APPLICATION_DUE_DATE || existingGrant.ESTIMATED_APPLICATION_DUE_DATE,
                    POSTED_DATE: grant.POSTED_DATE || existingGrant.POSTED_DATE,
                    CLOSE_DATE: grant.CLOSE_DATE || existingGrant.CLOSE_DATE,
                    OPPORTUNITY_STATUS: grant.OPPORTUNITY_STATUS || existingGrant.OPPORTUNITY_STATUS,
                    FUNDING_DESCRIPTION: grant.FUNDING_DESCRIPTION || existingGrant.FUNDING_DESCRIPTION,
                    ELIGIBLE_APPLICANTS: grant.ELIGIBLE_APPLICANTS || existingGrant.ELIGIBLE_APPLICANTS,
                });
            } else {
                await Grant.create({
                    OPPORTUNITY_NUMBER: grant.OPPORTUNITY_NUMBER,
                    OPPORTUNITY_ID: grant.OPPORTUNITY_ID,
                    OPPORTUNITY_NUMBER_LINK: grant.OPPORTUNITY_NUMBER_LINK,
                    OPPORTUNITY_TITLE: grant.OPPORTUNITY_TITLE,
                    AGENCY_CODE: grant.AGENCY_CODE,
                    AGENCY_NAME: grant.AGENCY_NAME,
                    CATEGORY_OF_FUNDING_ACTIVITY: grant.CATEGORY_OF_FUNDING_ACTIVITY,
                    FUNDING_CATEGORY_EXPLANATION: grant.FUNDING_CATEGORY_EXPLANATION,
                    FUNDING_INSTRUMENT_TYPE: grant.FUNDING_INSTRUMENT_TYPE,
                    ASSISTANCE_LISTINGS: grant.ASSISTANCE_LISTINGS,
                    ESTIMATED_TOTAL_FUNDING: grant.ESTIMATED_TOTAL_FUNDING,
                    EXPECTED_NUMBER_OF_AWARDS: grant.EXPECTED_NUMBER_OF_AWARDS,
                    AWARD_CEILING: grant.AWARD_CEILING,
                    AWARD_FLOOR: grant.AWARD_FLOOR,
                    COST_SHARING_MATCH_REQUIRMENT: grant.COST_SHARING_MATCH_REQUIRMENT,
                    LINK_TO_ADDITIONAL_INFORMATION: grant.LINK_TO_ADDITIONAL_INFORMATION,
                    GRANTOR_CONTACT: grant.GRANTOR_CONTACT,
                    GRANTOR_CONTACT_PHONE: grant.GRANTOR_CONTACT_PHONE,
                    GRANTOR_CONTACT_EMAIL: grant.GRANTOR_CONTACT_EMAIL,
                    ESTIMATED_POST_DATE: grant.ESTIMATED_POST_DATE,
                    ESTIMATED_APPLICATION_DUE_DATE: grant.ESTIMATED_APPLICATION_DUE_DATE,
                    POSTED_DATE: grant.POSTED_DATE,
                    CLOSE_DATE: grant.CLOSE_DATE,
                    OPPORTUNITY_STATUS: grant.OPPORTUNITY_STATUS || "Posted",
                    FUNDING_DESCRIPTION: grant.FUNDING_DESCRIPTION,
                    ELIGIBLE_APPLICANTS: grant.ELIGIBLE_APPLICANTS,
                });
            }
        }));
        console.log('Grants fetched successfully and saved to the database');
        return { message: "Grants fetched successfully" };
    } catch (err) {
        console.error('Error in fetchGrants cron job:', err);
        console.error('Error stack:', err.stack);
        return { message: err.message || 'Failed to trigger grants' };
    }
};

// Priority Cron Job to update the priority of the support tickets in the database
exports.priorityCronJob = async () => {
    try {
        //Get all support tickets and update the priority of the ticket to "Medium" if ticket.createdAt is more than 1 day and "High" if ticket.createdAt is more than 48 hours
        const supportTickets = await Support.find().sort({ createdAt: -1 });
        console.log(`Found ${supportTickets.length} support tickets to update priority`);
        await Promise.all(
            supportTickets.map(async ticket => {
                const createdAt = new Date(ticket.createdAt);
                const now = new Date();
                const diffTime = Math.abs(now - createdAt);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let priority;
                if (diffDays > 2) {
                    priority = "Low";
                } else if (diffDays > 1) {
                    priority = "Medium";
                } else {
                    priority = "High";
                }

                // Only update if priority has changed
                if (ticket.priority !== priority) {
                    ticket.priority = priority;
                    await ticket.save();
                }
            })
        );
        console.log('Priority updated successfully');
        return { message: "Priority updated successfully" };

    } catch (err) {
        console.error('Error in priorityCronJob:', err);
        return { message: err.message || "Error updating priority" };
    }
};

// Delete Expired Proposals and their associated files from GridFS Cron Job
exports.deleteExpiredProposals = async () => {

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of today

        // Find all proposals where restore_by is less than today and isDeleted is true
        const expiredProposals = await Proposal.find({
            isDeleted: true,
            $and: [
                { restoreBy: { $lt: today } },
                { restoreBy: { $ne: null } }
            ]
        });
        console.log(`Found ${expiredProposals.length} expired proposals to delete`);
        if (expiredProposals.length === 0) {
            return { message: "No expired proposals found" };
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Delete each expired proposal and its associated files
            await Promise.all(expiredProposals.map(async (proposal) => {
                try {
                    // Delete the proposal from database
                    await Proposal.deleteOne({ _id: proposal._id }, { session });

                    // Also delete the draft RFP
                    await DraftRFP.deleteOne({ proposalId: proposal._id }, { session });

                    // Also delete the proposal tracker
                    await ProposalTracker.deleteOne({ proposalId: proposal._id }, { session });

                } catch (err) {
                    console.error(`Failed to delete proposal ${proposal._id}:`, err.message);
                }
            }));

            await session.commitTransaction();
            console.log('Expired proposals deleted successfully');
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Error in deleteExpiredProposals service:', error);
        return { message: error.message || "Error deleting expired proposals" };
    }
};

// Delete Expired Grant Proposals and their associated files from GridFS Cron Job
exports.deleteExpiredGrantProposals = async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of today

        // Find all grant proposals where restore_by is less than today and isDeleted is true
        const expiredGrantProposals = await GrantProposal.find({
            isDeleted: true,
            $and: [
                { restoreBy: { $lt: today } },
                { restoreBy: { $ne: null } }
            ]
        });
        console.log(`Found ${expiredGrantProposals.length} expired grant proposals to delete`);
        if (expiredGrantProposals.length === 0) {
            return { message: "No expired grant proposals found" };
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Delete each expired grant proposal and its associated files
            await Promise.all(expiredGrantProposals.map(async (grantProposal) => {
                try {
                    // Delete the grant proposal from database
                    await GrantProposal.deleteOne({ _id: grantProposal._id }, { session });

                    // Also delete the draft grant proposal
                    await DraftGrant.deleteOne({ grantProposalId: grantProposal._id }, { session });
                    // Also delete the proposal tracker
                    await ProposalTracker.deleteOne({ grantProposalId: grantProposal._id }, { session });
                } catch (err) {
                    console.error(`Failed to delete grant proposal ${grantProposal._id}:`, err.message);
                }
            }));

            await session.commitTransaction();
            console.log('Expired grant proposals deleted successfully');
            return { message: "Expired grant proposals deleted successfully" };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Error in deleteExpiredGrantProposals service:', error);
        return { message: error.message || "Error deleting expired grant proposals" };
    }
};

// Fetch RFPs Cron Job to fetch the RFPs from the RFP API and save them to the database
exports.fetchRFPs = async () => {
    try {
        //Fetch RFPs from the RFP API and save them to the database
        console.log('Starting RFP fetch cron job...');
        const response = await axios.get(`${process.env.PIPELINE_URL}/rfp/getRFPs`, {
            responseType: 'arraybuffer' // This ensures we get binary data for decompression
        });
        //We will receive compressed data, so we need to decompress it
        let decompressedData;
        try {
            const uint8Array = new Uint8Array(response.data);

            // Decompress using pako
            const decompressed = pako.ungzip(uint8Array, { to: 'string' });

            // Parse the decompressed string as JSON
            const jsonData = JSON.parse(decompressed);

            decompressedData = jsonData;
        } catch (error) {
            // If decompression fails, throw an error
            throw new Error(error.message);
        }

        const rfp_data = decompressedData;

        //Check if the RFPs are already in the database and if not then save them else update them
        await Promise.all(rfp_data.map(async (rfp) => {
            const existingRFP = await RFP.findOne({ solicitationNumber: rfp.solicitation_number });
            if (existingRFP) {
                await RFP.findByIdAndUpdate(existingRFP._id, {
                    title: rfp.title,
                    description: rfp.description,
                    baseType: rfp.BaseType,
                    setAside: rfp.SetASide,
                    logo: rfp.logo,
                    budget: rfp.budget,
                    deadline: rfp.deadline,
                    organization: rfp.organization,
                    fundingType: rfp.fundingType,
                    organizationType: rfp.organizationType,
                    link: rfp.link,
                    contact: rfp.contact,
                    timeline: rfp.timeline,
                    solicitationNumber: rfp.solicitation_number,
                });
            } else {
                await RFP.create({
                    title: rfp.title,
                    description: rfp.description,
                    baseType: rfp.BaseType,
                    setAside: rfp.SetASide,
                    logo: rfp.logo,
                    budget: rfp.budget,
                    deadline: rfp.deadline,
                    organization: rfp.organization,
                    fundingType: rfp.fundingType,
                    organizationType: rfp.organizationType,
                    link: rfp.link,
                    contact: rfp.contact,
                    timeline: rfp.timeline,
                    solicitationNumber: rfp.solicitation_number,
                });
            }
        }));
        console.log('RFPs fetched successfully and saved to the database');
        return { message: "RFPs fetched successfully" };
    } catch (err) {
        console.error('Error in fetchRFPs service:', err);
        return { message: err.message || "Error fetching RFPs" };
    }
};

//Fetch RefundPayments Cron Job to fetch the RefundPayments from the database and update the status of the payment to "Refunded" if the payment is refunded
exports.fetchRefundPayments = async () => {
    try {
        const refundPayments = await Payment.find({ status: 'Pending Refund', refund_id: { $ne: null } });
        console.log(`Found ${refundPayments.length} refund payments to fetch`);
        await Promise.all(refundPayments.map(async (refundPayment) => {
            const refund = await stripe.refunds.retrieve(refundPayment.refund_id);
            if (refund.status === 'succeeded') {
                await Payment.findByIdAndUpdate(refundPayment._id, { status: 'Refunded', refunded_at: new Date() });
            } else if (refund.status === 'failed') {
                await Payment.findByIdAndUpdate(refundPayment._id, { status: 'Failed - Refund Required' });
            } else {
                await Payment.findByIdAndUpdate(refundPayment._id, { status: 'Pending Refund' });
            }
        }));
        console.log('Refund payments fetched successfully');
        return { message: "Refund payments fetched successfully" };
    } catch (error) {
        console.error('Error in fetchRefundPayments service:', error);
        return { message: error.message || "Error fetching refund payments" };
    }
};

//Update the users subscription status to Inactive if the subscriptions end date is less than today. Parallelly update the company profile's status to inactive
exports.updateSubscriptionStatus = async () => {
    try {
        const subscriptions = await Subscription.find();
        console.log(`Found ${subscriptions.length} subscriptions to update to inactive`);

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await Promise.all(subscriptions.map(async (subscription) => {
                if (subscription.end_date < new Date()) {
                    //Also update the user's subscription status to inactive
                    await User.findByIdAndUpdate(subscription.user_id, { subscription_status: 'inactive' }, { session });
                    //Also update the company profile's status to inactive
                    await CompanyProfile.findOneAndUpdate({ userId: subscription.user_id }, { status: 'Inactive' }, { session });
                } else {
                    //Also update the user's subscription status to active
                    await User.findByIdAndUpdate(subscription.user_id, { subscription_status: 'active' }, { session });
                    //Also update the company profile's status to active
                    await CompanyProfile.findOneAndUpdate({ userId: subscription.user_id }, { status: 'Active' }, { session });
                }
            }));

            await session.commitTransaction();
            console.log('Subscription status updated successfully');
            return { message: "Subscription status updated successfully" };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Error in updateSubscriptionStatus service:', error);
        return { message: error.message || "Error updating subscription status" };
    }
};

exports.resetFetchedMatchingRFPs = async () => {
    try {
        await CompanyProfile.updateMany({ fetchedMatchingRFPs: true }, { fetchedMatchingRFPs: false });
        console.log('Fetched matching RFPs reset successfully');
        return { message: "Fetched matching RFPs reset successfully" };
    } catch (error) {
        console.error('Error in resetFetchedMatchingRFPs service:', error);
        return { message: error.message || "Error resetting fetched matching RFPs" };
    }
};