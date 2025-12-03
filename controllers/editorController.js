const mongoose = require("mongoose");
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");
dotenv.config();
const Proposal = require("../models/Proposal");
const EmployeeProfile = require("../models/EmployeeProfile");
const User = require("../models/User");
const GrantProposal = require("../models/GrantProposal");

// GridFS Bucket for document storage
const getGridFSBucket = () => {
    return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "documents"
    });
};

// JWT Setup
const JWT_SECRET = (process.env.ONLYOFFICE_JWT_SECRET || process.env.JWT_SECRET || "").trim();

// Base URL for callbacks
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

// Store mapping from OnlyOffice keys to GridFS file IDs
// This is critical because OnlyOffice keys cannot have slashes, but we need to track file IDs.
const keyToFileIdMap = new Map();

// Helper function to sanitize file names
function sanitizeFileName(str) {
    return str
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .toLowerCase();
}

// Build file path/filename with company_name/projectName structure
function buildFileName(companyName, projectName) {
    const sanitizedCompany = sanitizeFileName(companyName);
    const sanitizedProject = sanitizeFileName(projectName);
    return `${sanitizedCompany}_${sanitizedProject}.docx`;
}

// Sanitize key for OnlyOffice (key must match pattern: 0-9-.a-zA-Z_=)
function sanitizeOnlyOfficeKey(filePath) {
    return filePath
        .replace(/\//g, "_")  // Replace forward slashes with underscores
        .replace(/[^0-9\-\.a-zA-Z_=]/g, "_")
        .replace(/^_|_$/g, "");
}

// Generate public URL for GridFS file (served through our API)
function getFileUrl(fileId) {
    return `${BASE_URL}/editor/serve-doc/${fileId}`;
}

// Helper function to get file buffer from GridFS
async function getFileBufferFromGridFS(fileId) {
    const bucket = getGridFSBucket();
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

// Helper function to save buffer to GridFS
async function saveBufferToGridFS(buffer, filename, metadata = {}) {
    const bucket = getGridFSBucket();
    const uploadStream = bucket.openUploadStream(filename, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        metadata: {
            ...metadata,
            uploadedAt: new Date().toISOString()
        }
    });

    return new Promise((resolve, reject) => {
        uploadStream.on('finish', () => {
            resolve(uploadStream.id);
        });
        uploadStream.on('error', (error) => {
            reject(error);
        });
        uploadStream.end(buffer);
    });
}

// Helper function to check if file exists in GridFS by filename
async function findFileByFilename(filename) {
    const bucket = getGridFSBucket();
    const files = await bucket.find({ filename }).toArray();
    return files.length > 0 ? files[0] : null;
}

// Helper function to update file in GridFS (delete old, upload new)
async function updateFileInGridFS(fileId, buffer, metadata = {}) {
    const bucket = getGridFSBucket();

    // Get existing file info
    const existingFile = await bucket.find({ _id: fileId }).toArray();
    if (existingFile.length === 0) {
        throw new Error('File not found');
    }

    const filename = existingFile[0].filename;

    // Delete old file
    await bucket.delete(fileId);

    // Upload new file with same filename
    return await saveBufferToGridFS(buffer, filename, {
        ...metadata,
        updatedAt: new Date().toISOString()
    });
}

// Helper function to check user permission for a proposal
async function checkUserPermission(proposal, userId, userRole) {
    // Convert userId to string for comparison
    const userIdStr = userId.toString();

    // Owner (company) always has full access
    if (proposal.collaborators && proposal.collaborators.owner) {
        const ownerIdStr = proposal.collaborators.owner.toString();
        if (ownerIdStr === userIdStr) {
            return { hasAccess: true, role: "owner", canEdit: true };
        }
    }

    // Check if user is an editor
    if (proposal.collaborators && proposal.collaborators.editors &&
        Array.isArray(proposal.collaborators.editors)) {
        const isEditor = proposal.collaborators.editors.some(editorId =>
            editorId && editorId.toString() === userIdStr
        );
        if (isEditor) {
            return { hasAccess: true, role: "editor", canEdit: true };
        }
    }

    // Check if user is a viewer
    if (proposal.collaborators && proposal.collaborators.viewers &&
        Array.isArray(proposal.collaborators.viewers)) {
        const isViewer = proposal.collaborators.viewers.some(viewerId =>
            viewerId && viewerId.toString() === userIdStr
        );
        if (isViewer) {
            return { hasAccess: true, role: "viewer", canEdit: false };
        }
    }

    return { hasAccess: false, role: null, canEdit: false };
}

// [CRITICAL CONFIGURATION]
// Builds the config object for the frontend
function buildConfig(filename, fileId, fileUrl, userInfo = null, canEdit = true) {
    const callbackUrl = `${BASE_URL}/editor/save`;

    // [COLLABORATION FIX] 
    // We use a STATIC key derived from the filename. 
    // We do NOT add Date.now(). This ensures User A and User B get the same key.
    const onlyOfficeKey = sanitizeOnlyOfficeKey(filename);

    // Store the mapping so we can find the GridFS file ID later
    keyToFileIdMap.set(onlyOfficeKey, fileId.toString());

    // Determine user info
    const userId = userInfo ? userInfo.id : "uid-" + Date.now();
    const userName = userInfo ? userInfo.name : "User " + new Date().toLocaleTimeString();

    return {
        document: {
            fileType: "docx",
            key: onlyOfficeKey,
            title: filename,
            url: fileUrl,
        },
        documentType: "word",
        editorConfig: {
            mode: canEdit ? "edit" : "view", // Set mode based on permission
            callbackUrl: callbackUrl,
            user: {
                id: userId,
                name: userName,
            },
            coEditing: {
                mode: "fast",
            },
            customization: {
                autosave: false, // We rely on the callback for saving
                forcesave: canEdit, // Only allow force save if user can edit
            },
        },
    }
}

// JWT signing
function signConfig(config) {
    if (!JWT_SECRET || JWT_SECRET === "your-onlyoffice-secret") {
        return config;
    }

    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
        document: config.document,
        editorConfig: config.editorConfig,
    };

    const base64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const toSign = `${base64(header)}.${base64(payload)}`;

    const signature = CryptoJS.HmacSHA256(toSign, JWT_SECRET)
        .toString(CryptoJS.enc.Base64)
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

    return { ...config, token: `${toSign}.${signature}` };
}

// API: Generate or get existing DOCX file
exports.generateDoc = async (req, res) => {
    try {
        const { type, proposalId } = req.body;
        if (!type || !proposalId) {
            return res.status(400).json({ error: "Type and ProposalId is required" });
        }

        let companyMail = "";
        let userId = "";
        if (req.user.role === "employee") {
            const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
            if (!employeeProfile) {
                return res.status(404).json({ error: "Employee profile not found. Please complete your employee profile first." });
            }
            companyMail = employeeProfile.companyMail;
            userId = req.user._id.toString();
        } else {
            companyMail = req.user.email;
            userId = req.user._id.toString();
        }

        // Find proposal by rfpId and companyMail
        let proposal = null;
        if (type === "rfp") {
            proposal = await Proposal.findOne({ rfpId: proposalId, companyMail: companyMail });
        } else {
            proposal = await GrantProposal.findOne({ grantId: proposalId, companyMail: companyMail });
        }

        if (!proposal) {
            return res.status(404).json({ error: "Proposal not found" });
        }

        // Initialize collaborators if not set (migration for existing proposals)
        if (!proposal.collaborators || !proposal.collaborators.owner) {
            // Find the owner user by email (use proposal.companyMail as it's the actual owner)
            const ownerUser = await User.findOne({ email: proposal.companyMail });
            if (!ownerUser) {
                return res.status(404).json({ error: "Owner user not found" });
            }

            proposal.collaborators = {
                owner: ownerUser._id,
                editors: [],
                viewers: []
            };
            await proposal.save();
        }

        // Check user permission
        const permission = await checkUserPermission(proposal, userId, req.user.role);
        if (!permission.hasAccess) {
            return res.status(403).json({ error: "You do not have permission to access this proposal" });
        }

        const docx_base64 = proposal.docx_base64;
        const companyName = proposal.client;
        const projectName = proposal.title;

        const filename = buildFileName(companyName, projectName);
        const bucket = getGridFSBucket();

        // Check if file exists in GridFS
        let existingFile = await findFileByFilename(filename);
        let fileId;

        if (!existingFile) {
            let docxBuffer;

            // If docx_base64 is provided, decode it and use it directly
            if (docx_base64) {
                try {
                    // Decode base64 string to buffer
                    docxBuffer = Buffer.from(docx_base64, 'base64');
                    console.log(`[generateDoc] Decoded base64 document (${docxBuffer.length} bytes)`);
                } catch (decodeError) {
                    return res.status(400).json({ error: "Invalid base64 format for docx_base64" });
                }
            } else {
                return res.status(400).json({ error: "docx_base64 is required" });
            }

            // Save to GridFS
            fileId = await saveBufferToGridFS(docxBuffer, filename, {
                companyName,
                projectName
            });
            console.log(`[generateDoc] Generated new file: ${filename} (ID: ${fileId})`);
        } else {
            fileId = existingFile._id;
            console.log(`[generateDoc] Using existing file: ${filename} (ID: ${fileId})`);
        }

        // Verify file exists in GridFS before returning URL
        const verifyFiles = await bucket.find({ _id: fileId }).toArray();
        if (verifyFiles.length === 0) {
            console.error(`[generateDoc] File ${fileId} not found in GridFS after creation/retrieval`);
            return res.status(500).json({ error: "File not found in storage" });
        }
        console.log(`[generateDoc] Verified file exists: ${verifyFiles[0].filename}, size: ${verifyFiles[0].length} bytes`);

        // Get user info for OnlyOffice
        const userInfo = {
            id: req.user._id.toString(),
            name: req.user.fullName || req.user.email
        };

        const fileUrl = getFileUrl(fileId);
        console.log(`[generateDoc] Generated file URL: ${fileUrl} for fileId: ${fileId}`);
        console.log(`[generateDoc] BASE_URL: ${BASE_URL}`);
        console.log(`[generateDoc] User: ${userId}, Permission: ${permission.role}, CanEdit: ${permission.canEdit}`);

        let config = buildConfig(filename, fileId, fileUrl, userInfo, permission.canEdit);
        config = signConfig(config);

        console.log(`[generateDoc] Returning config with key: ${config.document.key}`);
        res.json({ ...config, fileId: fileId.toString(), filename, userRole: permission.role });
    } catch (error) {
        console.error("Error in generate-doc:", error);
        res.status(500).json({ error: error.message });
    }
};

// API: Open GridFS file by filename
exports.openFile = async (req, res) => {
    try {
        //console.log("openFile");
        const filename = req.query.filename;
        if (!filename) return res.status(400).json({ error: "filename required" });

        const existingFile = await findFileByFilename(filename);
        if (!existingFile) return res.status(404).json({ error: "File not found" });

        const fileId = existingFile._id;
        const fileUrl = getFileUrl(fileId);
        let config = buildConfig(filename, fileId, fileUrl);
        config = signConfig(config);

        res.json({ ...config, fileId: fileId.toString() });
    } catch (error) {
        console.error("Error opening file:", error);
        res.status(500).json({ error: error.message });
    }
};

// API: Check file existence
exports.checkFile = async (req, res) => {
    try {
        //console.log("checkFile");
        const { companyName, projectName } = req.query;
        if (!companyName || !projectName) return res.status(400).json({ error: "Missing params" });

        const filename = buildFileName(companyName, projectName);
        const existingFile = await findFileByFilename(filename);
        const exists = existingFile !== null;

        res.json({
            exists,
            filename: exists ? filename : null,
            fileId: exists ? existingFile._id.toString() : null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// [CRITICAL LOGIC] Map keys back to GridFS file IDs
async function getFileIdFromOnlyOfficeKey(onlyOfficeKey) {
    // 1. Check memory map
    if (keyToFileIdMap.has(onlyOfficeKey)) {
        return keyToFileIdMap.get(onlyOfficeKey);
    }

    // 2. Fallback: Try to find file by reconstructing filename if server restarted
    // The key is sanitized filename, so we can try to find it in GridFS
    //console.warn(`[API] Key ${onlyOfficeKey} not found in memory map. Attempting fallback...`);

    // Try to find file by filename (the key should match the filename pattern)
    const bucket = getGridFSBucket();
    const files = await bucket.find({ filename: onlyOfficeKey }).toArray();

    if (files.length > 0) {
        const fileId = files[0]._id.toString();
        //console.log(`[API] Fallback success: Found file ID ${fileId} for key ${onlyOfficeKey}`);
        keyToFileIdMap.set(onlyOfficeKey, fileId);
        return fileId;
    }

    // Last resort: Try finding by partial match (in case filename format changed)
    // This searches for files where filename contains the key
    const partialMatch = await bucket.find({
        filename: { $regex: onlyOfficeKey.replace(/_/g, '.*') }
    }).toArray();

    if (partialMatch.length > 0) {
        const fileId = partialMatch[0]._id.toString();
        //console.log(`[API] Partial match found: File ID ${fileId} for key ${onlyOfficeKey}`);
        keyToFileIdMap.set(onlyOfficeKey, fileId);
        return fileId;
    }

    return null;
}

// [CRITICAL FIX] API: Save Callback
exports.save = async (req, res) => {
    //console.log("save");
    // 1. SEND RESPONSE IMMEDIATELY
    // This stops OnlyOffice from waiting and timing out ("File version has changed" error)
    res.status(200).json({ error: 0 });

    // 2. PROCESS IN BACKGROUND
    const { status, url, key } = req.body;

    try {
        // Status 2 = Ready for Save, Status 6 = Force Save
        if ((status === 2 || status === 6) && url) {
            //console.log(`[API] Background Save initiated for key: ${key}`);

            const fileId = await getFileIdFromOnlyOfficeKey(key);
            if (!fileId) {
                console.error(`[API] ❌ Could not map key '${key}' to a file ID. Save aborted.`);
                return;
            }

            //console.log(`[API] Downloading from OnlyOffice for file ID: ${fileId}`);

            // Fetch the file from OnlyOffice Document Server
            const response = await fetch(url);
            if (!response.ok) throw new Error(`OnlyOffice fetch failed: ${response.statusText}`);

            const buffer = await response.arrayBuffer();

            // Get existing file metadata
            const bucket = getGridFSBucket();
            const existingFile = await bucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();
            if (existingFile.length === 0) {
                throw new Error('File not found in GridFS');
            }

            const filename = existingFile[0].filename;
            const metadata = existingFile[0].metadata || {};

            // Update file in GridFS (delete old, upload new)
            const newFileId = await updateFileInGridFS(
                new mongoose.Types.ObjectId(fileId),
                buffer,
                metadata
            );

            // Update the mapping with new file ID (in case it changed)
            if (newFileId.toString() !== fileId) {
                keyToFileIdMap.set(key, newFileId.toString());
            }

            //console.log(`[API] ✅ Success: File saved to GridFS (ID: ${newFileId}, ${buffer.length} bytes)`);
        } else {
            // Just a status update (user joined/left)
            // //console.log(`[API] Status update ${status} received. No save needed.`);
        }
    } catch (error) {
        // We cannot respond to the client (res is already sent), so we just log
        console.error(`[API] ❌ Background Save ERROR:`, error.message);
    }
};

// API: Serve document file from GridFS (for OnlyOffice to download)
exports.serveDoc = async (req, res) => {
    try {
        const fileId = req.params.fileId;
        console.log(`[serveDoc] ===== REQUEST RECEIVED =====`);
        console.log(`[serveDoc] FileId: ${fileId}`);
        console.log(`[serveDoc] Method: ${req.method}`);
        console.log(`[serveDoc] Headers:`, JSON.stringify(req.headers, null, 2));
        console.log(`[serveDoc] URL: ${req.url}`);
        console.log(`[serveDoc] IP: ${req.ip}`);

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            console.error(`[serveDoc] Invalid file ID format: ${fileId}`);
            return res.status(400).json({ error: "Invalid file ID format" });
        }

        const bucket = getGridFSBucket();
        const objectId = new mongoose.Types.ObjectId(fileId);

        // Check if file exists
        const files = await bucket.find({ _id: objectId }).toArray();
        if (files.length === 0) {
            console.error(`[serveDoc] File not found in GridFS: ${fileId}`);
            return res.status(404).json({ error: "File not found" });
        }

        const fileDoc = files[0];
        console.log(`[serveDoc] Found file: ${fileDoc.filename}, size: ${fileDoc.length} bytes`);

        // Set appropriate headers with CORS for OnlyOffice
        // OnlyOffice requires specific headers
        res.set({
            'Content-Type': fileDoc.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `inline; filename="${encodeURIComponent(fileDoc.filename)}"`,
            'Content-Length': fileDoc.length,
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
            'Access-Control-Allow-Origin': '*', // Allow OnlyOffice to access
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
            'X-Content-Type-Options': 'nosniff'
        });

        console.log(`[serveDoc] Headers set, starting stream...`);

        // Stream file to response
        const downloadStream = bucket.openDownloadStream(objectId);

        downloadStream.on('error', (error) => {
            console.error(`[serveDoc] Stream error for fileId ${fileId}:`, error.message);
            console.error(`[serveDoc] Error stack:`, error.stack);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            } else {
                console.error(`[serveDoc] Headers already sent, cannot send error response`);
            }
        });

        downloadStream.on('end', () => {
            console.log(`[serveDoc] ✅ Successfully served file: ${fileId}`);
        });

        downloadStream.on('data', (chunk) => {
            // Log first chunk to verify streaming is working
            if (!downloadStream._loggedFirstChunk) {
                console.log(`[serveDoc] First chunk received: ${chunk.length} bytes`);
                downloadStream._loggedFirstChunk = true;
            }
        });

        downloadStream.pipe(res);

        console.log(`[serveDoc] Stream piped to response`);
    } catch (error) {
        console.error(`[serveDoc] ❌ Exception serving file ${req.params.fileId}:`, error.message);
        console.error(`[serveDoc] Error stack:`, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
};

// API: Add collaborator to proposal
exports.addCollaborator = async (req, res) => {
    try {
        const { proposalId, email, role } = req.body; // role: 'editor' or 'viewer'

        if (!proposalId || !email || !role) {
            return res.status(400).json({ error: "proposalId, email, and role are required" });
        }

        if (role !== 'editor' && role !== 'viewer') {
            return res.status(400).json({ error: "role must be 'editor' or 'viewer'" });
        }

        // Get company mail (owner)
        let companyMail = "";
        if (req.user.role === "employee") {
            const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
            if (!employeeProfile) {
                return res.status(404).json({ error: "Employee profile not found" });
            }
            companyMail = employeeProfile.companyMail;
        } else {
            companyMail = req.user.email;
        }

        // Find proposal
        const proposal = await Proposal.findOne({ rfpId: proposalId, companyMail: companyMail });
        if (!proposal) {
            return res.status(404).json({ error: "Proposal not found" });
        }

        // Initialize collaborators if not set
        if (!proposal.collaborators || !proposal.collaborators.owner) {
            // Find the owner user by email
            const ownerUser = await User.findOne({ email: companyMail });
            if (!ownerUser) {
                return res.status(404).json({ error: "Owner user not found" });
            }

            proposal.collaborators = {
                owner: ownerUser._id,
                editors: [],
                viewers: []
            };
        }

        // Find the user to add as collaborator by email
        const collaboratorUser = await User.findOne({ email: email });
        if (!collaboratorUser) {
            return res.status(404).json({ error: "User not found with the provided email" });
        }

        // Check if user is already a collaborator (using ObjectId comparison)
        const collaboratorIdStr = collaboratorUser._id.toString();
        const isAlreadyEditor = proposal.collaborators.editors.some(editorId =>
            editorId && editorId.toString() === collaboratorIdStr
        );
        const isAlreadyViewer = proposal.collaborators.viewers.some(viewerId =>
            viewerId && viewerId.toString() === collaboratorIdStr
        );

        if (isAlreadyEditor || isAlreadyViewer) {
            return res.status(400).json({ error: "User is already a collaborator" });
        }

        // Check subscription limits
        const Subscription = require("../models/Subscription");
        const companyUser = await User.findOne({ email: companyMail });
        if (companyUser) {
            const subscription = await Subscription.findOne({ user_id: companyUser._id });
            if (subscription && subscription.end_date >= new Date()) {
                const currentEditors = proposal.collaborators.editors.length;
                const currentViewers = proposal.collaborators.viewers.length;

                if (role === 'editor' && subscription.max_editors <= currentEditors) {
                    return res.status(400).json({ error: "Maximum number of editors reached for your subscription" });
                }
                if (role === 'viewer' && subscription.max_viewers <= currentViewers) {
                    return res.status(400).json({ error: "Maximum number of viewers reached for your subscription" });
                }
            }
        }

        // Add collaborator using ObjectId
        if (role === 'editor') {
            proposal.collaborators.editors.push(collaboratorUser._id);
        } else {
            proposal.collaborators.viewers.push(collaboratorUser._id);
        }

        await proposal.save();

        res.json({
            message: "Collaborator added successfully",
            collaborators: proposal.collaborators
        });
    } catch (error) {
        console.error("Error in addCollaborator:", error);
        res.status(500).json({ error: error.message });
    }
};

// API: Remove collaborator from proposal
exports.removeCollaborator = async (req, res) => {
    try {
        const { proposalId, email } = req.body;

        if (!proposalId || !email) {
            return res.status(400).json({ error: "proposalId and email are required" });
        }

        // Get company mail (owner)
        let companyMail = "";
        if (req.user.role === "employee") {
            const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
            if (!employeeProfile) {
                return res.status(404).json({ error: "Employee profile not found" });
            }
            companyMail = employeeProfile.companyMail;
        } else {
            companyMail = req.user.email;
        }

        // Find proposal
        const proposal = await Proposal.findOne({ rfpId: proposalId, companyMail: companyMail });
        if (!proposal) {
            return res.status(404).json({ error: "Proposal not found" });
        }

        // Initialize collaborators if not set
        if (!proposal.collaborators || !proposal.collaborators.owner) {
            // Find the owner user by email
            const ownerUser = await User.findOne({ email: companyMail });
            if (!ownerUser) {
                return res.status(404).json({ error: "Owner user not found" });
            }

            proposal.collaborators = {
                owner: ownerUser._id,
                editors: [],
                viewers: []
            };
        }

        // Find the user to remove by email
        const collaboratorUser = await User.findOne({ email: email });
        if (!collaboratorUser) {
            return res.status(404).json({ error: "User not found with the provided email" });
        }

        const collaboratorIdStr = collaboratorUser._id.toString();

        // Remove from editors (using ObjectId comparison)
        proposal.collaborators.editors = proposal.collaborators.editors.filter(editorId =>
            editorId && editorId.toString() !== collaboratorIdStr
        );
        // Remove from viewers (using ObjectId comparison)
        proposal.collaborators.viewers = proposal.collaborators.viewers.filter(viewerId =>
            viewerId && viewerId.toString() !== collaboratorIdStr
        );

        await proposal.save();

        res.json({
            message: "Collaborator removed successfully",
            collaborators: proposal.collaborators
        });
    } catch (error) {
        console.error("Error in removeCollaborator:", error);
        res.status(500).json({ error: error.message });
    }
};

// API: Get collaborators for a proposal
exports.getCollaborators = async (req, res) => {
    try {
        const { proposalId } = req.query;

        if (!proposalId) {
            return res.status(400).json({ error: "proposalId is required" });
        }

        // Get company mail (owner)
        let companyMail = "";
        if (req.user.role === "employee") {
            const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
            if (!employeeProfile) {
                return res.status(404).json({ error: "Employee profile not found" });
            }
            companyMail = employeeProfile.companyMail;
        } else {
            companyMail = req.user.email;
        }

        // Find proposal
        const proposal = await Proposal.findOne({ rfpId: proposalId, companyMail: companyMail });
        if (!proposal) {
            return res.status(404).json({ error: "Proposal not found" });
        }

        // Initialize collaborators if not set
        if (!proposal.collaborators || !proposal.collaborators.owner) {
            // Find the owner user by email
            const ownerUser = await User.findOne({ email: companyMail });
            if (!ownerUser) {
                return res.status(404).json({ error: "Owner user not found" });
            }

            proposal.collaborators = {
                owner: ownerUser._id,
                editors: [],
                viewers: []
            };
            await proposal.save();
        }

        res.json({ collaborators: proposal.collaborators });
    } catch (error) {
        console.error("Error in getCollaborators:", error);
        res.status(500).json({ error: error.message });
    }
};