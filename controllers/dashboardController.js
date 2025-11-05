const mongoose = require("mongoose");
const User = require("../models/User");
const CompanyProfile = require("../models/CompanyProfile");
const EmployeeProfile = require("../models/EmployeeProfile");
const Proposal = require("../models/Proposal");
const GrantProposal = require("../models/GrantProposal");
const CalendarEvent = require("../models/CalendarEvents");
const Subscription = require("../models/Subscription");
const DraftRFP = require("../models/DraftRFP");
const DraftGrant = require("../models/DraftGrant");
const ProposalTracker = require("../models/ProposalTracker");
const RFP = require("../models/RFP");
const MatchedRFP = require("../models/MatchedRFP");
const Grant = require("../models/Grant");

exports.getRFPData = async (req, res) => {
    const { rfpOrMatchedRFPId } = req.params;
    if (mongoose.Types.ObjectId.isValid(rfpOrMatchedRFPId)) {
        try {
            const rfp = await RFP.findById(rfpOrMatchedRFPId);
            if (!rfp) {
                const matchedRFP = await MatchedRFP.findOne({ _id: rfpOrMatchedRFPId });
                if (!matchedRFP) {
                    return res.status(404).json({ message: "RFP or Matched RFP not found" });
                }
                return res.status(200).json(matchedRFP);
            }
            return res.status(200).json(rfp);
        } catch (error) {
            return res.status(500).json({ message: "Error fetching RFP data" });
        }
    }
    return res.status(400).json({ message: "Invalid ID format" });
};

exports.getGrantData = async (req, res) => {
    const { grantId } = req.params;
    if (mongoose.Types.ObjectId.isValid(grantId)) {
        try {
            const grant = await Grant.findById(grantId);
            if (!grant) {
                return res.status(404).json({ message: "Grant not found" });
            }
            return res.status(200).json(grant);
        } catch (error) {
            return res.status(500).json({ message: "Error fetching Grant data" });
        }
    }
    return res.status(400).json({ message: "Invalid ID format" });
};


exports.getDashboardData = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const role = user.role;
        if (role === "company") {
            const companyProfile = await CompanyProfile.findOne({ userId: user._id });
            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }

            const proposals = await Proposal.find({ companyMail: companyProfile.email }).populate('currentEditor', '_id fullName email').sort({ createdAt: -1 });

            const grantProposals = await GrantProposal.find({ companyMail: companyProfile.email }).populate('currentEditor', '_id fullName email').sort({ createdAt: -1 });

            const totalProposals = proposals.length + grantProposals.length;
            const inProgressProposals = proposals.filter(proposal => proposal.status === "In Progress").length + grantProposals.filter(proposal => proposal.status === "In Progress").length;
            const wonProposals = proposals.filter(proposal => proposal.status === "Won").length + grantProposals.filter(proposal => proposal.status === "Won").length;
            const submittedProposals = proposals.filter(proposal => proposal.status === "Submitted").length + grantProposals.filter(proposal => proposal.status === "Submitted").length;

            const notDeletedProposals = proposals.filter(proposal => !proposal.isDeleted);

            const notDeletedGrantProposals = grantProposals.filter(proposal => !proposal.isDeleted);

            const deletedProposals = proposals.filter(proposal => proposal.isDeleted).map(proposal => {
                const proposalObj = proposal.toObject();
                return {
                    ...proposalObj,
                    restoreIn: (() => {
                        if (!proposal.restoreBy) return "No restore date";

                        const now = new Date();
                        const restoreDate = new Date(proposal.restoreBy);

                        if (isNaN(restoreDate.getTime())) return "Invalid restore date";

                        const diffTime = restoreDate.getTime() - now.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) {
                            return "Available for restoration";
                        } else if (diffDays === 1) {
                            return "1 day";
                        } else {
                            return `${diffDays} days`;
                        }
                    })()
                };
            });

            const deletedGrantProposals = grantProposals.filter(proposal => proposal.isDeleted).map(proposal => {
                const proposalObj = proposal.toObject();
                return {
                    ...proposalObj,
                    restoreIn: (() => {
                        if (!proposal.restoreBy) return "No restore date";

                        const now = new Date();
                        const restoreDate = new Date(proposal.restoreBy);

                        if (isNaN(restoreDate.getTime())) return "Invalid restore date";

                        const diffTime = restoreDate.getTime() - now.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) {
                            return "Available for restoration";
                        } else if (diffDays === 1) {
                            return "1 day";
                        } else {
                            return `${diffDays} days`;
                        }
                    })()
                };
            });

            const calendarEvents = await CalendarEvent.find({ companyId: companyProfile._id });

            const employees = companyProfile.employees || [];

            const subscription = await Subscription.find({ user_id: user._id }).sort({ created_at: -1 }).limit(1).lean();
            const sub_data = {
                maxRFPs: subscription.length > 0 ? subscription[0].max_rfp_proposal_generations : 0,
                maxGrants: subscription.length > 0 ? subscription[0].max_grant_proposal_generations : 0,
                currentRFPs: subscription.length > 0 ? subscription[0].current_rfp_proposal_generations : 0,
                currentGrants: subscription.length > 0 ? subscription[0].current_grant_proposal_generations : 0,
                plan_name: subscription.length > 0 ? subscription[0].plan_name : "None",
            };

            const data = {
                totalProposals,
                inProgressProposals,
                submittedProposals,
                wonProposals,

                //Remove initial proposal and generated proposal from the proposals
                proposals: {
                    proposals: notDeletedProposals.map(proposal => {
                        const proposalObj = proposal.toObject();
                        const { initialProposal, generatedProposal, ...rest } = proposalObj;
                        return rest;
                    }),
                    grantProposals: notDeletedGrantProposals.map(proposal => {
                        const proposalObj = proposal.toObject();
                        const { initialProposal, generatedProposal, ...rest } = proposalObj;
                        return rest;
                    }),
                },
                deletedProposals: {
                    proposals: deletedProposals.map(proposal => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        return rest;
                    }),
                    grantProposals: deletedGrantProposals.map(proposal => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        return rest;
                    }),
                },
                calendarEvents,
                employees,
                subscription: sub_data,
            };

            res.status(200).json(data);
        } else if (role === "employee") {
            const employeeProfile = await EmployeeProfile.findOne({ userId: user._id });
            if (!employeeProfile) {
                return res.status(404).json({ message: "Employee profile not found" });
            }
            const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }
            const proposals = await Proposal.find({ companyMail: companyProfile.email }).populate('currentEditor', '_id fullName email').sort({ createdAt: -1 });
            const grantProposals = await GrantProposal.find({ companyMail: companyProfile.email }).populate('currentEditor', '_id fullName email').sort({ createdAt: -1 });

            const totalProposals = proposals.length + grantProposals.length;
            const inProgressProposals = proposals.filter(proposal => proposal.status === "In Progress").length + grantProposals.filter(proposal => proposal.status === "In Progress").length;
            const wonProposals = proposals.filter(proposal => proposal.status === "Won").length + grantProposals.filter(proposal => proposal.status === "Won").length;
            const submittedProposals = proposals.filter(proposal => proposal.status === "Submitted").length + grantProposals.filter(proposal => proposal.status === "Submitted").length;

            const notDeletedProposals = proposals.filter(proposal => !proposal.isDeleted);
            const notDeletedGrantProposals = grantProposals.filter(proposal => !proposal.isDeleted);

            const deletedProposals = proposals.filter(proposal => proposal.isDeleted).map(proposal => {
                const proposalObj = proposal.toObject();
                return {
                    ...proposalObj,
                    restoreIn: (() => {
                        if (!proposal.restoreBy) return "No restore date";

                        const now = new Date();
                        const restoreDate = new Date(proposal.restoreBy);

                        if (isNaN(restoreDate.getTime())) return "Invalid restore date";

                        const diffTime = restoreDate.getTime() - now.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) {
                            return "Available for restoration";
                        } else if (diffDays === 1) {
                            return "1 day";
                        } else {
                            return `${diffDays} days`;
                        }
                    })()
                };
            });

            const deletedGrantProposals = grantProposals.filter(proposal => proposal.isDeleted).map(proposal => {
                const proposalObj = proposal.toObject();
                return {
                    ...proposalObj,
                    restoreIn: (() => {
                        if (!proposal.restoreBy) return "No restore date";

                        const now = new Date();
                        const restoreDate = new Date(proposal.restoreBy);

                        if (isNaN(restoreDate.getTime())) return "Invalid restore date";

                        const diffTime = restoreDate.getTime() - now.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) {
                            return "Available for restoration";
                        } else if (diffDays === 1) {
                            return "1 day";
                        } else {
                            return `${diffDays} days`;
                        }
                    })()
                };
            });

            const calendarEvents = await CalendarEvent.find({
                $or: [
                    { companyId: companyProfile._id },
                    { employeeId: employeeProfile._id }
                ]
            });

            const employees = companyProfile.employees || [];

            const companyUser = await User.findOne({ email: companyProfile.email });

            const subscription = await Subscription.find({ user_id: companyUser._id }).sort({ created_at: -1 }).limit(1).lean();

            const sub_data = {
                maxRFPs: subscription.length > 0 ? subscription[0].max_rfp_proposal_generations : 0,
                maxGrants: subscription.length > 0 ? subscription[0].max_grant_proposal_generations : 0,
                currentRFPs: subscription.length > 0 ? subscription[0].current_rfp_proposal_generations : 0,
                currentGrants: subscription.length > 0 ? subscription[0].current_grant_proposal_generations : 0,
                plan_name: subscription.length > 0 ? subscription[0].plan_name : "None",
            };

            const data = {
                totalProposals,
                inProgressProposals,
                submittedProposals,
                wonProposals,
                proposals: {
                    proposals: notDeletedProposals.map(proposal => {
                        const proposalObj = proposal.toObject();
                        const { initialProposal, generatedProposal, ...rest } = proposalObj;
                        return rest;
                    }),
                    grantProposals: notDeletedGrantProposals.map(proposal => {
                        const proposalObj = proposal.toObject();
                        const { initialProposal, generatedProposal, ...rest } = proposalObj;
                        return rest;
                    }),
                },
                deletedProposals: {
                    proposals: deletedProposals.map(proposal => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        return rest;
                    }),
                    grantProposals: deletedGrantProposals.map(proposal => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        return rest;
                    }),
                },
                calendarEvents,
                employees,
                subscription: sub_data,
            };

            res.status(200).json(data);
        } else {
            return res.status(400).json({ message: "Invalid user role" });
        }
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.addCalendarEvent = async (req, res) => {
    try {
        const { title, start, end } = req.body;

        // Input validation
        if (!title || !start || !end) {
            return res.status(400).json({ message: "Title, start date, and end date are required" });
        }

        const userId = req.user._id;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Date validation
        const startDate = new Date(start);
        const endDate = new Date(end);

        if (isNaN(startDate.getTime())) {
            return res.status(400).json({ message: "Invalid start date format" });
        }
        if (isNaN(endDate.getTime())) {
            return res.status(400).json({ message: "Invalid end date format" });
        }
        if (startDate >= endDate) {
            return res.status(400).json({ message: "Start date must be before end date" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            if (user.role === "company") {
                const companyProfile = await CompanyProfile.findOne({ userId });
                if (!companyProfile) {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(404).json({ message: "Company profile not found" });
                }
                const calendarEvent = new CalendarEvent({
                    companyId: companyProfile._id,
                    employeeId: companyProfile._id,
                    title,
                    startDate: start,
                    endDate: end,
                    status: "Deadline"
                });
                await calendarEvent.save({ session });

                await session.commitTransaction();
                res.status(201).json({ message: "Calendar event added successfully", event: calendarEvent });
            } else if (user.role === "employee") {
                const employeeProfile = await EmployeeProfile.findOne({ userId: userId });
                if (!employeeProfile) {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(404).json({ message: "Employee profile not found" });
                }
                const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
                if (!companyProfile) {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(404).json({ message: "Company profile not found" });
                }
                const calendarEvent = new CalendarEvent({
                    companyId: companyProfile._id,
                    employeeId: employeeProfile._id,
                    title,
                    startDate: start,
                    endDate: end,
                    status: "Deadline"
                });
                await calendarEvent.save({ session });

                await session.commitTransaction();
                res.status(201).json({ message: "Calendar event added successfully", event: calendarEvent });
            } else {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Invalid user role" });
            }
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.setCurrentEditor = async (req, res) => {
    try {
        const { proposalId, editorId } = req.body;

        // Input validation
        if (!proposalId || !editorId) {
            return res.status(400).json({ message: "Proposal ID and Editor ID are required" });
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(proposalId) || !mongoose.Types.ObjectId.isValid(editorId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        const editor = await EmployeeProfile.findById(editorId);
        if (!editor || editor.accessLevel !== "Editor") {
            return res.status(404).json({ message: "Editor not found or member is not an editor" });
        }

        const userId = editor.userId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const proposal = await Proposal.findById(proposalId).populate("currentEditor", "_id");
        if (!proposal) {
            return res.status(404).json({ message: "Proposal not found" });
        }

        // const req_user = await User.findOne({ email: proposal.companyMail });

        // If company and email is not the same as the proposal, return error
        if (req.user.role === "company" && req.user.email !== proposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to set the current editor" });
        }

        //Only company and the the current editor can set the current editor
        if (req.user.role !== "company" && proposal.currentEditor._id !== req.user._id) {
            return res.status(403).json({ message: "You are not authorized to set the current editor" });
        }

        proposal.currentEditor = userId;
        await proposal.save();

        res.status(200).json({ message: "Editor set successfully" });
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.setCurrentEditorGrant = async (req, res) => {
    try {
        const { grantProposalId, editorId } = req.body;
        if (!grantProposalId || !editorId) {
            return res.status(400).json({ message: "Grant proposal ID and editor ID are required" });
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(grantProposalId) || !mongoose.Types.ObjectId.isValid(editorId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        const editor = await EmployeeProfile.findById(editorId);
        if (!editor || editor.accessLevel !== "Editor") {
            return res.status(404).json({ message: "Editor not found or member is not an editor" });
        }

        const userId = editor.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const grantProposal = await GrantProposal.findById(grantProposalId).populate("currentEditor", "_id");
        if (!grantProposal) {
            return res.status(404).json({ message: "Grant proposal not found" });
        }

        //If company and email is not the same as the proposal, return error
        if (req.user.role === "company" && req.user.email !== grantProposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to set the current editor" });
        }

        //If company and email is not the same as the proposal, return error
        if (req.user.role !== "company" && req.user._id !== grantProposal.currentEditor._id) {
            return res.status(403).json({ message: "You are not authorized to set the current editor" });
        }

        grantProposal.currentEditor = user._id;
        await grantProposal.save();

        res.status(200).json({ message: "Editor set successfully" });
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.restoreProposal = async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await Proposal.findByIdAndUpdate(proposalId, { isDeleted: false, deletedBy: null, deletedAt: null, restoreBy: null, restoredBy: req.user._id, restoredAt: new Date() }, { new: true });
        res.status(200).json(proposal);
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.restoreGrantProposal = async (req, res) => {
    try {
        const { grantProposalId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await GrantProposal.findByIdAndUpdate(grantProposalId, { isDeleted: false, deletedBy: null, deletedAt: null, restoreBy: null, restoredBy: req.user._id, restoredAt: new Date() }, { new: true });
        res.status(200).json(proposal);
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.deleteProposals = async (req, res) => {
    try {
        const { proposalIds } = req.body;
        if (!Array.isArray(proposalIds)) {
            return res.status(400).json({ message: "Proposal IDs must be an array" });
        }
        for (const proposalId of proposalIds) {
            if (!mongoose.Types.ObjectId.isValid(proposalId)) {
                return res.status(400).json({ message: "Invalid ID format" });
            }
        }
        const proposals = await Proposal.updateMany({ _id: { $in: proposalIds } }, {
            isDeleted: true,
            deletedBy: req.user._id,
            deletedAt: new Date(),
            restoreBy: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        }); // 15 days
        res.status(200).json(proposals);
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.deleteGrantProposals = async (req, res) => {
    try {
        const { grantProposalIds } = req.body;
        if (!Array.isArray(grantProposalIds)) {
            return res.status(400).json({ message: "Grant proposal IDs must be an array" });
        }
        for (const grantProposalId of grantProposalIds) {
            if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
                return res.status(400).json({ message: "Invalid ID format" });
            }
        }
        const proposals = await GrantProposal.updateMany({ _id: { $in: grantProposalIds } }, {
            isDeleted: true,
            deletedBy: req.user._id,
            deletedAt: new Date(),
            restoreBy: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        }); // 15 days
        res.status(200).json(proposals);
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.deletePermanently = async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!proposalId) {
            return res.status(400).json({ message: "Proposal ID is required" });
        }
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await Proposal.findByIdAndDelete(proposalId, { session });
            await DraftRFP.deleteOne({ proposalId: proposalId }, { session });
            await ProposalTracker.deleteOne({ proposalId: proposalId }, { session });

            await session.commitTransaction();
            res.status(200).json({ message: "Proposal deleted permanently" });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.deletePermanentlyGrant = async (req, res) => {
    try {
        const { grantProposalId } = req.body;
        if (!grantProposalId) {
            return res.status(400).json({ message: "Grant proposal ID is required" });
        }
        if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await GrantProposal.findByIdAndDelete(grantProposalId, { session });
            await DraftGrant.deleteOne({ grantProposalId: grantProposalId }, { session });
            await ProposalTracker.deleteOne({ grantProposalId: grantProposalId }, { session });

            await session.commitTransaction();
            res.status(200).json({ message: "Grant proposal deleted permanently" });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.updateProposal = async (req, res) => {
    try {
        const { proposalId, updates } = req.body;
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await Proposal.findById(proposalId).populate("currentEditor", "_id");
        if (!proposal) {
            return res.status(404).json({ message: "Proposal not found" });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        //If company and email is not the same as the proposal, return error
        if (user.role === "company" && user.email !== proposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to update the proposal" });
        }

        //Only company and the the current editor can update the proposal
        if (user.role !== "company" && proposal.currentEditor._id !== user._id) {
            return res.status(403).json({ message: "You are not authorized to update the proposal" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            if (updates.deadline) proposal.deadline = updates.deadline;
            if (updates.deadline) {
                const calendarEvent = await CalendarEvent.findOne({ proposalId: proposalId, status: "Deadline" });
                if (calendarEvent) {
                    calendarEvent.startDate = updates.deadline;
                    calendarEvent.endDate = updates.deadline;
                    await calendarEvent.save({ session });
                }
            }

            if (updates.submittedAt) proposal.submittedAt = updates.submittedAt;

            if (updates.status) proposal.status = updates.status;
            if (updates.status) {
                const calendarEvent = await CalendarEvent.findOne({ proposalId: proposalId, status: { $ne: "Deadline" } });
                if (calendarEvent) {
                    calendarEvent.status = updates.status;
                    calendarEvent.startDate = proposal.submittedAt;
                    calendarEvent.endDate = proposal.submittedAt;
                    await calendarEvent.save({ session });
                }
            }
            await proposal.save({ session });

            await session.commitTransaction();
            res.status(200).json(proposal);
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.updateGrantProposal = async (req, res) => {
    try {
        const { grantProposalId, updates } = req.body;
        if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const grantProposal = await GrantProposal.findById(grantProposalId).populate("currentEditor", "_id");
        if (!grantProposal) {
            return res.status(404).json({ message: "Grant proposal not found" });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        //If company and email is not the same as the proposal, return error
        if (user.role === "company" && user.email !== grantProposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to update the grant proposal" });
        }

        //Only company and the the current editor can update the grant proposal
        if (user.role !== "company" && grantProposal.currentEditor._id !== user._id) {
            return res.status(403).json({ message: "You are not authorized to update the grant proposal" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            if (updates.deadline) grantProposal.deadline = updates.deadline;
            if (updates.deadline) {
                const calendarEvent = await CalendarEvent.findOne({ proposalId: grantProposalId, status: "Deadline" });
                if (calendarEvent) {
                    calendarEvent.startDate = updates.deadline;
                    calendarEvent.endDate = updates.deadline;
                    await calendarEvent.save({ session });
                }
            }
            if (updates.submittedAt) grantProposal.submittedAt = updates.submittedAt;
            if (updates.status) grantProposal.status = updates.status;
            if (updates.status) {
                const calendarEvent = await CalendarEvent.findOne({ proposalId: grantProposalId, status: { $ne: "Deadline" } });
                if (calendarEvent) {
                    calendarEvent.status = updates.status;
                    await calendarEvent.save({ session });
                }
            }
            await grantProposal.save({ session });

            await session.commitTransaction();
            res.status(200).json(grantProposal);
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Calendar event error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};