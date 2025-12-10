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

const { queueEmail } = require("../utils/mailSender");
const emailTemplates = require("../utils/emailTemplates");

const sendProposalStatusUpdateEmail = async (proposal, oldStatus, newStatus) => {
    const companyProfile = await CompanyProfile.findOne({ email: proposal.companyMail });
    if (!companyProfile) {
        return;
    }
    const user = await User.findById(companyProfile.userId);
    if (!user) {
        return;
    }
    const { subject, body } = await emailTemplates.getProposalStatusChangedEmail(user.fullName, proposal.title, oldStatus, newStatus, 'RFP');
    try {
        queueEmail(proposal.companyMail, subject, body, 'proposalStatusChanged');
    } catch (error) {
        console.error('Error sending proposal status update email:', error);
    }
};

const sendGrantProposalStatusUpdateEmail = async (grantProposal, oldStatus, newStatus) => {
    const companyProfile = await CompanyProfile.findOne({ email: grantProposal.companyMail });
    if (!companyProfile) {
        return;
    }
    const user = await User.findById(companyProfile.userId);
    if (!user) {
        return;
    }
    const { subject, body } = await emailTemplates.getProposalStatusChangedEmail(user.fullName, grantProposal.title, oldStatus, newStatus, 'Grant');
    try {
        queueEmail(grantProposal.companyMail, subject, body, 'proposalStatusChanged');
    } catch (error) {
        console.error('Error sending grant proposal status update email:', error);
    }
};

const sendProposalDeletedEmail = async (proposal) => {
    const companyProfile = await CompanyProfile.findOne({ email: proposal.companyMail });
    if (!companyProfile) {
        return;
    }
    const user = await User.findById(companyProfile.userId);
    if (!user) {
        return;
    }

    const deletedBy = await User.findById(proposal.deletedBy).select('fullName email');
    if (!deletedBy) {
        return;
    }
    const { subject, body } = await emailTemplates.getProposalDeletedEmail(user.fullName, proposal.title, deletedBy.fullName + " (" + deletedBy.email + ")", 'RFP');
    try {
        queueEmail(proposal.companyMail, subject, body, 'proposalDeleted');
    } catch (error) {
        console.error('Error sending proposal deleted email:', error);
    }
};

const sendGrantProposalDeletedEmail = async (grantProposal) => {
    const companyProfile = await CompanyProfile.findOne({ email: grantProposal.companyMail });
    if (!companyProfile) {
        return;
    }
    const user = await User.findById(companyProfile.userId);
    if (!user) {
        return;
    }
    const deletedBy = await User.findById(grantProposal.deletedBy).select('fullName email');
    if (!deletedBy) {
        return;
    }
    const { subject, body } = await emailTemplates.getProposalDeletedEmail(user.fullName, grantProposal.title, deletedBy.fullName + " (" + deletedBy.email + ")", 'Grant');
    try {
        queueEmail(grantProposal.companyMail, subject, body, 'proposalDeleted');
    } catch (error) {
        console.error('Error sending grant proposal deleted email:', error);
    }
};

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

            // Parallelize independent queries
            const [proposals, grantProposals] = await Promise.all([
                Proposal.find({ companyMail: companyProfile.email }).populate('collaborators.editors', 'fullName email').populate('collaborators.viewers', 'fullName email').sort({ createdAt: -1 }).lean(),
                GrantProposal.find({ companyMail: companyProfile.email }).populate('collaborators.editors', 'fullName email').populate('collaborators.viewers', 'fullName email').sort({ createdAt: -1 }).lean()
            ]);

            // Use aggregation to count proposals by status instead of manual filtering
            const proposalStats = await Promise.all([
                Proposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]),
                GrantProposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ])
            ]);

            // Combine stats from both collections
            const statusCounts = {};
            proposalStats.flat().forEach(stat => {
                statusCounts[stat._id] = (statusCounts[stat._id] || 0) + stat.count;
            });

            const totalProposals = proposals.length + grantProposals.length;
            const inProgressProposals = statusCounts["In Progress"] || 0;
            const wonProposals = statusCounts["Won"] || 0;
            const submittedProposals = statusCounts["Submitted"] || 0;

            const notDeletedProposals = proposals.filter(proposal => !proposal.isDeleted);

            const notDeletedGrantProposals = grantProposals.filter(proposal => !proposal.isDeleted);

            const deletedProposals = proposals.filter(proposal => proposal.isDeleted).map(proposal => {
                return {
                    ...proposal,
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
                return {
                    ...proposal,
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
                    proposals: await Promise.all(notDeletedProposals.map(async (proposal) => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        // Map User IDs to EmployeeProfile IDs
                        const editorUserIds = (rest.collaborators?.editors || []).map(editor =>
                            typeof editor === 'object' && editor._id ? editor._id.toString() : editor.toString()
                        );
                        const viewerUserIds = (rest.collaborators?.viewers || []).map(viewer =>
                            typeof viewer === 'object' && viewer._id ? viewer._id.toString() : viewer.toString()
                        );

                        const allUserIds = [...editorUserIds, ...viewerUserIds];
                        const employeeProfiles = await EmployeeProfile.find({
                            userId: { $in: allUserIds },
                            companyMail: companyProfile.email
                        });

                        // Create a map of userId -> employeeProfile
                        const userIdToEmployeeMap = new Map();
                        employeeProfiles.forEach(emp => {
                            const employee = companyProfile.employees.find(e =>
                                e.employeeId && e.employeeId.toString() === emp._id.toString()
                            );
                            if (employee) {
                                userIdToEmployeeMap.set(emp.userId.toString(), {
                                    _id: emp._id.toString(), // EmployeeProfile._id (employeeId)
                                    fullName: emp.name || employee.name || '',
                                    email: emp.email || employee.email || ''
                                });
                            }
                        });

                        // Combine editors and viewers into a single collaborators array
                        const collaborators = [
                            ...editorUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean),
                            ...viewerUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean)
                        ];

                        return { ...rest, collaborators };
                    })),
                    grantProposals: await Promise.all(notDeletedGrantProposals.map(async (proposal) => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        // Map User IDs to EmployeeProfile IDs
                        const editorUserIds = (rest.collaborators?.editors || []).map(editor =>
                            typeof editor === 'object' && editor._id ? editor._id.toString() : editor.toString()
                        );
                        const viewerUserIds = (rest.collaborators?.viewers || []).map(viewer =>
                            typeof viewer === 'object' && viewer._id ? viewer._id.toString() : viewer.toString()
                        );

                        const allUserIds = [...editorUserIds, ...viewerUserIds];
                        const employeeProfiles = await EmployeeProfile.find({
                            userId: { $in: allUserIds },
                            companyMail: companyProfile.email
                        });

                        // Create a map of userId -> employeeProfile
                        const userIdToEmployeeMap = new Map();
                        employeeProfiles.forEach(emp => {
                            const employee = companyProfile.employees.find(e =>
                                e.employeeId && e.employeeId.toString() === emp._id.toString()
                            );
                            if (employee) {
                                userIdToEmployeeMap.set(emp.userId.toString(), {
                                    _id: emp._id.toString(), // EmployeeProfile._id (employeeId)
                                    fullName: emp.name || employee.name || '',
                                    email: emp.email || employee.email || ''
                                });
                            }
                        });

                        // Combine editors and viewers into a single collaborators array
                        const collaborators = [
                            ...editorUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean),
                            ...viewerUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean)
                        ];

                        return { ...rest, collaborators };
                    })),
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
            // Parallelize independent queries
            const [proposals, grantProposals] = await Promise.all([
                Proposal.find({ companyMail: companyProfile.email }).populate('collaborators.editors', 'fullName email').populate('collaborators.viewers', 'fullName email').sort({ createdAt: -1 }).lean(),
                GrantProposal.find({ companyMail: companyProfile.email }).populate('collaborators.editors', 'fullName email').populate('collaborators.viewers', 'fullName email').sort({ createdAt: -1 }).lean()
            ]);

            // Use aggregation to count proposals by status instead of manual filtering
            const proposalStats = await Promise.all([
                Proposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]),
                GrantProposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ])
            ]);

            // Combine stats from both collections
            const statusCounts = {};
            proposalStats.flat().forEach(stat => {
                statusCounts[stat._id] = (statusCounts[stat._id] || 0) + stat.count;
            });

            const totalProposals = proposals.length + grantProposals.length;
            const inProgressProposals = statusCounts["In Progress"] || 0;
            const wonProposals = statusCounts["Won"] || 0;
            const submittedProposals = statusCounts["Submitted"] || 0;

            const notDeletedProposals = proposals.filter(proposal => !proposal.isDeleted);
            const notDeletedGrantProposals = grantProposals.filter(proposal => !proposal.isDeleted);

            const deletedProposals = proposals.filter(proposal => proposal.isDeleted).map(proposal => {
                return {
                    ...proposal,
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
                return {
                    ...proposal,
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
                    proposals: await Promise.all(notDeletedProposals.map(async (proposal) => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        // Map User IDs to EmployeeProfile IDs
                        const editorUserIds = (rest.collaborators?.editors || []).map(editor =>
                            typeof editor === 'object' && editor._id ? editor._id.toString() : editor.toString()
                        );
                        const viewerUserIds = (rest.collaborators?.viewers || []).map(viewer =>
                            typeof viewer === 'object' && viewer._id ? viewer._id.toString() : viewer.toString()
                        );

                        const allUserIds = [...editorUserIds, ...viewerUserIds];
                        const employeeProfiles = await EmployeeProfile.find({
                            userId: { $in: allUserIds },
                            companyMail: companyProfile.email
                        });

                        // Create a map of userId -> employeeProfile
                        const userIdToEmployeeMap = new Map();
                        employeeProfiles.forEach(emp => {
                            const employee = companyProfile.employees.find(e =>
                                e.employeeId && e.employeeId.toString() === emp._id.toString()
                            );
                            if (employee) {
                                userIdToEmployeeMap.set(emp.userId.toString(), {
                                    _id: emp._id.toString(), // EmployeeProfile._id (employeeId)
                                    fullName: emp.name || employee.name || '',
                                    email: emp.email || employee.email || ''
                                });
                            }
                        });

                        // Combine editors and viewers into a single collaborators array
                        const collaborators = [
                            ...editorUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean),
                            ...viewerUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean)
                        ];

                        return { ...rest, collaborators };
                    })),
                    grantProposals: await Promise.all(notDeletedGrantProposals.map(async (proposal) => {
                        const { initialProposal, generatedProposal, ...rest } = proposal;
                        // Map User IDs to EmployeeProfile IDs
                        const editorUserIds = (rest.collaborators?.editors || []).map(editor =>
                            typeof editor === 'object' && editor._id ? editor._id.toString() : editor.toString()
                        );
                        const viewerUserIds = (rest.collaborators?.viewers || []).map(viewer =>
                            typeof viewer === 'object' && viewer._id ? viewer._id.toString() : viewer.toString()
                        );

                        const allUserIds = [...editorUserIds, ...viewerUserIds];
                        const employeeProfiles = await EmployeeProfile.find({
                            userId: { $in: allUserIds },
                            companyMail: companyProfile.email
                        });

                        // Create a map of userId -> employeeProfile
                        const userIdToEmployeeMap = new Map();
                        employeeProfiles.forEach(emp => {
                            const employee = companyProfile.employees.find(e =>
                                e.employeeId && e.employeeId.toString() === emp._id.toString()
                            );
                            if (employee) {
                                userIdToEmployeeMap.set(emp.userId.toString(), {
                                    _id: emp._id.toString(), // EmployeeProfile._id (employeeId)
                                    fullName: emp.name || employee.name || '',
                                    email: emp.email || employee.email || ''
                                });
                            }
                        });

                        // Combine editors and viewers into a single collaborators array
                        const collaborators = [
                            ...editorUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean),
                            ...viewerUserIds.map(userId => userIdToEmployeeMap.get(userId)).filter(Boolean)
                        ];

                        return { ...rest, collaborators };
                    })),
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

exports.restoreProposal = async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await Proposal.findByIdAndUpdate(proposalId, { isDeleted: false, deletedBy: null, deletedAt: null, restoreBy: null, restoredBy: req.user._id, restoredAt: new Date() }, { new: true });

        res.status(200).json(proposal);
    } catch (error) {
        console.error('Proposal restoration error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.restoreGrantProposal = async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await GrantProposal.findByIdAndUpdate(proposalId, { isDeleted: false, deletedBy: null, deletedAt: null, restoreBy: null, restoredBy: req.user._id, restoredAt: new Date() }, { new: true });

        res.status(200).json(proposal);
    } catch (error) {
        console.error('Grant proposal restoration error:', error);
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
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            await Proposal.updateMany({ _id: { $in: proposalIds } }, { isDeleted: true, deletedBy: req.user._id, deletedAt: new Date(), restoreBy: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) }, { session });

            const proposals = await Proposal.find({ _id: { $in: proposalIds } }).session(session);

            await session.commitTransaction();
            session.endSession();

            await Promise.all(proposals.map((p) => sendProposalDeletedEmail(p)));
        } catch (err) {
            await session.abortTransaction();
            session.endSession();
            throw err;
        }

        res.status(200).json({ message: "Proposals deleted successfully" });
    } catch (error) {
        console.error('Proposal deletion error:', error);
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
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await GrantProposal.updateMany(
                { _id: { $in: grantProposalIds } },
                {
                    isDeleted: true,
                    deletedBy: req.user._id,
                    deletedAt: new Date(),
                    restoreBy: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
                },
                { session }
            );

            const proposals = await GrantProposal.find({ _id: { $in: grantProposalIds } }).session(session);

            // send emails OUTSIDE transaction
            await session.commitTransaction();
            session.endSession();

            await Promise.all(proposals.map((p) => sendGrantProposalDeletedEmail(p)));

        } catch (err) {
            console.error('Grant proposal deletion error:', err);
            await session.abortTransaction();
            session.endSession();
            throw err;
        }

        res.status(200).json({ message: "Grant proposals deleted successfully" });
    } catch (error) {
        console.error('Grant proposal deletion error:', error);
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

        const proposal = await Proposal.findById(proposalId);
        if (!proposal) {
            return res.status(404).json({ message: "Proposal not found" });
        }

        const companyProfile = await CompanyProfile.findOne({ email: proposal.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await Proposal.findByIdAndDelete(proposalId, { session });
            await DraftRFP.deleteOne({ proposalId: proposalId }, { session });
            await ProposalTracker.deleteOne({ proposalId: proposalId }, { session });

            companyProfile.proposals = companyProfile.proposals.filter(proposal => proposal.title !== proposal.title);
            companyProfile.deadlines = companyProfile.deadlines.filter(deadline => deadline.title !== proposal.title);
            await companyProfile.save({ session });

            //Delete the calendar events
            await CalendarEvent.deleteMany({ proposalId: proposalId }, { session });

            await session.commitTransaction();

            res.status(200).json({ message: "Proposal deleted permanently" });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Proposal deletion error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.deletePermanentlyGrant = async (req, res) => {
    try {
        const { proposalId } = req.body;
        if (!proposalId) {
            return res.status(400).json({ message: "Grant proposal ID is required" });
        }
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }


        const grantProposal = await GrantProposal.findById(proposalId);
        if (!grantProposal) {
            return res.status(404).json({ message: "Grant proposal not found" });
        }

        const companyProfile = await CompanyProfile.findOne({ email: grantProposal.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await GrantProposal.findByIdAndDelete(proposalId, { session });
            await DraftGrant.deleteOne({ grantProposalId: proposalId }, { session });
            await ProposalTracker.deleteOne({ grantProposalId: proposalId }, { session });

            companyProfile.proposals = companyProfile.proposals.filter(proposal => proposal.title !== grantProposal.title);
            companyProfile.deadlines = companyProfile.deadlines.filter(deadline => deadline.title !== grantProposal.title);
            await companyProfile.save({ session });

            //Delete the calendar events
            await CalendarEvent.deleteMany({ grantProposalId: proposalId }, { session });

            await session.commitTransaction();

            res.status(200).json({ message: "Grant proposal deleted permanently" });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Grant proposal deletion error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.updateProposal = async (req, res) => {
    try {
        const { proposalId, updates } = req.body;
        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const proposal = await Proposal.findById(proposalId);
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

        //Only company and collaborators can update the proposal
        const isCollaborator = proposal.collaborators.editors.some(editorId => editorId.toString() === user._id.toString()) ||
            proposal.collaborators.viewers.some(viewerId => viewerId.toString() === user._id.toString());
        if (user.role !== "company" && !isCollaborator) {
            return res.status(403).json({ message: "You are not authorized to update the proposal" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();
        let oldStatus = proposal.status;

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

            const companyProfile = await CompanyProfile.findOne({ email: proposal.companyMail });
            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }
            //Find the deadline with the same title and update the status and dueDate
            const deadline = companyProfile.deadlines.find(deadline => deadline.title === proposal.title);
            if (deadline) {
                deadline.status = proposal.status;
                deadline.dueDate = proposal.deadline;
            }

            const existingProposal = companyProfile.proposals.find(proposal => proposal.title === proposal.title);
            if (existingProposal) {
                existingProposal.status = proposal.status;
            }

            await companyProfile.save({ session });

            await session.commitTransaction();

            await sendProposalStatusUpdateEmail(proposal, oldStatus, proposal.status);
            res.status(200).json(proposal);
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Proposal update error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.updateGrantProposal = async (req, res) => {
    try {
        const { grantProposalId, updates } = req.body;
        if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const grantProposal = await GrantProposal.findById(grantProposalId);
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

        //Only company and collaborators can update the grant proposal
        const isCollaborator = grantProposal.collaborators.editors.some(editorId => editorId.toString() === user._id.toString()) ||
            grantProposal.collaborators.viewers.some(viewerId => viewerId.toString() === user._id.toString());
        if (user.role !== "company" && !isCollaborator) {
            return res.status(403).json({ message: "You are not authorized to update the grant proposal" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();
        let oldStatus = grantProposal.status;
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

            const companyProfile = await CompanyProfile.findOne({ email: grantProposal.companyMail });
            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }
            //Find the deadline with the same title and update the status and dueDate
            const deadline = companyProfile.deadlines.find(deadline => deadline.title === grantProposal.title);
            if (deadline) {
                deadline.status = grantProposal.status;
                deadline.dueDate = grantProposal.deadline;
            }
            const existingProposal = companyProfile.proposals.find(proposal => proposal.title === grantProposal.title);
            if (existingProposal) {
                existingProposal.status = grantProposal.status;
            }
            await companyProfile.save({ session });

            await session.commitTransaction();

            await sendGrantProposalStatusUpdateEmail(grantProposal, oldStatus, grantProposal.status);
            res.status(200).json(grantProposal);
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Grant proposal update error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.setCollaborators = async (req, res) => {
    try {
        const { proposalId, collaboratorIds } = req.body;

        if (!req.user || req.user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to set collaborators" });
        }

        if (!mongoose.Types.ObjectId.isValid(proposalId)) {
            return res.status(400).json({ message: "Invalid proposal ID format" });
        }

        if (!Array.isArray(collaboratorIds)) {
            return res.status(400).json({ message: "Collaborator IDs must be an array" });
        }

        // Validate all collaborator IDs
        for (const collaboratorId of collaboratorIds) {
            if (!mongoose.Types.ObjectId.isValid(collaboratorId)) {
                return res.status(400).json({ message: `Invalid collaborator ID format: ${collaboratorId}` });
            }
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const proposal = await Proposal.findById(proposalId);
        if (!proposal) {
            return res.status(404).json({ message: "Proposal not found" });
        }

        const draftRFP = await DraftRFP.findOne({ proposalId: proposalId });
        if (!draftRFP) {
            return res.status(404).json({ message: "Draft proposal not found" });
        }

        // Verify company owns this proposal
        if (user.email !== proposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to set collaborators for this proposal" });
        }

        // Verify all collaborator IDs exist and are employees of the company
        const companyProfile = await CompanyProfile.findOne({ email: proposal.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const employeeIds = companyProfile.employees.map(emp => emp.employeeId?.toString()).filter(Boolean);
        const invalidCollaborators = collaboratorIds.filter(id => !employeeIds.includes(id.toString()));

        if (invalidCollaborators.length > 0) {
            return res.status(400).json({ message: `Invalid collaborator IDs: ${invalidCollaborators.join(', ')}` });
        }

        // Convert employeeIds (EmployeeProfile._id) to userIds (User._id)
        const employeeProfiles = await EmployeeProfile.find({ _id: { $in: collaboratorIds } });
        const userIds = employeeProfiles.map(emp => emp.userId).filter(Boolean);

        if (userIds.length !== collaboratorIds.length) {
            return res.status(400).json({ message: "Some collaborator IDs could not be mapped to users" });
        }

        const editorIds = employeeProfiles.filter(emp => emp.accessLevel === "Editor").map(emp => emp.userId);
        const viewerIds = employeeProfiles.filter(emp => emp.accessLevel === "Viewer").map(emp => emp.userId);

        if (editorIds.length > 0 && editorIds.length > proposal.maxEditors) {
            return res.status(400).json({ message: "Max editors reached" });
        }

        if (viewerIds.length > 0 && viewerIds.length > proposal.maxViewers) {
            return res.status(400).json({ message: "Max viewers reached" });
        }

        // Update collaborators - store all as editors for simplicity
        proposal.collaborators.editors = editorIds;
        proposal.collaborators.viewers = viewerIds;

        draftRFP.collaborators.editors = editorIds;
        draftRFP.collaborators.viewers = viewerIds;

        await proposal.save();
        await draftRFP.save();

        res.status(200).json({ message: "Collaborators updated successfully", proposal });
    } catch (error) {
        console.error('Set collaborators error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.setGrantCollaborators = async (req, res) => {
    try {
        const { grantProposalId, collaboratorIds } = req.body;

        if (!req.user || req.user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to set collaborators" });
        }

        if (!mongoose.Types.ObjectId.isValid(grantProposalId)) {
            return res.status(400).json({ message: "Invalid grant proposal ID format" });
        }

        if (!Array.isArray(collaboratorIds)) {
            return res.status(400).json({ message: "Collaborator IDs must be an array" });
        }

        // Validate all collaborator IDs
        for (const collaboratorId of collaboratorIds) {
            if (!mongoose.Types.ObjectId.isValid(collaboratorId)) {
                return res.status(400).json({ message: `Invalid collaborator ID format: ${collaboratorId}` });
            }
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const grantProposal = await GrantProposal.findById(grantProposalId);
        if (!grantProposal) {
            return res.status(404).json({ message: "Grant proposal not found" });
        }

        const draftGrant = await DraftGrant.findOne({ proposalId: grantProposalId });
        if (!draftGrant) {
            return res.status(404).json({ message: "Draft grant proposal not found" });
        }

        // Verify company owns this grant proposal
        if (user.email !== grantProposal.companyMail) {
            return res.status(403).json({ message: "You are not authorized to set collaborators for this grant proposal" });
        }

        // Verify all collaborator IDs exist and are employees of the company
        const companyProfile = await CompanyProfile.findOne({ email: grantProposal.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const employeeIds = companyProfile.employees.map(emp => emp.employeeId?.toString()).filter(Boolean);
        const invalidCollaborators = collaboratorIds.filter(id => !employeeIds.includes(id.toString()));

        if (invalidCollaborators.length > 0) {
            return res.status(400).json({ message: `Invalid collaborator IDs: ${invalidCollaborators.join(', ')}` });
        }

        // Convert employeeIds (EmployeeProfile._id) to userIds (User._id)
        const employeeProfiles = await EmployeeProfile.find({ _id: { $in: collaboratorIds } });
        const userIds = employeeProfiles.map(emp => emp.userId).filter(Boolean);

        if (userIds.length !== collaboratorIds.length) {
            return res.status(400).json({ message: "Some collaborator IDs could not be mapped to users" });
        }

        const editorIds = employeeProfiles.filter(emp => emp.accessLevel === "Editor").map(emp => emp.userId);
        const viewerIds = employeeProfiles.filter(emp => emp.accessLevel === "Viewer").map(emp => emp.userId);

        if (editorIds.length > 0 && editorIds.length > grantProposal.maxEditors) {
            return res.status(400).json({ message: "Max editors reached" });
        }

        if (viewerIds.length > 0 && viewerIds.length > grantProposal.maxViewers) {
            return res.status(400).json({ message: "Max viewers reached" });
        }

        // Update collaborators - store all as editors for simplicity
        grantProposal.collaborators.editors = editorIds;
        grantProposal.collaborators.viewers = viewerIds;

        draftGrant.collaborators.editors = editorIds;
        draftGrant.collaborators.viewers = viewerIds;

        await grantProposal.save();
        await draftGrant.save();

        res.status(200).json({ message: "Collaborators updated successfully", grantProposal });
    } catch (error) {
        console.error('Set grant collaborators error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};