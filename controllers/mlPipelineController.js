require('dotenv').config();

const mongoose = require('mongoose');
const Proposal = require('../models/Proposal');
const MatchedRFP = require('../models/MatchedRFP');
const RFP = require('../models/RFP');
const Grant = require('../models/Grant');
const SavedRFP = require('../models/SavedRFP');
const DraftRFP = require('../models/DraftRFP');
const EmployeeProfile = require('../models/EmployeeProfile');
const CompanyProfile = require('../models/CompanyProfile');
const CalendarEvent = require('../models/CalendarEvents');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const SavedGrant = require('../models/SavedGrant');
const { cleanupUploadedFiles } = require('../utils/fileCleanup');
const DraftGrant = require('../models/DraftGrant');
const GrantProposal = require('../models/GrantProposal');
const ProposalTracker = require('../models/ProposalTracker');

const axios = require('axios');

const { GridFsStorage } = require("multer-gridfs-storage");
const multer = require("multer");

const storage = new GridFsStorage({
  url: process.env.MONGO_URI,
  file: (req, file) => {
    return {
      bucketName: "uploads",
      filename: file.originalname,
    };
  },
});

// Add error handling for GridFS storage
storage.on('error', (error) => {
  console.error('GridFS storage error:', error);
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept PDF and TXT files
    if (file.mimetype === 'application/pdf' || file.mimetype === 'text/plain' ||
      file.originalname.endsWith('.pdf') || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and TXT files are allowed'), false);
    }
  }
});

const singleFileUpload = upload.single('file');

// File validation utilities
const validateFile = (file) => {
  const errors = [];

  // File size validation (10MB limit)
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
  if (file.size > MAX_FILE_SIZE) {
    errors.push({
      type: 'SIZE_LIMIT_EXCEEDED',
      message: 'File size too large. Maximum size is 10MB.',
      currentSize: file.size,
      maxSize: MAX_FILE_SIZE
    });
  }

  // File type validation
  const allowedMimeTypes = [
    'application/pdf',
    'text/plain',
  ];

  const allowedExtensions = ['.pdf', '.txt'];
  const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

  if (!allowedMimeTypes.includes(file.mimetype) && !allowedExtensions.includes(fileExtension)) {
    errors.push({
      type: 'INVALID_FILE_TYPE',
      message: 'Invalid file type. Only PDF and TXT files are allowed.',
      allowedTypes: ['PDF', 'TXT'],
      receivedType: file.mimetype,
      receivedExtension: fileExtension
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getDeadline = (deadline) => {
  const defaultDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (!deadline) return defaultDate;

  const date = new Date(deadline);
  return isNaN(date.getTime()) ? defaultDate : date;
};

exports.getRecommendedAndSavedRFPs = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let userEmail = req.user.email;

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    // Recommended: from matched RFPs with match >= 40, sorted by latest
    const recommendedRFPs = await MatchedRFP.find({ email: userEmail, match: { $gte: 40 } })
      .sort({ createdAt: -1 })
      .lean();

    const rfpIds = recommendedRFPs.map(r => r._id);

    // Fetch only relevant drafts & proposals
    const [draftRFPs, proposals] = await Promise.all([
      DraftRFP.find({ userEmail, rfpId: { $in: rfpIds } }).lean(),
      Proposal.find({ companyMail: userEmail, rfpId: { $in: rfpIds } }).lean()
    ]);

    const recommendedRFPs_1 = recommendedRFPs.map(item => {
      const draftRFP = draftRFPs.find(d => d.rfpId.toString() === item._id.toString());
      const proposal = proposals.find(p => p.rfpId.toString() === item._id.toString());
      return {
        ...item,
        generated: !!(draftRFP || proposal),
      };
    });

    // Saved: from SavedRFPs
    const savedRFPs_1 = await SavedRFP.find({ userEmail }).lean();
    const savedRFPs = savedRFPs_1.map((item) => {
      return {
        ...item.rfp,
        _id: item.rfpId,
      }
    });

    res.status(200).json({
      recommendedRFPs: recommendedRFPs_1,
      savedRFPs,
    });
  } catch (err) {
    console.error("Error in /getRecommendedAndSavedRFPs:", err.message);
    res.status(500).json({ error: "Failed to load RFPs" });
  }
};

exports.getOtherRFPs = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let userEmail = req.user.email;

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const industries = req.body.industries;

    const otherRFPs = await RFP.find({ baseType: { $in: industries } }).lean();

    const rfpIds = otherRFPs.map(r => r._id);

    const draftRFPs = await DraftRFP.find({ userEmail: userEmail, rfpId: { $in: rfpIds } }).lean();
    const proposals = await Proposal.find({ companyMail: userEmail, rfpId: { $in: rfpIds } }).lean();

    const otherRFPs_1 = await Promise.all(otherRFPs.map(async (item) => {
      const draftRFP = draftRFPs.find(d => d.rfpId.toString() === item._id.toString());
      const proposal = proposals.find(p => p.rfpId.toString() === item._id.toString());
      return {
        ...item,
        generated: !!(draftRFP || proposal),
      }
    }));

    res.status(200).json({ otherRFPs: otherRFPs_1 });
  } catch (err) {
    console.error("Error in /getOtherRFPs:", err.message);
    res.status(500).json({ error: "Failed to load RFPs" });
  }
};

exports.getSavedAndDraftRFPs = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const savedRFPs_1 = await SavedRFP.find({ userEmail }).lean();
    const savedRFPs = savedRFPs_1.map((item) => {
      return {
        ...item.rfp,
        _id: item.rfpId,
      }
    });

    const draftRFPs = await DraftRFP.find({ userEmail })
      .populate('collaborators.owner', '_id fullName email')
      .populate('collaborators.editors', '_id fullName email')
      .sort({ createdAt: -1 }).lean();
    const draftRFPs_1 = draftRFPs.map((item) => {
      return {
        docx_base64: item.docx_base64,
        collaborators: item.collaborators,
        proposalId: item.proposalId,
        rfpId: item.rfpId,
        ...item.rfp,
        _id: item.rfpId,
      }
    });

    res.status(200).json({ savedRFPs, draftRFPs: draftRFPs_1 });
  } catch (err) {
    console.error("Error in /getSavedAndDraftRFPs:", err.message);
    res.status(500).json({ error: "Failed to get saved and draft RFPs" });
  }
};

exports.saveRFP = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }
    const { rfpId, rfp } = req.body;

    if (!rfpId || !rfp) {
      return res.status(400).json({ error: "rfpId and rfp are required" });
    }

    if (!mongoose.Types.ObjectId.isValid(rfpId)) {
      return res.status(400).json({ error: "Invalid RFP ID format" });
    }

    const existing = await SavedRFP.findOne({ userEmail, rfpId });
    if (existing) {
      return res.status(200).json({ message: "RFP already saved" });
    }

    const cleanRFP = {
      title: rfp.title,
      description: rfp.description,
      logo: rfp.logo,
      match: rfp.match || 0,
      budget: rfp.budget,
      deadline: getDeadline(rfp.deadline),
      organization: rfp.organization,
      organizationType: rfp.organizationType,
      link: rfp.link,
      contact: rfp.contact,
      docsLink: rfp.docsLink,
      office: rfp.office,
      issuingOffice: rfp.issuingOffice,
      country: rfp.country,
      state: rfp.state,
      baseType: rfp.baseType,
      setAside: rfp.setAside,
      solicitationNumber: rfp.solicitationNumber,
    };

    const newSave = await SavedRFP.create({ userEmail, rfpId, rfp: cleanRFP });
    res.status(201).json({ message: "RFP saved successfully", saved: newSave });
  } catch (err) {
    console.error("Error in /saveRFP:", err.message);
    res.status(500).json({ error: "Failed to save RFP" });
  }
};

exports.unsaveRFP = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }
    const { rfpId } = req.body;

    if (!rfpId) {
      return res.status(400).json({ error: "rfpId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(rfpId)) {
      return res.status(400).json({ error: "Invalid RFP ID format" });
    }

    await SavedRFP.deleteOne({ userEmail, rfpId });

    res.status(200).json({ message: "RFP unsaved successfully" });
  } catch (err) {
    console.error("Error in /unsaveRFP:", err.message);
    res.status(500).json({ error: "Failed to unsave RFP" });
  }
};

exports.sendDataForProposalGeneration = async (req, res) => {
  try {
    const { proposal } = req.body;

    // Validate proposal object
    if (!proposal) {
      return res.status(400).json({ error: 'Proposal data is required' });
    }

    let userEmail = req.user.email;

    let companyProfile_1 = "";

    let userId = "";

    if (req.user.role === "employee") {

      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });

      if (!employeeProfile) {
        return res.status(404).json({ error: 'Employee profile not found' });
      }

      userEmail = employeeProfile.companyMail;

      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });

      let user = await User.findOne({ email: userEmail });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      userId = user._id;

    } else {
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });

      userId = req.user._id;

    }

    // Check if company profile exists
    if (!companyProfile_1) {
      return res.status(404).json({ error: 'Company profile not found. Please complete your company profile first.' });
    }

    const companyDocuments_1 = (companyProfile_1.documentSummaries || []).map((doc) => {
      return {
        [`${doc.name}`]: `${doc.summary}`,
      };
    });


    const caseStudies_1 = (companyProfile_1.caseStudies || []).map((study) => {
      return {
        [`${study.title}`]: `${study.about}`,
      };
    });


    const pastProjects_1 = (companyProfile_1.proposals || []).map((project) => {
      return {
        "name": `${project.title}`,
      };
    });


    const certifications_1 = (companyProfile_1.licensesAndCertifications || []).map((certification) => {
      return {
        "name": `${certification.name}`,
        "issuer": `${certification.issuer}`,
        "validTill": `${certification.validTill}`,
      };
    });

    const employeeData_1 = (companyProfile_1.employees || []).map((employee) => {
      return {
        "name": `${employee.name}`,
        "jobTitle": `${employee.jobTitle}`,
        "highestQualification": `${employee.highestQualification}`,
        "skills": (employee.skills || []).map(skill => `${skill}`),
        "email": `${employee.email}`,
      };
    });

    const rfp = {
      "RFP Title": `${proposal.title || ""}`,
      "RFP Description": `${proposal.description || ""}`,
      "Match Score": `${proposal.match || 0}`,
      "Budget": `${proposal.budget || ""}`,
      "Deadline": `${proposal.deadline || ""}`,
      "Issuing Organization": `${proposal.organization || "Not found"}`,
      "Industry": `${proposal.organizationType || ""}`,
      "URL": `${proposal.link || ""}`,
      "Contact Information": `${proposal.contact || ""}`,
      "Document Link": `${proposal.docsLink || ""}`,
      "Office": `${proposal.office || ""}`,
      "Issuing Office": `${proposal.issuingOffice || ""}`,
      "Country": `${proposal.country || ""}`,
      "State": `${proposal.state || ""}`,
      "Base Type": `${proposal.baseType || ""}`,
      "Set Aside": `${proposal.setAside || ""}`,
      "Solicitation Number": `${proposal.solicitationNumber || ""}`,
    };

    const userData = {
      "_id": `${companyProfile_1._id}`,
      "email": `${companyProfile_1.email || ""}`,
      "companyName": `${companyProfile_1.companyName || ""}`,
      "companyOverview": `${companyProfile_1.bio || ""}`,
      "yearOfEstablishment": `${companyProfile_1.establishedYear || ""}`,
      "employeeCount": `${companyProfile_1.numberOfEmployees || 0}`,
      "services": (companyProfile_1.services || []).map(service => `${service}`),
      "industry": `${companyProfile_1.industry || ""}`,
      "location": `${companyProfile_1.location || ""}`,
      "website": `${companyProfile_1.website || ""}`,
      "linkedIn": `${companyProfile_1.linkedIn || ""}`,
      "certifications": certifications_1,
      "documents": companyDocuments_1,
      "caseStudies": caseStudies_1,
      "pastProjects": pastProjects_1,
      "employees_information": employeeData_1,
      "awards": (companyProfile_1.awards || []).map(award => `${award}`),
      "clientPortfolio": (companyProfile_1.clients || []).map(client => `${client}`),
      "preferredIndustries": (companyProfile_1.preferredIndustries || []).map(industry => `${industry}`),
      "pointOfContact": {
        "name": `${companyProfile_1.adminName || ""}`,
        "email": `${companyProfile_1.email || ""}`,
      },
    };

    //Check if there is any proposal in draft with the same rfpId
    const draftProposal = await DraftRFP.findOne({ rfpId: proposal._id, userEmail: userEmail });
    if (draftProposal && draftProposal.docx_base64 !== null) {
      return res.status(200).json({ message: 'A proposal with the same RFP ID already exists in draft. Please edit the draft proposal instead of generating a new one.' });
    }

    //Check if there is any proposal in proposal tracker with the same rfpId
    const proposalTracker = await ProposalTracker.findOne({ rfpId: proposal._id, companyMail: userEmail });
    if (proposalTracker) {

      if (proposalTracker.status === "success") {
        const new_prop = await Proposal.findOne({ _id: proposalTracker.proposalId, companyMail: userEmail });
        return res.status(200).json({ message: 'Proposal Generation completed successfully.', proposal: new_prop.docx_base64, proposalId: new_prop._id });
      } else if (proposalTracker.status === "error") {
        await ProposalTracker.deleteOne({ rfpId: proposal._id, companyMail: userEmail });
        return res.status(400).json({ error: 'Failed to generate proposal. Please try again later.' });
      } else if (proposalTracker.status === "progress") {
        //Initilize the api call to mlPipeline to know the status of the proposal generation and update the proposal tracker
        const res_1 = await axios.get(`${process.env.PROPOSAL_PIPELINE_URL}/task-status/${proposalTracker.trackingId}`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
        });

        const res_data = res_1.data;

        if (res_data.status === "success") {
          const document = res_data.result.docx_base64;
          const data = res_data.result.result;
          let new_prop_id = "";

          // Use transaction for data consistency
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const current_subscription = await Subscription.findOne({ user_id: userId });
            if (!current_subscription) {
              await session.abortTransaction();
              return res.status(400).json({ error: 'Subscription not found' });
            }

            let noOfAttempts = current_subscription.plan_name === "Free" ? 0 : current_subscription.plan_name === "Basic" ? 2 : ["Pro", "Enterprise", "Custom Enterprise Plan"].includes(current_subscription.plan_name) ? 3 : 0;

            // Determine editors: if user is not the owner, add them to editors
            const editors = req.user._id.toString() !== userId.toString() ? [req.user._id] : [];

            const new_Proposal = new Proposal({
              rfpId: proposal._id || "",
              noOfAttempts: noOfAttempts,
              title: proposal.title || "",
              client: proposal.organization || "Not found",
              initialProposal: data,
              generatedProposal: data,
              docx_base64: document,
              companyMail: userEmail,
              url: proposal.link || "",
              deadline: getDeadline(proposal.deadline),
              status: "In Progress",
              submittedAt: new Date(),
              isDeleted: false,
              deletedAt: null,
              deletedBy: null,
              isSaved: false,
              savedAt: null,
              savedBy: null,
              restoreBy: null,
              restoredBy: null,
              restoredAt: null,
              maxEditors: current_subscription.max_editors,
              maxViewers: current_subscription.max_viewers,
              collaborators: {
                owner: userId,
                editors: editors,
                viewers: []
              },
            });

            await new_Proposal.save({ session });
            new_prop_id = new_Proposal._id;

            const new_Draft = new DraftRFP({
              userEmail: userEmail,
              rfpId: proposal._id || "",
              proposalId: new_Proposal._id || "",
              rfp: { ...proposal },
              generatedProposal: data,
              docx_base64: document,
              collaborators: {
                owner: userId,
                editors: editors,
                viewers: []
              },
            });
            await new_Draft.save({ session });

            const new_CalendarEvent = new CalendarEvent({
              companyId: companyProfile_1._id,
              employeeId: req.user._id,
              proposalId: new_Proposal._id,
              grantId: null,
              title: proposal.title || "",
              startDate: new Date(),
              endDate: new Date(),
              status: "In Progress",
            });
            await new_CalendarEvent.save({ session });

            //Also add new calendar event with deadline
            const new_CalendarEvent_Deadline = new CalendarEvent({
              companyId: companyProfile_1._id,
              employeeId: req.user._id,
              proposalId: new_Proposal._id,
              grantId: null,
              title: proposal.title || "",
              startDate: getDeadline(proposal.deadline),
              endDate: getDeadline(proposal.deadline),
              status: "Deadline",
            });
            await new_CalendarEvent_Deadline.save({ session });

            proposalTracker.status = "success";
            proposalTracker.proposalId = new_Proposal._id;
            await proposalTracker.save({ session });

            const subscription_1 = await Subscription.findOne({ user_id: userId });
            if (!subscription_1) {
              await session.abortTransaction();
              return res.status(400).json({ error: 'Subscription not found' });
            }

            subscription_1.current_rfp_proposal_generations++;
            await subscription_1.save({ session });

            const companyProfile = await CompanyProfile.findOne({ email: userEmail });
            if (!companyProfile) {
              await session.abortTransaction();
              return res.status(400).json({ error: "Company profile not found" });
            }

            companyProfile.proposals.push({
              title: proposal.title || "Not found",
              company: proposal.organization || "Not found",
              amount: parseFloat(proposal.budget),
              status: "In Progress",
            });

            companyProfile.deadlines.push({
              title: proposal.title || "Not found",
              status: "In Progress",
              dueDate: getDeadline(proposal.deadline),
            });
            await companyProfile.save({ session });

            await session.commitTransaction();
          } catch (error) {
            await session.abortTransaction();
            throw error;
          } finally {
            session.endSession();
          }

          return res.status(200).json({ message: 'Proposal Generation completed successfully.', proposal: document, proposalId: new_prop_id });
        } else if (res_data.status === "processing") {
          return res.status(200).json({ message: 'Proposal Generation is still in progress. Please wait for it to complete.' });
        } else {
          await ProposalTracker.deleteOne({ rfpId: proposal._id, companyMail: userEmail });
          return res.status(400).json({ error: 'Failed to generate proposal. Please try again later.' });
        }
      }
    }

    const subscription = await Subscription.findOne({ user_id: userId });
    if (!subscription || subscription.end_date < new Date()) {
      return res.status(400).json({ error: 'Subscription not found or expired' });
    }

    //Get no.of RFP proposals generated between subscription start date and end date
    if (subscription.max_rfp_proposal_generations <= subscription.current_rfp_proposal_generations) {
      return res.status(400).json({ error: 'You have reached the maximum number of RFP proposals' });
    }

    let data = {
      "user": userData,
      "rfp": rfp,
    };

    // Calculate and log payload size
    const payloadSize = JSON.stringify(data).length;

    // Check if payload is too large (e.g., > 1MB)
    const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB
    if (payloadSize > MAX_PAYLOAD_SIZE) {
      console.warn(`Payload size (${payloadSize} bytes) exceeds recommended limit (${MAX_PAYLOAD_SIZE} bytes)`);

      // Optimize payload by reducing data size
      const optimizedData = {
        user: {
          ...data.user,
          companyOverview: data.user.companyOverview?.substring(0, 2000) || "",
          caseStudies: data.user.caseStudies?.slice(0, 3) || [],
          pastProjects: data.user.pastProjects?.slice(0, 5) || [],
          employees_information: data.user.employees_information?.slice(0, 10) || []
        },
        rfp: data.rfp
      };

      const optimizedPayloadSize = JSON.stringify(optimizedData).length;

      if (optimizedPayloadSize < payloadSize) {
        data = optimizedData;
      }
    }

    // Call ML service to generate proposal
    const res_1 = await axios.post(`${process.env.PROPOSAL_PIPELINE_URL}/new_rfp_proposal_generation`, data, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const res_data = res_1.data;

    if (res_data.status === "submitted") {
      const new_ProposalTracker = new ProposalTracker({
        rfpId: proposal._id,
        companyMail: userEmail,
        status: "progress",
        trackingId: res_data.task_id,
      });
      await new_ProposalTracker.save();

      //Create a new draft proposal
      const editors = req.user._id.toString() !== userId.toString() ? [req.user._id] : [];
      const new_Draft = new DraftRFP({
        userEmail: userEmail,
        rfpId: proposal._id,
        proposalId: null,
        rfp: { ...proposal },
        generatedProposal: null,
        docx_base64: null,
        collaborators: {
          owner: userId,
          editors: editors,
          viewers: []
        },
      });
      await new_Draft.save();

      return res.status(200).json({ message: 'Proposal Generation is in Progress. Please visit again after some time.' });
    }

    return res.status(400).json({ error: 'Failed to generate proposal. Please try again later.' });

  } catch (err) {
    console.error('Error in /sendDataForProposalGeneration:', err);
    // Generic error response
    res.status(500).json({
      error: 'Failed to send data for proposal generation',
      message: err.message || 'An unexpected error occurred'
    });
  }
};

exports.sendDataForRFPDiscovery = async (req, res) => {
  try {
    let userEmail = req.user.email;
    let companyProfile_1 = "";
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: 'Employee profile not found' });
      }
      userEmail = employeeProfile.companyMail;
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
    } else {
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
    }

    // Check if company profile exists
    if (!companyProfile_1) {
      return res.status(404).json({ error: 'Company profile not found. Please complete your company profile first.' });
    }

    const now = new Date();
    const currentHour = now.getHours();

    // ---- Block fetching between 12:00 AM and 4:00 AM ----
    if (currentHour >= 0 && currentHour < 4) {
      return res.status(200).json({
        message: 'RFP discovery is temporarily disabled between 12:00 AM and 4:00 AM while new data is being updated. Please try again after 4:00 AM.'
      });
    }

    // ---- Calculate today's 4:00 AM timestamp ----
    const lastFourAM = new Date();
    if (currentHour < 4) {
      lastFourAM.setDate(lastFourAM.getDate() - 1);
    }
    lastFourAM.setHours(4, 0, 0, 0);

    const fetchedMatchingRFPsAt = companyProfile_1.fetchedMatchingRFPsAt
      ? new Date(companyProfile_1.fetchedMatchingRFPsAt)
      : null;
    const profileUpdatedAt = new Date(companyProfile_1.updatedAt);

    // ---- Check if already fetched after 4 AM and not updated since ----
    const hasFetchedAfterFourAM =
      fetchedMatchingRFPsAt && fetchedMatchingRFPsAt >= lastFourAM;
    const hasProfileUpdatedAfterFetch =
      !fetchedMatchingRFPsAt || profileUpdatedAt > fetchedMatchingRFPsAt;

    if (companyProfile_1.fetchedMatchingRFPs && hasFetchedAfterFourAM && !hasProfileUpdatedAfterFetch) {
      return res.status(200).json({
        message:
          'RFP discovery already completed for today. Please update your company profile or try again after 4:00 AM tomorrow.'
      });
    }

    //Check if company has active subscription
    const subscription = await Subscription.findOne({ user_id: companyProfile_1.userId });

    if (subscription && subscription.plan_name === "Free") {
      return res.status(200).json({ message: 'You are using the free plan. Please upgrade to a paid plan to continue using RFP discovery.' });
    }

    if (!subscription || subscription.end_date < new Date()) {
      return res.status(200).json({ message: 'Subscription not found or expired. Please upgrade to a paid plan to continue using RFP discovery.' });
    }

    const companyDocuments_1 = (companyProfile_1.documentSummaries || []).map((doc) => {
      return {
        [`${doc.name}`]: `${doc.summary}`,
      };
    });

    const caseStudies_1 = (companyProfile_1.caseStudies || []).map((study) => {
      return {
        [`${study.title}`]: `${study.about}`,
      };
    });

    const pastProjects_1 = (companyProfile_1.proposals || []).map((project) => {
      return {
        "name": `${project.title}`,
      };
    });

    const certifications_1 = (companyProfile_1.licensesAndCertifications || []).map((certification) => {
      return {
        "name": `${certification.name}`,
        "issuer": `${certification.issuer}`,
        "validTill": `${certification.validTill}`,
      };
    });

    const employeeData_1 = (companyProfile_1.employees || []).map((employee) => {
      return {
        "name": `${employee.name}`,
        "jobTitle": `${employee.jobTitle}`,
        "highestQualification": `${employee.highestQualification}`,
        "skills": (employee.skills || []).map(skill => `${skill}`),
        "email": `${employee.email}`,
      };
    });

    const userData = {
      "_id": `${companyProfile_1._id}`,
      "email": `${companyProfile_1.email || ""}`,
      "companyName": `${companyProfile_1.companyName || ""}`,
      "companyOverview": `${companyProfile_1.bio || ""}`,
      "yearOfEstablishment": companyProfile_1.establishedYear || "",
      "employeeCount": `${companyProfile_1.numberOfEmployees || 0}`,
      "services": (companyProfile_1.services || []).map(service => `${service}`),
      "industry": `${companyProfile_1.industry || ""}`,
      "location": `${companyProfile_1.location || ""}`,
      "website": `${companyProfile_1.website || ""}`,
      "linkedIn": `${companyProfile_1.linkedIn || ""}`,
      "certifications": certifications_1,
      "documents": companyDocuments_1,
      "caseStudies": caseStudies_1,
      "pastProjects": pastProjects_1,
      "employees_information": employeeData_1,
      "awards": (companyProfile_1.awards || []).map(award => `${award}`),
      "clientPortfolio": (companyProfile_1.clients || []).map(client => `${client}`),
      "preferredIndustries": (companyProfile_1.preferredIndustries || []).map(industry => `${industry}`),
      "pointOfContact": {
        "name": `${companyProfile_1.adminName || ""}`,
        "email": `${companyProfile_1.email || ""}`,
      }
    };

    const res_1 = await axios.post(`${process.env.PIPELINE_URL}/run-rfp-discovery`, userData);

    const matches = res_1.data.matches;

    const transformedData = [];

    if (Array.isArray(matches)) {
      for (const rfp of matches) {
        transformedData.push({
          title: rfp.title || "",
          description: rfp.description || "",
          logo: rfp.logo || 'None',
          match: rfp.matching_percentage || 0,
          budget: rfp.budget || 'Not found',
          deadline: getDeadline(rfp.deadline),
          organization: rfp.organization || "",
          organizationType: rfp.organizationType || "",
          baseType: rfp.BaseType || "",
          setAside: rfp.SetASide || "",
          solicitationNumber: rfp.solicitation_number || "",
          link: rfp.link || "",
          type: 'Matched',
          contact: rfp.contact || "",
          office: rfp.office || "",
          issuingOffice: rfp.issuingOffice || "",
          country: rfp.country || "",
          state: rfp.state || "",
          docsLink: rfp.docsLink || "",
          email: companyProfile_1.email || ""
        });
      }
    }

    // Validate all required fields
    const requiredFields = [
      'title', 'description', 'logo', 'match', 'budget', 'deadline',
      'organization', 'office', 'issuingOffice', 'country', 'state', 'organizationType', 'link', 'type', 'contact', 'docsLink', 'baseType', 'setAside', 'solicitationNumber', 'email'
    ];

    const invalidEntry = transformedData.find(rfp =>
      requiredFields.some(field => rfp[field] === undefined || rfp[field] === null)
    );

    if (invalidEntry) {
      // Invalid entry found but continuing processing
    }

    // Fetch existing matched RFPs and create a lookup map
    const solicitationNumbers = transformedData.map(rfp => rfp.solicitationNumber).filter(Boolean);
    const existingRFPs = await MatchedRFP.find({
      solicitationNumber: { $in: solicitationNumbers }
    });

    // Create a map for O(1) lookup
    const existingRFPMap = new Map();
    existingRFPs.forEach(rfp => {
      existingRFPMap.set(rfp.solicitationNumber, rfp);
    });

    // Process RFPs with efficient lookup
    const result = await Promise.all(transformedData.map(async (rfp) => {
      try {
        const existingRFP = existingRFPMap.get(rfp.solicitationNumber);
        if (existingRFP) {
          //Update the existing RFP
          existingRFP.title = rfp.title;
          existingRFP.description = rfp.description;
          existingRFP.logo = rfp.logo;
          existingRFP.match = rfp.match;
          existingRFP.budget = rfp.budget;
          existingRFP.deadline = rfp.deadline;
          existingRFP.organization = rfp.organization;
          existingRFP.office = rfp.office;
          existingRFP.issuingOffice = rfp.issuingOffice;
          existingRFP.country = rfp.country;
          existingRFP.state = rfp.state;
          existingRFP.organizationType = rfp.organizationType;
          existingRFP.link = rfp.link;
          existingRFP.type = rfp.type;
          existingRFP.contact = rfp.contact;
          existingRFP.docsLink = rfp.docsLink;
          existingRFP.baseType = rfp.baseType;
          existingRFP.setAside = rfp.setAside;
          existingRFP.solicitationNumber = rfp.solicitationNumber;
          await existingRFP.save();
          return existingRFP;
        } else {
          return await MatchedRFP.create(rfp);
        }
      } catch (error) {
        console.error(`Error processing RFP ${rfp.solicitationNumber}:`, error);
        return null; // or handle the error as needed
      }
    }));

    // Filter out any null results from failed operations
    const successfulResults = result.filter(rfp => rfp !== null);

    // await CompanyProfile.findOneAndUpdate({ userId: companyProfile_1.userId }, { fetchedMatchingRFPs: true, fetchedMatchingRFPsAt: new Date() });
    const updatedProfile = await CompanyProfile.findOneAndUpdate(
      { userId: companyProfile_1.userId },
      {
        fetchedMatchingRFPs: true,
        fetchedMatchingRFPsAt: new Date(),
      },
      { new: true, timestamps: false }
    );

    res.status(200).json({
      message: 'RFP discovery completed successfully',
      totalProcessed: transformedData.length,
      successful: successfulResults.length,
      failed: transformedData.length - successfulResults.length
    });
  } catch (err) {
    console.error('Error in /sendDataForRFPDiscovery:', err.message);
    res.status(500).json({ error: err.message || 'Failed to send data for RFP discovery' });
  }
};

exports.handleFileUploadAndSendForRFPExtraction = [
  (req, res, next) => {
    singleFileUpload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large. Maximum size is 10MB.',
            details: { code: err.code, field: err.field }
          });
        }
        return res.status(400).json({
          error: 'File upload error',
          details: err.message
        });
      } else if (err) {
        console.error('File upload error:', err);
        return res.status(400).json({
          error: err.message || 'File upload failed'
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded'
        });
      }

      // File validation using utility function
      const validation = validateFile(req.file);
      if (!validation.isValid) {
        // Clean up uploaded file on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({
          error: 'File validation failed',
          details: validation.errors
        });
      }

      // Get user email
      let userEmail = req.user.email;
      if (req.user.role === "employee") {
        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        if (!employeeProfile) {
          // Clean up uploaded file on error
          await cleanupUploadedFiles(req);
          return res.status(404).json({ error: 'Employee profile not found' });
        }
        userEmail = employeeProfile.companyMail;
      }

      // Retrieve file from GridFS since req.file.buffer is undefined with GridFS storage
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads'
      });

      // Get the file stream from GridFS
      const downloadStream = bucket.openDownloadStream(req.file.id);

      // Convert stream to buffer
      const chunks = [];
      const fileBuffer = await new Promise((resolve, reject) => {
        downloadStream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        downloadStream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
        downloadStream.on('error', (error) => {
          reject(error);
        });
      });

      // Create FormData for the external API
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      // Send file to external API with retry mechanism
      let apiResponse;
      let retryCount = 1;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          apiResponse = await axios.post(`${process.env.PIPELINE_URL}/extract-structured-rfp`, formData, {
            headers: {
              ...formData.getHeaders(),
            },
            timeout: 60000, // 60 second timeout for large files
          });
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw error; // Re-throw the error if all retries failed
          }
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      // Extract RFP data from API response
      let rfp = null;
      if (apiResponse.data && apiResponse.data.result && typeof apiResponse.data.result === 'object') {
        const resultKeys = Object.keys(apiResponse.data.result);
        if (resultKeys.length > 0) {
          const firstKey = resultKeys[0];
          const structuredData = apiResponse.data.result[firstKey];

          if (structuredData && structuredData.structured_fields) {
            const fields = structuredData.structured_fields;

            rfp = {
              title: fields['RFP Title'] || req.file.originalname.replace('.pdf', "").replace('.txt', ""),
              description: fields['RFP Description'] || `RFP extracted from uploaded file: ${req.file.originalname}`,
              organization: fields['Issuing Organization'] || 'Unknown',
              organizationType: fields['Industry'] || 'Unknown',
              link: fields['url'] || `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`,
              budget: fields['Budget or Funding Limit'] || 'Not specified',
              deadline: getDeadline(fields['Submission Deadline']) || 'Not specified',
              contact: fields['Contact Information'] || "",
              office: fields['Office'] || "",
              issuingOffice: fields['Issuing Office'] || "",
              country: fields['Country'] || "",
              state: fields['State'] || "",
              baseType: fields['Base Type'] || "",
              setAside: fields['Set Aside'] || "",
              solicitationNumber: fields['Solicitation Number'] || "",
              docsLink: fields['Document Link'] || "",
              proposalInstructions: fields['Proposal Submission Instructions'] || "",
              projectGoals: fields['Project Goals and Objectives'] || "",
              scopeOfWork: fields['Scope of Work'] || "",
              logo: "None"
            };
          }
        }
      }

      // Create fallback RFP if API data extraction failed
      if (!rfp) {
        rfp = {
          title: "No RFP Title found in the uploaded file",
          description: "No RFP Description found in the uploaded file",
          organization: 'Unknown',
          organizationType: 'Unknown',
          link: `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`,
          budget: 'Not specified',
          deadline: getDeadline('Not specified'),
          contact: "Unknown",
          office: "Unknown",
          issuingOffice: "Unknown",
          country: "Unknown",
          state: "Unknown",
          baseType: "Unknown",
          setAside: "Unknown",
          solicitationNumber: "Unknown",
          docsLink: "Unknown",
          logo: "None"
        };
      }

      // Enhance description with additional extracted information
      let enhancedDescription = rfp.description;
      if (rfp.projectGoals) {
        enhancedDescription += `\n\nProject Goals: ${rfp.projectGoals}`;
      }
      if (rfp.scopeOfWork) {
        enhancedDescription += `\n\nScope of Work: ${rfp.scopeOfWork}`;
      }
      if (rfp.proposalInstructions) {
        enhancedDescription += `\n\nSubmission Instructions: ${rfp.proposalInstructions}`;
      }

      const newRFP = await MatchedRFP.create({
        title: rfp.title,
        description: enhancedDescription,
        organization: rfp.organization || "",
        baseType: rfp.baseType || "",
        setAside: rfp.setAside || "",
        solicitationNumber: rfp.solicitationNumber || "",
        office: rfp.office || "",
        issuingOffice: rfp.issuingOffice || "",
        country: rfp.country || "",
        state: rfp.state || "",
        organizationType: rfp.organizationType || "",
        link: rfp.link || `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`,
        email: userEmail,
        budget: rfp.budget || 'Not found',
        deadline: getDeadline(rfp.deadline),
        contact: rfp.contact || "",
        docsLink: rfp.docsLink || "",
        match: 100.00,
        logo: 'None',
        type: 'Uploaded',
      });

      res.status(200).json({
        message: 'RFP extracted and saved successfully',
        rfp: newRFP,
        fileInfo: {
          originalName: req.file.originalname,
          size: formatFileSize(req.file.size),
          type: req.file.mimetype
        }
      });

    } catch (err) {
      // Clean up uploaded file if it exists and there was an error
      await cleanupUploadedFiles(req);

      // Handle specific error types
      if (err.response?.status === 422) {
        return res.status(422).json({
          error: 'File format not supported or invalid content',
          details: err.response.data
        });
      }

      if (err.response?.status === 400) {
        return res.status(400).json({
          error: 'Invalid request to RFP extraction service',
          details: err.response.data
        });
      }

      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
        return res.status(503).json({ error: 'RFP extraction service is unavailable' });
      }

      // Generic error response
      res.status(500).json({
        error: 'Failed to handle file upload and send for RFP extraction'
      });
    }
  }
];

exports.handleFileUploadAndSendForGrantExtraction = [
  (req, res, next) => {
    singleFileUpload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large. Maximum size is 10MB.',
            details: { code: err.code, field: err.field }
          });
        }
        return res.status(400).json({
          error: 'File upload error',
          details: err.message
        });
      } else if (err) {
        console.error('File upload error:', err);
        return res.status(400).json({
          error: err.message || 'File upload failed'
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded'
        });
      }

      // File validation using utility function
      const validation = validateFile(req.file);
      if (!validation.isValid) {
        // Clean up uploaded file on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({
          error: 'File validation failed',
          details: validation.errors
        });
      }

      // Get user email
      let userEmail = req.user.email;
      if (req.user.role === "employee") {
        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        if (!employeeProfile) {
          // Clean up uploaded file on error
          await cleanupUploadedFiles(req);
          return res.status(404).json({ error: 'Employee profile not found' });
        }
        userEmail = employeeProfile.companyMail;
      }

      // Retrieve file from GridFS since req.file.buffer is undefined with GridFS storage
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads'
      });

      // Get the file stream from GridFS
      const downloadStream = bucket.openDownloadStream(req.file.id);

      // Convert stream to buffer
      const chunks = [];
      const fileBuffer = await new Promise((resolve, reject) => {
        downloadStream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        downloadStream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
        downloadStream.on('error', (error) => {
          reject(error);
        });
      });

      // Create FormData for the external API
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      // Send file to external API with retry mechanism
      let apiResponse;
      let retryCount = 1;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          apiResponse = await axios.post(`${process.env.PIPELINE_URL}/extract-structured-grant`, formData, {
            headers: {
              ...formData.getHeaders(),
            },
            timeout: 60000, // 60 second timeout for large files
          });
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw error; // Re-throw the error if all retries failed
          }
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      // Extract Grant data from API response
      let grant = null;
      if (apiResponse.data && apiResponse.data.result && typeof apiResponse.data.result === 'object') {
        const resultKeys = Object.keys(apiResponse.data.result);
        if (resultKeys.length > 0) {
          const firstKey = resultKeys[0];
          const structuredData = apiResponse.data.result[firstKey];

          if (structuredData && structuredData.structured_fields) {
            const fields = structuredData.structured_fields;

            grant = fields;
          }
        }
      }

      // Create fallback Grant if API data extraction failed
      const fallbackGrant = {
        OPPORTUNITY_NUMBER: grant?.OPPORTUNITY_NUMBER || "Not Provided",
        OPPORTUNITY_ID: grant?.OPPORTUNITY_ID || "Not Provided",
        OPPORTUNITY_NUMBER_LINK: grant?.OPPORTUNITY_NUMBER_LINK || `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`,
        OPPORTUNITY_TITLE: grant?.OPPORTUNITY_TITLE || "Not Provided",
        AGENCY_CODE: grant?.AGENCY_CODE || "Not Provided",
        AGENCY_NAME: grant?.AGENCY_NAME || "Not Provided",
        CATEGORY_OF_FUNDING_ACTIVITY: grant?.CATEGORY_OF_FUNDING_ACTIVITY || "Not Provided",
        FUNDING_CATEGORY_EXPLANATION: grant?.FUNDING_CATEGORY_EXPLANATION || "Not Provided",
        FUNDING_INSTRUMENT_TYPE: grant?.FUNDING_INSTRUMENT_TYPE || "Not Provided",
        ASSISTANCE_LISTINGS: grant?.ASSISTANCE_LISTINGS || "Not Provided",
        ESTIMATED_TOTAL_FUNDING: grant?.ESTIMATED_TOTAL_FUNDING || "Not Provided",
        EXPECTED_NUMBER_OF_AWARDS: grant?.EXPECTED_NUMBER_OF_AWARDS || "Not Provided",
        AWARD_CEILING: grant?.AWARD_CEILING || "Not Provided",
        AWARD_FLOOR: grant?.AWARD_FLOOR || "Not Provided",
        COST_SHARING_MATCH_REQUIRMENT: grant?.COST_SHARING_MATCH_REQUIRMENT || "Not Provided",
        LINK_TO_ADDITIONAL_INFORMATION: grant?.LINK_TO_ADDITIONAL_INFORMATION || `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`,
        GRANTOR_CONTACT: grant?.GRANTOR_CONTACT || "Not Provided",
        GRANTOR_CONTACT_PHONE: grant?.GRANTOR_CONTACT_PHONE || "Not Provided",
        GRANTOR_CONTACT_EMAIL: grant?.GRANTOR_CONTACT_EMAIL || "Not Provided",
        ESTIMATED_POST_DATE: grant?.ESTIMATED_POST_DATE || "Not Provided",
        ESTIMATED_APPLICATION_DUE_DATE: grant?.ESTIMATED_APPLICATION_DUE_DATE || "Not Provided",
        POSTED_DATE: grant?.POSTED_DATE || "Not Provided",
        CLOSE_DATE: grant?.CLOSE_DATE || "Not Provided",
        OPPORTUNITY_STATUS: grant?.OPPORTUNITY_STATUS || "Posted",
        FUNDING_DESCRIPTION: grant?.FUNDING_DESCRIPTION || "Not Provided",
        ELIGIBLE_APPLICANTS: grant?.ELIGIBLE_APPLICANTS || "Not Provided",
      };

      grant = fallbackGrant;

      const newGrant = await Grant.create(grant);

      res.status(200).json({
        message: 'Grant extracted and saved successfully',
        grant: newGrant,
        fileInfo: {
          originalName: req.file.originalname,
          size: formatFileSize(req.file.size),
          type: req.file.mimetype
        }
      });

    } catch (err) {
      // Clean up uploaded file if it exists and there was an error
      await cleanupUploadedFiles(req);

      if (err.response?.status === 422) {
        return res.status(422).json({
          error: 'File format not supported or invalid content',
          details: err.response.data
        });
      }

      if (err.response?.status === 400) {
        return res.status(400).json({
          error: 'Invalid request to Grant extraction service',
          details: err.response.data
        });
      }

      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
        return res.status(503).json({ error: 'Grant extraction service is unavailable' });
      }

      // Generic error response
      res.status(500).json({
        error: err.message
      });
    }
  }
];

exports.saveGrant = async (req, res) => {
  try {
    // Validate user exists
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const { grantId } = req.body;

    if (!grantId) {
      return res.status(400).json({ message: "Grant ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(grantId)) {
      return res.status(400).json({ message: "Invalid grant ID format" });
    }

    //Check existing saved grant
    const existingSavedGrant = await SavedGrant.findOne({ userEmail: userEmail, grantId: grantId });
    if (existingSavedGrant) {
      return res.status(200).json({ message: "Grant already saved" });
    }

    const grant = await Grant.findOne({ _id: grantId });
    if (!grant) {
      return res.status(404).json({ message: "Grant not found" });
    }
    const new_SavedGrant = new SavedGrant({
      grantId: grant._id,
      userEmail: userEmail,
      grant_data: grant,
    });
    await new_SavedGrant.save();
    res.status(200).json({ message: "Grant saved successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.unsaveGrant = async (req, res) => {
  try {
    // Validate user exists
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const { grantId } = req.body;
    if (!grantId) {
      return res.status(400).json({ message: "Grant ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(grantId)) {
      return res.status(400).json({ message: "Invalid grant ID format" });
    }

    const grant = await SavedGrant.findOne({ userEmail: userEmail, grantId: grantId });
    if (!grant) {
      return res.status(404).json({ message: "Grant not found" });
    }
    await grant.deleteOne();
    res.status(200).json({ message: "Grant unsaved successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRecentAndSavedGrants = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let userEmail = req.user.email;

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    // Get all grants for recent grants
    const recentGrants = await Grant.find().sort({ createdAt: -1 }).limit(15).lean();

    const grantIds = recentGrants.map(g => g._id);

    const draftGrants = await DraftGrant.find({ userEmail: userEmail, grantId: { $in: grantIds } }).lean();
    const proposals = await GrantProposal.find({ companyMail: userEmail, grantId: { $in: grantIds } }).lean();

    const recentGrants_1 = await Promise.all(recentGrants.map(async (item) => {
      const draftGrant = draftGrants.find((draft) => draft.grantId.toString() === item._id.toString());
      const proposal = proposals.find((proposal) => proposal.grantId.toString() === item._id.toString());
      return {
        ...item,
        generated: !!(draftGrant || proposal),
      }
    }));

    const savedGrants = await SavedGrant.find({ userEmail: userEmail }).sort({ createdAt: -1 }).lean();

    res.status(200).json({ recentGrants: recentGrants_1, savedGrants });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getOtherGrants = async (req, res) => {
  try {
    const categories = req.body.category;
    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const otherGrants = await Grant.find({ CATEGORY_OF_FUNDING_ACTIVITY: { $in: categories } }).lean();

    const grantIds = otherGrants.map(g => g._id);


    const draftGrants = await DraftGrant.find({ userEmail: userEmail, grantId: { $in: grantIds } }).lean();
    const proposals = await GrantProposal.find({ companyMail: userEmail, grantId: { $in: grantIds } }).lean();

    const otherGrants_1 = await Promise.all(otherGrants.map(async (item) => {
      const draftGrant = draftGrants.find((draft) => draft.grantId.toString() === item._id.toString());
      const proposal = proposals.find((proposal) => proposal.grantId.toString() === item._id.toString());
      return {
        ...item,
        generated: !!(draftGrant || proposal),
      }
    }));

    res.status(200).json(otherGrants_1);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSavedAndDraftGrants = async (req, res) => {
  try {
    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    const savedGrants = await SavedGrant.find({ userEmail: userEmail }).sort({ createdAt: -1 }).lean();
    const savedGrants_1 = savedGrants.map((item) => {
      return {
        _id: item.grant_data._id,
        ...item.grant_data,
      };
    });


    const draftGrants = await DraftGrant.find({ userEmail: userEmail })
      .populate('collaborators.owner', '_id fullName email')
      .populate('collaborators.editors', '_id fullName email')
      .sort({ createdAt: -1 }).lean();
    const draftGrants_1 = draftGrants.map((item) => {
      return {
        _id: item.grant._id,
        ...item.grant,
        docx_base64: item.docx_base64,
        collaborators: item.collaborators,
        proposalId: item.proposalId,
        grantId: item.grantId,
      };
    });
    res.status(200).json({ savedGrants: savedGrants_1, draftGrants: draftGrants_1 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.sendGrantDataForProposalGeneration = async (req, res) => {
  try {
    const { grant, formData } = req.body;

    // Validate grant object
    if (!grant || !formData) {
      return res.status(400).json({ error: "Grant data and form data are required" });
    }

    let userEmail = req.user.email;

    let userId = "";

    let companyProfile_1 = "";

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found. Please complete your employee profile first." });
      }
      userEmail = employeeProfile.companyMail;
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      const user = await User.findOne({ email: userEmail });
      userId = user._id;
    } else {
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      userId = req.user._id;
    }

    // Check if company profile exists
    if (!companyProfile_1) {
      return res.status(404).json({ error: "Company profile not found. Please complete your company profile first." });
    }

    const companyDocuments_1 = (companyProfile_1.documentSummaries || []).map((doc) => {
      return {
        [`${doc.name}`]: `${doc.summary}`,
      };
    });

    const caseStudies_1 = (companyProfile_1.caseStudies || []).map((study) => {
      return {
        [study.title]: study.about,
      };
    });

    const pastProjects_1 = (companyProfile_1.proposals || []).map((project) => {
      return {
        name: project.title,
      };
    });

    const certifications_1 = (companyProfile_1.licensesAndCertifications || []).map((certification) => {
      return {
        name: certification.name,
        issuer: certification.issuer,
        validTill: certification.validTill,
      };
    });

    const employeeData_1 = (companyProfile_1.employees || []).map((employee) => {
      return {
        name: employee.name,
        jobTitle: employee.jobTitle,
        highestQualification: employee.highestQualification,
        skills: employee.skills,
        email: employee.email,
      };
    });

    const userData = {
      "_id": companyProfile_1._id,
      "email": companyProfile_1.email || "",
      "companyName": companyProfile_1.companyName || "",
      "companyOverview": companyProfile_1.bio || "",
      "yearOfEstablishment": companyProfile_1.establishedYear || "",
      "employeeCount": companyProfile_1.numberOfEmployees || 0,
      "services": companyProfile_1.services || [],
      "industry": companyProfile_1.industry || "",
      "location": companyProfile_1.location || "",
      "website": companyProfile_1.website || "",
      "linkedIn": companyProfile_1.linkedIn || "",
      "certifications": certifications_1,
      "documents": companyDocuments_1,
      "caseStudies": caseStudies_1,
      "pastProjects": pastProjects_1,
      "employees_information": employeeData_1,
      "awards": companyProfile_1.awards || [],
      "clientPortfolio": companyProfile_1.clients || [],
      "preferredIndustries": companyProfile_1.preferredIndustries || [],
      "pointOfContact": {
        "name": companyProfile_1.adminName || "",
        "email": companyProfile_1.email || "",
      }
    };

    // Check if there is any proposal in draft with the same grantId
    const draftProposal = await DraftGrant.findOne({ grantId: grant._id, userEmail: userEmail });
    if (draftProposal && draftProposal.docx_base64 !== null) {
      return res.status(200).json({ message: "A proposal with the same Grant ID already exists in draft. Please edit the draft proposal instead of generating a new one." });
    }

    // Check if there is any proposal in proposal tracker with the same grantId
    const proposalTracker = await ProposalTracker.findOne({ grantId: grant._id, companyMail: userEmail });
    if (proposalTracker) {
      if (proposalTracker.status === "success") {
        const new_prop = await GrantProposal.findOne({ _id: proposalTracker.proposalId, companyMail: userEmail });
        return res.status(200).json({ message: "Grant Proposal Generation completed successfully.", proposal: new_prop.docx_base64, proposalId: new_prop._id });
      } else if (proposalTracker.status === "error") {
        await ProposalTracker.deleteOne({ grantId: grant._id, companyMail: userEmail });
        return res.status(400).json({ error: "Failed to generate grant proposal. Please try again later." });
      } else if (proposalTracker.status === "progress") {
        //Initilize the api call to mlPipeline to know the status of the grant proposal generation
        const res_1 = await axios.get(`${process.env.PROPOSAL_PIPELINE_URL}/task-status/${proposalTracker.trackingId}`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
        });
        const res_data = res_1.data;

        if (res_data.status === "success") {
          const document = res_data.result.docx_base64;
          const data = res_data.result.result;
          let new_prop_id = "";

          // Use transaction for data consistency
          const session = await mongoose.startSession();
          session.startTransaction();

          const current_subscription = await Subscription.findOne({ user_id: userId });
          if (!current_subscription) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Subscription not found' });
          }

          try {
            // Determine editors: if user is not the owner, add them to editors
            const editors = req.user._id.toString() !== userId.toString() ? [req.user._id] : [];

            const new_prop = new GrantProposal({
              grantId: grant._id,
              project_inputs: formData,
              initialProposal: data,
              generatedProposal: data,
              docx_base64: document,
              title: grant.OPPORTUNITY_TITLE,
              client: userData.companyName,
              companyMail: userEmail,
              deadline: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
              url: grant.OPPORTUNITY_NUMBER_LINK || "",
              status: "In Progress",
              submittedAt: new Date(),
              isDeleted: false,
              deletedAt: null,
              deletedBy: null,
              isSaved: false,
              savedAt: null,
              savedBy: null,
              isRestored: false,
              restoredAt: null,
              restoredBy: null,
              restoredAt: null,
              maxEditors: current_subscription.max_editors,
              maxViewers: current_subscription.max_viewers,
              collaborators: {
                owner: userId,
                editors: editors,
                viewers: []
              },
            });
            await new_prop.save({ session });
            new_prop_id = new_prop._id;

            const new_Draft = new DraftGrant({
              grantId: grant._id,
              userEmail: userEmail,
              grant: grant,
              generatedProposal: data,
              docx_base64: document,
              collaborators: {
                owner: userId,
                editors: editors,
                viewers: []
              },
              proposalId: new_prop._id,
            });
            await new_Draft.save({ session });

            const new_CalendarEvent = new CalendarEvent({
              companyId: companyProfile_1._id,
              employeeId: req.user._id,
              proposalId: new_prop._id,
              grantId: grant._id,
              title: grant.OPPORTUNITY_TITLE,
              startDate: new Date(),
              endDate: new Date(),
              status: "In Progress",
            });
            await new_CalendarEvent.save({ session });

            //Also add new calendar event with deadline
            const new_CalendarEvent_Deadline = new CalendarEvent({
              companyId: companyProfile_1._id,
              employeeId: req.user._id,
              proposalId: null,
              grantId: grant._id,
              title: grant.OPPORTUNITY_TITLE,
              startDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
              endDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
              status: "Deadline",
            });
            await new_CalendarEvent_Deadline.save({ session });

            proposalTracker.status = "success";
            proposalTracker.grantProposalId = new_prop._id;
            await proposalTracker.save({ session });

            current_subscription.current_grant_proposal_generations++;
            await current_subscription.save({ session });

            const companyProfile = await CompanyProfile.findOne({ email: userEmail });
            if (!companyProfile) {
              await session.abortTransaction();
              return res.status(400).json({ error: "Company profile not found" });
            }

            companyProfile.proposals.push({
              title: grant.OPPORTUNITY_TITLE,
              company: grant.AGENCY_NAME,
              amount: parseFloat(grant.ESTIMATED_TOTAL_FUNDING),
              status: "In Progress",
            });

            companyProfile.deadlines.push({
              title: grant.OPPORTUNITY_TITLE,
              status: "In Progress",
              dueDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
            });
            await companyProfile.save({ session });

            await session.commitTransaction();
          } catch (error) {
            await session.abortTransaction();
            throw error;
          } finally {
            session.endSession();
          }

          return res.status(200).json({ message: 'Grant Proposal Generation completed successfully.', proposal: document, proposalId: new_prop_id });

        } else if (res_data.status === "processing") {
          return res.status(200).json({ message: 'Grant Proposal Generation is still in progress. Please wait for it to complete.' });
        } else {
          await ProposalTracker.deleteOne({ grantId: grant._id, companyMail: userEmail });
          return res.status(400).json({ error: 'Failed to generate grant proposal. Please try again later.' });
        }
      }
    }

    const subscription = await Subscription.findOne({ user_id: userId });
    if (!subscription || subscription.end_date < new Date()) {
      return res.status(404).json({ error: 'Subscription not found or expired. Please upgrade your subscription to generate more proposals.' });
    }

    if (subscription.max_grant_proposal_generations <= subscription.current_grant_proposal_generations) {
      return res.status(400).json({ error: 'You have reached the maximum number of grant proposals. Please upgrade your subscription to generate more proposals.' });
    }

    const data = {
      user: userData,
      grant_data: grant,
      project_inputs: formData,
    };

    const res_1 = await axios.post(`${process.env.PROPOSAL_PIPELINE_URL}/new_grant_proposal_generation`, data);
    const res_data = res_1.data;


    const new_tracker = new ProposalTracker({
      grantId: grant._id,
      trackingId: res_data.task_id,
      companyMail: userEmail,
      status: "progress",
      formData: formData,
      grantProposalId: null,
    });
    await new_tracker.save();

    //Create a new draft proposal
    const editors = req.user._id.toString() !== userId.toString() ? [req.user._id] : [];
    const new_Draft = new DraftGrant({
      grantId: grant._id,
      userEmail: userEmail,
      grant: grant,
      generatedProposal: null,
      docx_base64: null,
      collaborators: {
        owner: userId,
        editors: editors,
        viewers: []
      },
      proposalId: null,
    });
    await new_Draft.save();

    return res.status(200).json({ message: 'Grant Proposal Generation is in Progress. Please visit again after some time.' });

  } catch (err) {
    console.error('Error in /sendDataForProposalGeneration:', err);
    return res.status(500).json({ error: 'Failed to send data for proposal generation' });
  }
};

exports.getRFPProposal = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const { proposal } = req.body;

    if (!proposal || !proposal.rfpId) {
      return res.status(400).json({ error: "RFP ID is required" });
    }

    let rfp = null;
    rfp = await RFP.findOne({ _id: proposal.rfpId });
    if (!rfp) {
      //Check in matched RFPs
      rfp = await MatchedRFP.findOne({ _id: proposal.rfpId });
    }
    if (!rfp) {
      return res.status(400).json({ error: "RFP not found" });
    }

    let userEmail = req.user.email;
    let userId = "";

    let companyProfile_1 = "";

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found. Please complete your employee profile first." });
      }
      userEmail = employeeProfile.companyMail;
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      const user = await User.findOne({ email: userEmail });
      userId = user._id;
    } else {
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      userId = req.user._id;
    }

    //Check if a draft proposal with the same rfpId already exists and is not null
    const draftProposal = await DraftRFP.findOne({ rfpId: proposal.rfpId, userEmail: userEmail });
    if (draftProposal && draftProposal.docx_base64 !== null) {
      return res.status(200).json({ message: "Proposal Generated successfully.", proposal: draftProposal.docx_base64, proposalId: draftProposal.proposalId });
    }

    //Check if a proposal tracker with the same rfpId already exists
    const proposalTracker = await ProposalTracker.findOne({ rfpId: proposal.rfpId, companyMail: userEmail });

    if (!proposalTracker) {
      return res.status(404).json({ error: "Proposal tracker not found" });
    }

    if (proposalTracker.status === "success") {
      const proposal = await Proposal.findOne({ _id: proposalTracker.proposalId, companyMail: userEmail });
      return res.status(200).json({ message: "Proposal Generated successfully.", proposal: proposal.docx_base64, proposalId: proposal._id });
    } else if (proposalTracker.status === "error") {
      await ProposalTracker.deleteOne({ rfpId: proposal.rfpId, companyMail: userEmail });
      return res.status(400).json({ error: "Failed to generate proposal. Please try again later." });
    } else if (proposalTracker.status === "progress") {

      const res_1 = await axios.get(`${process.env.PROPOSAL_PIPELINE_URL}/task-status/${proposalTracker.trackingId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
      });
      const res_data = res_1.data;
      if (res_data.status === "success") {
        const document = res_data.result.docx_base64;
        const data = res_data.result.result;

        let new_prop_id;
        const session = await mongoose.startSession();
        session.startTransaction();
        try {

          const new_Draft = await DraftRFP.findOne({ rfpId: proposal.rfpId, userEmail: userEmail });

          // Get editors from draft, or use empty array if draft doesn't exist
          const draftEditors = new_Draft && new_Draft.collaborators && new_Draft.collaborators.editors.length > 0
            ? new_Draft.collaborators.editors
            : (req.user._id.toString() !== userId.toString() ? [req.user._id] : []);
          // Use first editor or owner for calendar event
          const employeeIdForCalendar = draftEditors.length > 0 ? draftEditors[0] : userId;

          const current_subscription = await Subscription.findOne({ user_id: userId });

          if (!current_subscription) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Subscription not found' });
          }

          let noOfAttempts = current_subscription.plan_name === "Free" ? 0 : current_subscription.plan_name === "Basic" ? 2 : ["Pro", "Enterprise", "Custom Enterprise Plan"].includes(current_subscription.plan_name) ? 3 : 0;

          const new_prop = new Proposal({
            rfpId: proposal.rfpId,
            noOfAttempts: noOfAttempts,
            initialProposal: data,
            generatedProposal: data,
            docx_base64: document,
            title: proposal.title || "Not found",
            client: proposal.organization || "Not found",
            companyMail: userEmail,
            deadline: getDeadline(proposal.deadline),
            url: proposal.url || "",
            status: "In Progress",
            submittedAt: new Date(),
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
            isSaved: false,
            savedAt: null,
            savedBy: null,
            restoreBy: null,
            restoredBy: null,
            restoredAt: null,
            maxEditors: current_subscription.max_editors,
            maxViewers: current_subscription.max_viewers,
            collaborators: {
              owner: userId,
              editors: draftEditors,
              viewers: []
            },
          });
          await new_prop.save({ session });
          new_prop_id = new_prop._id;

          if (new_Draft) {
            new_Draft.docx_base64 = document;
            new_Draft.generatedProposal = data;
            new_Draft.proposalId = new_prop_id;
            // Update collaborators if they exist
            if (new_Draft.collaborators) {
              new_Draft.collaborators.editors = draftEditors;
            }
            await new_Draft.save({ session });
          } else {
            const newDraft = new DraftRFP({
              rfpId: proposal.rfpId,
              userEmail: userEmail,
              rfp: proposal,
              collaborators: {
                owner: userId,
                editors: draftEditors,
                viewers: []
              },
              generatedProposal: data,
              docx_base64: document,
              proposalId: new_prop_id
            });
            await newDraft.save({ session });
          }

          const new_CalendarEvent = new CalendarEvent({
            companyId: companyProfile_1._id,
            employeeId: employeeIdForCalendar,
            proposalId: new_prop_id,
            rfpId: proposal.rfpId,
            title: proposal.title || "Not found",
            startDate: new Date(),
            endDate: new Date(),
            status: "In Progress",
          });
          await new_CalendarEvent.save({ session });

          //Also add new calendar event with deadline
          const new_CalendarEvent_Deadline = new CalendarEvent({
            companyId: companyProfile_1._id,
            employeeId: employeeIdForCalendar,
            proposalId: new_prop_id,
            rfpId: proposal.rfpId,
            title: proposal.title || "Not found",
            startDate: getDeadline(proposal.deadline),
            endDate: getDeadline(proposal.deadline),
            status: "Deadline",
          });
          await new_CalendarEvent_Deadline.save({ session });

          proposalTracker.status = "success";
          proposalTracker.proposalId = new_prop_id;
          await proposalTracker.save({ session });

          current_subscription.current_rfp_proposal_generations++;
          await current_subscription.save({ session });

          const companyProfile = await CompanyProfile.findOne({ email: userEmail });
          if (!companyProfile) {
            await session.abortTransaction();
            return res.status(400).json({ error: "Company profile not found" });
          }

          companyProfile.proposals.push({
            title: rfp.title || "Not found",
            company: rfp.organization || "Not found",
            amount: parseFloat(rfp.budget) ? parseFloat(rfp.budget) : 0,
            status: "In Progress",
          });

          companyProfile.deadlines.push({
            title: rfp.title || "Not found",
            status: "In Progress",
            dueDate: getDeadline(rfp.deadline),
          });
          await companyProfile.save({ session });

          await session.commitTransaction();
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }

        return res.status(200).json({ message: "Proposal Generated successfully.", proposal: document, proposalId: new_prop_id });
      } else if (res_data.status === "processing") {
        return res.status(200).json({ message: "Proposal Generation is still in progress. Please wait for it to complete." });
      } else {
        proposalTracker.status = "error";
        await proposalTracker.save();
        return res.status(400).json({ error: "Failed to generate proposal. Please try again later." });
      }
    }
  } catch (err) {
    console.error("Error in /getRFPProposal:", err.message);
    return res.status(500).json({ error: "Failed to get RFP proposal" });
  }
};

exports.getGrantProposal = async (req, res) => {
  try {
    const { grant } = req.body;

    if (!grant || (!grant.grantId && !grant._id)) {
      return res.status(400).json({ error: "Grant ID is required" });
    }

    const grantData = await Grant.findOne({ _id: grant.grantId ? grant.grantId : grant._id });
    if (!grantData) {
      return res.status(400).json({ error: "Grant not found" });
    }

    let userEmail = req.user.email;
    let userId = "";

    let companyProfile_1 = "";

    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ error: "Employee profile not found. Please complete your employee profile first." });
      }
      userEmail = employeeProfile.companyMail;
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      const user = await User.findOne({ email: userEmail });
      userId = user._id;
    } else {
      companyProfile_1 = await CompanyProfile.findOne({ email: userEmail });
      userId = req.user._id;
    }

    //Check if a proposal with the same grantId already exists
    const proposal = await GrantProposal.findOne({ grantId: grant.grantId, companyMail: userEmail });
    if (proposal) {
      return res.status(200).json({ message: "Grant Proposal Generated successfully.", proposal: proposal.docx_base64, proposalId: proposal._id });
    }

    //Check if a proposal tracker with the same grantId already exists
    const proposalTracker = await ProposalTracker.findOne({ grantId: grant.grantId, companyMail: userEmail });

    if (!proposalTracker) {
      return res.status(404).json({ error: "Proposal tracker not found" });
    }

    if (proposalTracker.status === "success") {
      const grantProposal = await GrantProposal.findOne({ _id: proposalTracker.grantProposalId, companyMail: userEmail });
      return res.status(200).json({ message: "Grant Proposal Generated successfully.", proposal: grantProposal.docx_base64, proposalId: grantProposal._id });
    } else if (proposalTracker.status === "error") {
      await ProposalTracker.deleteOne({ grantId: grant.grantId, companyMail: userEmail });
      return res.status(400).json({ error: "Failed to generate grant proposal. Please try again later." });
    } else if (proposalTracker.status === "progress") {
      const res_1 = await axios.get(`${process.env.PROPOSAL_PIPELINE_URL}/task-status/${proposalTracker.trackingId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
      });
      const res_data = res_1.data;
      if (res_data.status === "success") {
        const document = res_data.result.docx_base64;
        const data = res_data.result.result;

        let new_prop_id;
        const session = await mongoose.startSession();
        session.startTransaction();
        try {

          const new_Draft = await DraftGrant.findOne({ grantId: grant.grantId, userEmail: userEmail });

          // Get editors from draft, or use empty array if draft doesn't exist
          const draftEditors = new_Draft && new_Draft.collaborators && new_Draft.collaborators.editors.length > 0
            ? new_Draft.collaborators.editors
            : (req.user._id.toString() !== userId.toString() ? [req.user._id] : []);
          // Use first editor or owner for calendar event
          const employeeIdForCalendar = draftEditors.length > 0 ? draftEditors[0] : userId;

          const current_subscription = await Subscription.findOne({ user_id: userId });
          if (!current_subscription) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Subscription not found' });
          }

          const new_prop = new GrantProposal({
            grantId: grant.grantId,
            project_inputs: proposalTracker.formData,
            initialProposal: data,
            generatedProposal: data,
            docx_base64: document,
            title: grant.OPPORTUNITY_TITLE || "Not found",
            client: grant.AGENCY_NAME,
            companyMail: userEmail,
            deadline: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
            url: grant.OPPORTUNITY_NUMBER_LINK || "",
            status: "In Progress",
            submittedAt: new Date(),
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
            isSaved: false,
            savedAt: null,
            savedBy: null,
            restoreBy: null,
            restoredBy: null,
            restoredAt: null,
            isRestored: false,
            maxEditors: current_subscription.max_editors,
            maxViewers: current_subscription.max_viewers,
            collaborators: {
              owner: userId,
              editors: draftEditors,
              viewers: []
            },
          });
          await new_prop.save({ session });
          new_prop_id = new_prop._id;

          if (!new_Draft) {
            const newDraft = new DraftGrant({
              grantId: grant.grantId,
              grant: grant,
              userEmail: userEmail,
              collaborators: {
                owner: userId,
                editors: draftEditors,
                viewers: []
              },
              generatedProposal: data,
              docx_base64: document,
              proposalId: new_prop_id,
            });
            await newDraft.save({ session });
          } else {
            new_Draft.proposalId = new_prop_id;
            new_Draft.generatedProposal = data;
            new_Draft.docx_base64 = document;
            // Update collaborators if they exist
            if (new_Draft.collaborators) {
              new_Draft.collaborators.editors = draftEditors;
            }
            await new_Draft.save({ session });
          }

          const new_CalendarEvent = new CalendarEvent({
            companyId: companyProfile_1._id,
            employeeId: employeeIdForCalendar,
            proposalId: new_prop_id,
            grantId: grant.grantId,
            title: grant.OPPORTUNITY_TITLE || "Not found",
            startDate: new Date(),
            endDate: new Date(),
            status: "In Progress",
          });
          await new_CalendarEvent.save({ session });

          //Also add new calendar event with deadline
          const new_CalendarEvent_Deadline = new CalendarEvent({
            companyId: companyProfile_1._id,
            employeeId: employeeIdForCalendar,
            proposalId: new_prop_id,
            grantId: grant.grantId,
            title: grant.OPPORTUNITY_TITLE || "Not found",
            startDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
            endDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
            status: "Deadline",
          });
          await new_CalendarEvent_Deadline.save({ session });

          proposalTracker.status = "success";
          proposalTracker.grantProposalId = new_prop_id;
          await proposalTracker.save({ session });

          current_subscription.current_grant_proposal_generations++;
          await current_subscription.save({ session });

          const companyProfile = await CompanyProfile.findOne({ email: userEmail });
          if (!companyProfile) {
            await session.abortTransaction();
            return res.status(400).json({ error: "Company profile not found" });
          }

          companyProfile.proposals.push({
            title: grant.OPPORTUNITY_TITLE,
            company: grant.AGENCY_NAME,
            amount: grant.ESTIMATED_TOTAL_FUNDING,
            status: "In Progress",
          });

          companyProfile.deadlines.push({
            title: grant.OPPORTUNITY_TITLE,
            status: "In Progress",
            dueDate: getDeadline(grant.ESTIMATED_APPLICATION_DUE_DATE),
          });
          await companyProfile.save({ session });

          await session.commitTransaction();
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
        return res.status(200).json({ message: "Grant Proposal Generated successfully.", proposal: document, proposalId: new_prop_id });
      } else if (res_data.status === "processing") {
        return res.status(200).json({ message: "Grant Proposal Generation is still in progress. Please wait for it to complete." });
      } else {
        proposalTracker.status = "error";
        await proposalTracker.save();
        return res.status(400).json({ error: "Failed to generate grant proposal. Please try again later." });
      }
    }
  } catch (err) {
    console.error("Error in /getGrantProposal:", err.message);
    return res.status(500).json({ error: "Failed to get grant proposal status" });
  }
};