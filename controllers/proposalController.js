const mongoose = require('mongoose');
const Proposal = require('../models/Proposal');
const EmployeeProfile = require('../models/EmployeeProfile');
const axios = require('axios');
const MatchedRFP = require('../models/MatchedRFP');
const RFP = require('../models/RFP');
const DraftRFP = require('../models/DraftRFP');
const GrantProposal = require('../models/GrantProposal');
const DraftGrant = require('../models/DraftGrant');
const Subscription = require('../models/Subscription');
const CompanyProfile = require('../models/CompanyProfile');

const { getStructuredJson } = require('../utils/get_structured_json');
const { decompress } = require('../utils/decompress');
const { convertPdfToJsonFile } = require('../utils/pdfToJsonConverter');
const { GridFsStorage } = require("multer-gridfs-storage");
const multer = require("multer");
const { deleteGridFSFile } = require('../utils/fileCleanup');

const storage = new GridFsStorage({
  url: process.env.MONGO_URI,
  file: (req, file) => {
    return {
      bucketName: "uploads",
      filename: file.originalname,
    };
  },
});

const upload = multer({ storage });
const singleFileUpload = upload.single('file');

let errorData = {
  message: "Error in basicComplianceCheckPdf",
  data: null
};

require('dotenv').config();

//Helper function to get file buffer from GridFS
async function getFileBufferFromGridFS(fileId) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "uploads"
  });
  const downloadStream = bucket.openDownloadStream(fileId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    downloadStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    downloadStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    downloadStream.on('error', (error) => {
      reject(error);
    });
  });
}

exports.basicComplianceCheck = async (req, res) => {
  try {
    const { jsonData, proposalId, isCompressed } = req.body;

    // Input validation
    if (!jsonData || !proposalId) {
      return res.status(400).json({ message: "jsonData and proposalId are required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(proposalId)) {
      return res.status(400).json({ message: "Invalid proposal ID format" });
    }

    const new_proposal = await Proposal.findById(proposalId);
    if (!new_proposal) {
      return res.status(404).json({ message: "Proposal not found" });
    }

    const decompressedProposal = isCompressed ? decompress(jsonData) : jsonData;

    const structuredJson = getStructuredJson(decompressedProposal, new_proposal.initialProposal);

    const resProposal = await axios.post(`${process.env.PIPELINE_URL}/basic-compliance`, structuredJson, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const data = resProposal.data.report;

    const firstKey = Object.keys(data)[0];
    const firstValue = data[firstKey];

    const compliance_data = firstValue["compliance_flags"];

    res.status(200).json(compliance_data);
  } catch (error) {
    console.error('Error in basicComplianceCheck:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: error.message });
  }
};

exports.basicComplianceCheckPdf = [
  singleFileUpload,
  async (req, res) => {
    try {
      const { file } = req;
      const { rfpId } = req.body;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!rfpId) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "rfpId is required" });
      }

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(rfpId)) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "Invalid RFP ID format" });
      }

      // Validate user exists
      if (!req.user) {
        await deleteGridFSFile(file.id);
        return res.status(401).json({ message: "User not authenticated" });
      }

      let userEmail = req.user.email;
      let userId = req.user._id;
      if (req.user.role === "employee") {
        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        if (!employeeProfile) {
          await deleteGridFSFile(file.id);
          return res.status(404).json({ message: "Employee profile not found" });
        }
        userEmail = employeeProfile.companyMail;
        const companyProfile = await CompanyProfile.findOne({ email: userEmail });
        if (!companyProfile) {
          await deleteGridFSFile(file.id);
          return res.status(404).json({ message: "Company profile not found" });
        }
        userId = companyProfile.userId;
      }

      //check for active subscription
      const subscription = await Subscription.findOne({ user_id: userId });
      if (!subscription || subscription.end_date < new Date()) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "Subscription not found or expired" });
      }

      if (subscription && subscription.plan_name === "Free") {
        await deleteGridFSFile(file.id);
        return res.status(200).json({ message: 'You are using the free plan. Please upgrade to a paid plan to continue using basic compliance check.' });
      }

      if (!file) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Validate file type
      const allowedTypes = ['application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "Invalid file type. Only PDF files are allowed." });
      }

      // Validate file size (10MB limit)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "File size exceeds 10MB limit" });
      }

      //Check if a proposal already exists for this rfp and user
      const proposal = await Proposal.findOne({ rfpId: rfpId, companyMail: userEmail });

      if (!proposal) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "Proposal not found" });
      }

      // Check if no.of attempts is greater than 3
      if (proposal.noOfAttempts && proposal.noOfAttempts <= 0) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "No more attempts allowed" });
      }

      const fileBuffer = await getFileBufferFromGridFS(file.id);

      const jsonString = await convertPdfToJsonFile(fileBuffer);

      // Parse the JSON string to an object
      let jsonData;
      try {
        jsonData = JSON.parse(jsonString);
      } catch (parseError) {
        errorData.data = jsonString;
        await deleteGridFSFile(file.id);
        return res.status(500).json({
          message: "Failed to parse extracted JSON data",
          error: parseError.message,
          data: errorData
        });
      }

      errorData.data = jsonData;

      const resProposal = await axios.post(`${process.env.PIPELINE_URL}/basic-compliance`, jsonData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      const data = resProposal.data.report;

      const firstKey = Object.keys(data)[0];

      const firstValue = data[firstKey];

      const compliance_data = firstValue["compliance_flags"];

      proposal.noOfAttempts = proposal.noOfAttempts > 0 ? proposal.noOfAttempts - 1 : 0;
      await proposal.save();

      await deleteGridFSFile(file.id);

      res.status(200).json(compliance_data);
    } catch (error) {
      await deleteGridFSFile(file.id);
      res.status(500).json({ message: error.message, data: errorData });
    }
  }
];

exports.advancedComplianceCheck = async (req, res) => {
  try {
    const { jsonData, proposalId, isCompressed } = req.body;

    // Input validation
    if (!jsonData || !proposalId) {
      return res.status(400).json({ message: "jsonData and proposalId are required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(proposalId)) {
      return res.status(400).json({ message: "Invalid proposal ID format" });
    }

    const decompressedProposal = isCompressed ? decompress(jsonData) : jsonData;

    const new_proposal = await Proposal.findById(proposalId);
    if (!new_proposal) {
      return res.status(404).json({ message: "Proposal not found" });
    }

    const structuredJson = getStructuredJson(decompressedProposal, new_proposal.initialProposal);

    const rfp = await MatchedRFP.findById(new_proposal.rfpId) || await RFP.findById(new_proposal.rfpId);
    if (!rfp) {
      return res.status(404).json({ message: "RFP not found" });
    }

    const initialProposal_1 = {
      "rfp": {
        "RFP Title": rfp.title || "Not found",
        "RFP Description": rfp.description || "Not found",
        "Match Score": rfp.match || 0,
        "Budget": rfp.budget || "Not found",
        "Deadline": rfp.deadline || "Not found",
        "Issuing Organization": rfp.organization || "Not found",
        "Industry": rfp.organizationType || "Not found",
        "URL": rfp.link || "Not found",
        "Contact Information": rfp.contact || "Not found",
        "Timeline": rfp.timeline || "Not found",
      },
      "proposal": {
        ...structuredJson
      }
    };


    const resBasicCompliance = await axios.post(`${process.env.PIPELINE_URL}/basic-compliance`, structuredJson, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const dataBasicCompliance = resBasicCompliance.data.report;

    const firstKey = Object.keys(dataBasicCompliance)[0];
    const firstValue = dataBasicCompliance[firstKey];

    const compliance_dataBasicCompliance = firstValue["compliance_flags"];

    const resProposal = await axios.post(`${process.env.PIPELINE_URL}/advance-compliance`, initialProposal_1, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const dataAdvancedCompliance = resProposal.data.report;

    res.status(200).json({ compliance_dataBasicCompliance, dataAdvancedCompliance });

  } catch (error) {
    const statusCode = error.response && error.response.status ? error.response.status : 500;
    const responseData = error.response && error.response.data ? error.response.data : null;
    res.status(statusCode).json({ message: 'Advanced compliance check failed', error: responseData || error.message });
  }
};

exports.advancedComplianceCheckPdf = [
  singleFileUpload,
  async (req, res) => {
    try {
      const { file } = req;
      const { rfpId } = req.body;

      // Set response headers for long-running request
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Input validation
      if (!rfpId) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "rfpId is required" });
      }

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(rfpId)) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "Invalid RFP ID format" });
      }

      // Validate user exists
      if (!req.user) {
        await deleteGridFSFile(file.id);
        return res.status(401).json({ message: "User not authenticated" });
      }

      let userEmail = req.user.email;
      let userId = req.user._id;

      if (req.user.role === "employee") {
        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        if (!employeeProfile) {
          await deleteGridFSFile(file.id);
          return res.status(404).json({ message: "Employee profile not found" });
        }
        userEmail = employeeProfile.companyMail;
        const companyProfile = await CompanyProfile.findOne({ email: userEmail });
        if (!companyProfile) {
          await deleteGridFSFile(file.id);
          return res.status(404).json({ message: "Company profile not found" });
        }
        userId = companyProfile.userId;
      }

      //check for active subscription
      const subscription = await Subscription.findOne({ user_id: userId });
      if (!subscription || subscription.end_date < new Date()) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "Subscription not found or expired" });
      }

      if (subscription && subscription.plan_name === "Free") {
        await deleteGridFSFile(file.id);
        return res.status(200).json({ message: 'You are using the free plan. Please upgrade to a paid plan to continue using advanced compliance check.' });
      }

      //check if subscription is pro or enterprise or custom
      if (subscription.plan_name !== "Pro" && subscription.plan_name !== "Enterprise" && subscription.plan_name !== "Custom Enterprise Plan") {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "You are not authorized to use this feature" });
      }

      if (!file) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Validate file type
      const allowedTypes = ['application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "Invalid file type. Only PDF files are allowed." });
      }

      // Validate file size (10MB limit)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        await deleteGridFSFile(file.id);
        return res.status(400).json({ message: "File size exceeds 10MB limit" });
      }

      //Check if a proposal already exists for this rfp and user
      const proposal = await Proposal.findOne({ rfpId: rfpId, companyMail: userEmail });

      if (!proposal) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "Proposal not found" });
      }

      // Check if no.of attempts is greater than 3
      if (proposal.noOfAttempts && proposal.noOfAttempts <= 0) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "No more attempts allowed" });
      }

      const fileBuffer = await getFileBufferFromGridFS(file.id);

      // Create abort controller for proper cleanup
      const abortController = new AbortController();

      // Add timeout wrapper for PDF conversion
      const conversionTimeout = 600000; // 10 minutes timeout for PDF conversion (to allow for 5min OpenAI + processing time)
      const conversionTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          abortController.abort(); // Signal abort to stop ongoing processes
          reject(new Error('PDF conversion timed out after 10 minutes'));
        }, conversionTimeout);
      });

      const jsonString = await Promise.race([
        convertPdfToJsonFile(fileBuffer, abortController.signal),
        conversionTimeoutPromise
      ]);

      let jsonData;
      try {
        jsonData = JSON.parse(jsonString);
      } catch (parseError) {
        errorData.data = jsonString;
        await deleteGridFSFile(file.id);
        return res.status(500).json({
          message: "Failed to parse extracted JSON data",
          error: parseError.message,
          data: errorData
        });
      }

      errorData.data = jsonData;

      //Set timeout for 10 minutes
      const timeout = 10 * 60 * 1000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Request timed out'));
        }, timeout);
      });

      const resBasicCompliance = await Promise.race([
        axios.post(`${process.env.PIPELINE_URL}/basic-compliance`, jsonData, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }),
        timeoutPromise
      ]);

      const dataBasicCompliance = resBasicCompliance.data.report;

      const firstKey = Object.keys(dataBasicCompliance)[0];
      const firstValue = dataBasicCompliance[firstKey];
      const compliance_dataBasicCompliance = firstValue["compliance_flags"];

      let rfp = null;
      const new_rfp = await RFP.findOne({ _id: rfpId });
      if (new_rfp) {
        rfp = new_rfp;
      } else {
        rfp = await MatchedRFP.findOne({ _id: rfpId });
      }

      if (!rfp) {
        await deleteGridFSFile(file.id);
        return res.status(404).json({ message: "RFP not found" });
      }

      const rfp_1 = {
        "RFP Title": rfp.title || "Not found",
        "RFP Description": rfp.description || "Not found",
        "Match Score": rfp.match || 0,
        "Budget": rfp.budget || "Not found",
        "Deadline": rfp.deadline || "Not found",
        "Issuing Organization": rfp.organization || "Not found",
        "Industry": rfp.organizationType || "Not found",
        "URL": rfp.link || "Not found",
        "Contact Information": rfp.contact || "Not found",
        "Timeline": rfp.timeline || "Not found",
      };

      const resProposal = await Promise.race([
        axios.post(`${process.env.PIPELINE_URL}/advance-compliance`, {
          "rfp": rfp_1,
          "proposal": jsonData,
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }),
        timeoutPromise
      ]);

      const dataAdvancedCompliance = resProposal.data.report;

      const rfpTitle = rfp.title;

      proposal.noOfAttempts = proposal.noOfAttempts > 0 ? proposal.noOfAttempts - 1 : 0;
      await proposal.save();

      await deleteGridFSFile(file.id);

      res.status(200).json({ compliance_dataBasicCompliance, dataAdvancedCompliance, rfpTitle });

    } catch (error) {
      // Clean up any remaining intervals
      if (typeof progressInterval !== 'undefined') {
        clearInterval(progressInterval);
      }

      // Handle specific timeout errors
      if (error.message.includes('timed out') || error.message.includes('aborted')) {
        await deleteGridFSFile(file.id);
        return res.status(408).json({
          message: 'Request timeout - PDF processing is taking longer than expected. Please try again or contact support if the issue persists.',
          error: error.message,
          data: errorData
        });
      }

      // Handle OpenAI API errors
      if (error.message.includes('OpenAI')) {
        await deleteGridFSFile(file.id);
        return res.status(503).json({
          message: 'AI service temporarily unavailable. Please try again in a few moments.',
          error: error.message,
          data: errorData
        });
      }

      await deleteGridFSFile(file.id);
      res.status(500).json({ message: error.message, data: errorData });
    }
  }
];

exports.generatePDF = async (req, res) => {
  try {
    const { project, isCompressed } = req.body;

    // Input validation
    if (!project) {
      return res.status(400).json({ message: "project is required" });
    }

    const pdf = await axios.post(`${process.env.PIPELINE_URL}/download-pdf`, { "project": project, "isCompressed": isCompressed }, { responseType: "arraybuffer" });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="proposal.pdf"');
    res.status(200).send(pdf.data);
  } catch (error) {
    await deleteGridFSFile(file.id);
    res.status(500).json({ message: error.message, data: errorData });
  }
};


exports.autoSaveProposal = async (req, res) => {
  try {
    const { proposalId, jsonData, isCompressed } = req.body;

    // Input validation
    if (!proposalId || !jsonData) {
      return res.status(400).json({ message: "proposalId and jsonData are required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(proposalId)) {
      return res.status(400).json({ message: "Invalid proposal ID format" });
    }

    // Validate user exists
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const decompressedProject = isCompressed ? decompress(jsonData) : jsonData;

    let userEmail = req.user.email;
    if (req.user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      userEmail = employeeProfile.companyMail;
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const new_grant_proposal = await GrantProposal.findOne({ _id: proposalId, companyMail: userEmail });
      if (new_grant_proposal) {
        new_grant_proposal.generatedProposal = decompressedProject;
        await new_grant_proposal.save({ session });

        const new_draft_grant = await DraftGrant.findOne({ proposalId: proposalId, userEmail: userEmail });
        if (new_draft_grant) {
          new_draft_grant.generatedProposal = decompressedProject;
          await new_draft_grant.save({ session });
        }

        await session.commitTransaction();
        return res.status(200).json({ message: 'Grant proposal saved successfully' });
      }

      const new_proposal_1 = await Proposal.findOne({ _id: proposalId, companyMail: userEmail });
      if (new_proposal_1) {
        new_proposal_1.generatedProposal = decompressedProject;
        await new_proposal_1.save({ session });

        const new_draft_proposal = await DraftRFP.findOne({ proposalId: proposalId, userEmail: userEmail });
        if (new_draft_proposal) {
          new_draft_proposal.generatedProposal = decompressedProject;
          await new_draft_proposal.save({ session });
        }

        await session.commitTransaction();
        return res.status(200).json({ message: 'RFP proposal saved successfully' });
      }

      await session.abortTransaction();
      res.status(404).json({ message: 'Proposal not found' });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
