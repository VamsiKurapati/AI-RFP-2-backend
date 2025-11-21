require('dotenv').config();

const mongoose = require("mongoose");
const User = require("../models/User");
const CompanyProfile = require("../models/CompanyProfile");
const EmployeeProfile = require("../models/EmployeeProfile");
const Proposal = require("../models/Proposal");
const GrantProposal = require("../models/GrantProposal");
const { GridFsStorage } = require("multer-gridfs-storage");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { randomInt } = require("crypto");
const multer = require("multer");
const nodemailer = require("nodemailer");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payments");
const { summarizePdfBuffer } = require("../utils/documentSummarizer");
const CalendarEvent = require("../models/CalendarEvents");
const { queueEmail } = require("../utils/mailSender");
const { validateEmail, sanitizeInput, validateRequiredFields } = require("../utils/validation");
const { cleanupUploadedFiles } = require("../utils/fileCleanup");
const emailTemplates = require("../utils/emailTemplates");

const storage = new GridFsStorage({
    url: process.env.MONGO_URI,
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, buf) => {
                if (err) return reject(err);
                resolve({
                    filename: file.originalname,
                    bucketName: "uploads",
                    metadata: { originalname: file.originalname },
                });
            });
        });
    },
});


// Utility function to queue employee welcome email
async function sendEmail_1(email, password, companyName, name) {
    const { subject, body } = await emailTemplates.getEmployeeWelcomeEmail(name, email, password, companyName);

    try {
        queueEmail(email, subject, body, 'employeeWelcome');
    } catch (error) {
        throw error;
    }
}


const passwordValidator = (password) => {
    // At least 8 characters
    if (password.length < 8) return false;

    // Regular expressions
    const uppercase = /[A-Z]/;
    const lowercase = /[a-z]/;
    const digits = /[0-9]/;
    const special = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/;

    if (!uppercase.test(password)) return false;
    if (!lowercase.test(password)) return false;
    if (!digits.test(password)) return false;
    if (!special.test(password)) return false;

    return true;
};


const upload = multer({ storage });
const multiUpload = upload.fields([
    { name: "documents", maxCount: 10 },
    { name: "proposals", maxCount: 10 },
]);

const singleLogoUpload = upload.single('logo');
const singleCaseStudyUpload = upload.single('file');
const singleDocumentUpload = upload.single('document');

function generateStrongPassword(length = randomInt(8, 12)) {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    const allChars = uppercase + lowercase + digits + special;

    if (length < 8) throw new Error("Password length must be at least 8 characters");

    let password = '';
    password += uppercase[randomInt(0, uppercase.length)];
    password += special[randomInt(0, special.length)];

    const remainingLength = length - 2;
    const bytes = crypto.randomBytes(remainingLength);

    for (let i = 0; i < remainingLength; i++) {
        password += allChars[bytes[i] % allChars.length];
    }

    return password
        .split('')
        .sort(() => 0.5 - Math.random())
        .join('');
}

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

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "company") {
            return res.status(403).json({ message: "Access denied. Company profile required." });
        }

        const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const deadlines_1 = await CalendarEvent.find({ companyId: companyProfile._id, status: "Deadline", endDate: { $gte: new Date() } });

        const deadlinesPromises = deadlines_1.map(async (deadline) => {
            const proposal = deadline.proposalId ? await Proposal.findById(deadline.proposalId).lean() : null;
            const grantProposal = deadline.grantId ? await GrantProposal.findById(deadline.grantId).lean() : null;
            const status = proposal?.status || grantProposal?.status || "Not Submitted";

            if ((proposal || grantProposal) && status !== "Not Submitted") {
                return {
                    title: deadline.title,
                    status: status,
                    endDate: deadline.endDate,
                };
            }
        });

        const deadlinesResults = await Promise.all(deadlinesPromises);
        const deadlines = deadlinesResults.filter(deadline => deadline !== undefined);

        const data = {
            companyName: companyProfile.companyName,
            adminName: companyProfile.adminName,
            industry: companyProfile.industry,
            location: companyProfile.location,
            email: user.email,
            phone: user.mobile,
            linkedIn: companyProfile.linkedIn,
            bio: companyProfile.bio,
            website: companyProfile.website,
            services: companyProfile.services,
            establishedYear: companyProfile.establishedYear,
            numberOfEmployees: companyProfile.numberOfEmployees,
            caseStudies: companyProfile.caseStudies,
            licensesAndCertifications: companyProfile.licensesAndCertifications,
            employees: companyProfile.employees,
            logoUrl: companyProfile.logoUrl,
            documents: companyProfile.documents,
            awards: companyProfile.awards,
            clients: companyProfile.clients,
            preferredIndustries: companyProfile.preferredIndustries,
            deadlines: deadlines,
            activities: []
        };
        // Parallelize independent queries and use aggregation for counting
        const [Proposals, GrantProposals, proposalStats] = await Promise.all([
            Proposal.find({ companyMail: companyProfile.email }).lean(),
            GrantProposal.find({ companyMail: companyProfile.email }).lean(),
            Promise.all([
                Proposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]),
                GrantProposal.aggregate([
                    { $match: { companyMail: companyProfile.email } },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ])
            ])
        ]);

        const Proposals_1 = Proposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });
        const GrantProposals_1 = GrantProposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });

        // Combine stats from both collections
        const statusCounts = {};
        proposalStats.flat().forEach(stat => {
            statusCounts[stat._id] = (statusCounts[stat._id] || 0) + stat.count;
        });

        const totalProposals = Proposals_1.length + GrantProposals_1.length;
        const wonProposals = statusCounts["Won"] || 0;
        const lostProposals = statusCounts["Rejected"] || 0;
        const activeProposals = statusCounts["In Progress"] || 0;
        const successRate = totalProposals === 0 ? "0.00" : ((wonProposals / (wonProposals + lostProposals)) * 100).toFixed(2);
        const data_1 = {
            ...data,
            totalProposals,
            activeProposals,
            wonProposals,
            successRate,
            proposals: [...Proposals_1, ...GrantProposals_1],
        };
        res.status(200).json(data_1);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.getEmployeeProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "employee") {
            return res.status(403).json({ message: "You are not authorized to view this profile" });
        }

        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        if (!employeeProfile) {
            return res.status(404).json({ message: "Employee profile not found" });
        }

        const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const data = {
            name: employeeProfile.name,
            jobTitle: employeeProfile.jobTitle,
            accessLevel: employeeProfile.accessLevel,
            companyName: companyProfile.companyName,
            email: user.email,
            phone: user.mobile,
            location: employeeProfile.location,
            highestQualification: employeeProfile.highestQualification,
            skills: employeeProfile.skills,
            logoUrl: employeeProfile.logoUrl,
        };
        res.status(200).json(data);
    } catch (error) {
        console.error('Get employee profile error:', error);
        res.status(500).json({ message: error.message || "Server error" });
    }
};

exports.getCompanyProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
        const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const Proposals = await Proposal.find({ companyMail: companyProfile.email }).lean();
        const Proposals_1 = Proposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });
        const GrantProposals = await GrantProposal.find({ companyMail: companyProfile.email }).lean();
        const GrantProposals_1 = GrantProposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });
        const requiredData = {
            companyName: companyProfile.companyName,
            adminName: companyProfile.adminName,
            industry: companyProfile.industry,
            bio: companyProfile.bio,
            employees: companyProfile.employees,
            proposals: [...Proposals_1, ...GrantProposals_1],
            caseStudies: companyProfile.caseStudies,
        };

        res.status(200).json(requiredData);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getProposals = async (req, res) => {
    try {
        let userEmail = req.user.email;
        let companyMail = "";

        if (req.user.role === "company") {
            companyMail = userEmail;
        }
        else {
            const employeeProfile = await EmployeeProfile.findOne({ userId: req.user._id });
            companyMail = employeeProfile.companyMail;
        }

        const proposals = await Proposal.find({ companyMail: companyMail }).populate("currentEditor", "_id fullName email").lean();
        const proposals_1 = proposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });
        const grantProposals = await GrantProposal.find({ companyMail: companyMail }).populate("currentEditor", "_id fullName email").lean();
        const grantProposals_1 = grantProposals.map(proposal => {
            const { initialProposal, generatedProposal, ...rest } = proposal;
            return rest;
        });

        const finalProposals = [...proposals_1, ...grantProposals_1];
        res.status(200).json(finalProposals);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.uploadLogo = [
    singleLogoUpload,
    async (req, res) => {
        try {
            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                // Clean up uploaded file on validation failure
                await cleanupUploadedFiles(req);
                return res.status(400).json({ message: "Invalid file type. Only JPEG, JPG, and PNG images are allowed." });
            }

            // Validate file size (1MB limit)
            const maxSize = 1 * 1024 * 1024; // 1MB
            if (req.file.size > maxSize) {
                // Clean up uploaded file on validation failure
                await cleanupUploadedFiles(req);
                return res.status(400).json({ message: "File size exceeds 1MB limit" });
            }

            const logoUrl = `${req.file.id}`;
            if (user.role === "company") {
                await CompanyProfile.findOneAndUpdate(
                    { userId: req.user._id },
                    { logoUrl },
                    { new: true }
                );
            } else if (user.role === "employee") {
                await EmployeeProfile.findOneAndUpdate(
                    { userId: req.user._id },
                    { logoUrl },
                    { new: true }
                );
            } else {
                // Clean up uploaded file on validation failure
                await cleanupUploadedFiles(req);
                return res.status(403).json({ message: "Invalid user role for logo upload" });
            }
            res.status(200).json({ logoUrl });
        } catch (error) {
            // Clean up uploaded file on error
            await cleanupUploadedFiles(req);

            console.error('Logo upload error:', error);
            res.status(500).json({ message: error.message || "Server error" });
        }
    }
];

exports.updateCompanyProfile = [
    multiUpload,
    async (req, res) => {
        try {
            const { companyName, industry, location, linkedIn, website, phone, services, establishedYear, numberOfEmployees, bio, awards, clients, preferredIndustries, adminName } = req.body;

            // Input validation
            const requiredFields = ['companyName', 'industry', 'location', 'linkedIn', 'website', 'phone', 'services', 'establishedYear', 'numberOfEmployees', 'bio', 'awards', 'clients', 'preferredIndustries', 'adminName'];
            const validation = validateRequiredFields(req.body, requiredFields);
            if (!validation.isValid) {
                return res.status(400).json({ message: "Missing required fields", missingFields: validation.missingFields });
            }

            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.role !== "company") {
                return res.status(403).json({ message: "You are not authorized to update this profile" });
            }

            // Use transaction for data consistency
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Sanitize inputs
                const sanitizedPhone = phone ? sanitizeInput(phone) : user.mobile;
                user.mobile = sanitizedPhone;
                await user.save({ session });

                let parsedServices = [];
                if (typeof services === "string") {
                    try {
                        parsedServices = JSON.parse(services);
                        if (!Array.isArray(parsedServices)) {
                            parsedServices = [];
                        }
                    } catch {
                        parsedServices = [];
                    }
                }

                let parsedAwards = [];
                let parsedClients = [];

                if (typeof awards === "string") {
                    try {
                        parsedAwards = JSON.parse(awards);
                        if (!Array.isArray(parsedAwards)) {
                            parsedAwards = [];
                        }
                    } catch {
                        parsedAwards = [];
                    }
                }

                if (typeof clients === "string") {
                    try {
                        parsedClients = JSON.parse(clients);
                        if (!Array.isArray(parsedClients)) {
                            parsedClients = [];
                        }
                    } catch {
                        parsedClients = [];
                    }
                }

                let parsedPreferredIndustries = [];
                if (typeof preferredIndustries === "string") {
                    try {
                        parsedPreferredIndustries = JSON.parse(preferredIndustries);
                        if (!Array.isArray(parsedPreferredIndustries)) {
                            parsedPreferredIndustries = [];
                        }
                    } catch {
                        parsedPreferredIndustries = [];
                    }
                }

                const companyProfile = await CompanyProfile.findOneAndUpdate(
                    { userId: req.user._id },
                    { companyName, adminName, industry, location, linkedIn, website, services: parsedServices, establishedYear, numberOfEmployees, bio, awards: parsedAwards, clients: parsedClients, preferredIndustries: parsedPreferredIndustries },
                    { new: true, session }
                );

                await session.commitTransaction();
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
            res.status(200).json({ message: "Company profile updated successfully" });
        } catch (error) {
            console.error('Update company profile error:', error);
            res.status(500).json({ message: error.message || "Server error" });
        }
    }
];

exports.updateEmployeeProfile = [
    upload.none(),
    async (req, res) => {
        try {
            const { name, location, phone, highestQualification, skills } = req.body;

            // Input validation
            const requiredFields = ['name', 'location', 'phone', 'highestQualification', 'skills'];
            const validation = validateRequiredFields(req.body, requiredFields);
            if (!validation.isValid) {
                return res.status(400).json({ message: "Missing required fields", missingFields: validation.missingFields });
            }

            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.role !== "employee") {
                return res.status(403).json({ message: "You are not authorized to update this profile" });
            }

            // Sanitize inputs
            const sanitizedPhone = sanitizeInput(phone);
            const sanitizedName = sanitizeInput(name);
            const sanitizedLocation = sanitizeInput(location);

            // Use transaction for data consistency
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                user.mobile = sanitizedPhone;
                user.fullName = sanitizedName;
                await user.save({ session });

                const employeeProfile = await EmployeeProfile.findOneAndUpdate(
                    { userId: req.user._id },
                    { name: sanitizedName, location: sanitizedLocation, phone: sanitizedPhone, highestQualification, skills },
                    { new: true, session }
                );

                const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
                if (companyProfile && companyProfile.employees) {
                    const employeeIndex = companyProfile.employees.findIndex(emp => emp.email === employeeProfile.email);
                    if (employeeIndex !== -1) {
                        companyProfile.employees[employeeIndex].name = name;
                        // companyProfile.employees[employeeIndex].email = email;
                        companyProfile.employees[employeeIndex].phone = phone;
                        companyProfile.employees[employeeIndex].highestQualification = highestQualification;
                        companyProfile.employees[employeeIndex].skills = skills;
                        await companyProfile.save({ session });
                    }
                }

                await session.commitTransaction();
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
            res.status(200).json({ message: "Employee profile updated successfully" });
        } catch (error) {
            console.error('Update employee profile error:', error);
            res.status(500).json({ message: error.message || "Server error" });
        }
    }
];

const addEmployeeToCompanyProfile = async (req, employeeProfile) => {
    const companyProfile_1 = await CompanyProfile.findOneAndUpdate(
        { userId: req.user._id },
        {
            $push: {
                employees: {
                    employeeId: employeeProfile._id,
                    name: employeeProfile.name,
                    email: employeeProfile.email,
                    phone: employeeProfile.phone,
                    shortDesc: employeeProfile.about,
                    highestQualification: employeeProfile.highestQualification,
                    skills: employeeProfile.skills,
                    jobTitle: employeeProfile.jobTitle,
                    accessLevel: employeeProfile.accessLevel
                }
            }
        },
        { new: true }
    );
    await companyProfile_1.save();
}


exports.addEmployee = async (req, res) => {
    try {
        const { name, email, phone, shortDesc, highestQualification, skills, jobTitle, accessLevel } = req.body;

        // Input validation
        const requiredFields = ['name', 'email', 'phone', 'shortDesc', 'highestQualification', 'skills', 'jobTitle', 'accessLevel'];
        const validation = validateRequiredFields(req.body, requiredFields);
        if (!validation.isValid) {
            return res.status(400).json({
                message: "Missing required fields",
                missingFields: validation.missingFields
            });
        }

        // Sanitize inputs
        const sanitizedName = sanitizeInput(name);
        const sanitizedEmail = sanitizeInput(email);
        const sanitizedPhone = sanitizeInput(phone);
        const sanitizedShortDesc = sanitizeInput(shortDesc);
        const sanitizedHighestQualification = sanitizeInput(highestQualification);
        const sanitizedJobTitle = sanitizeInput(jobTitle);

        // Email validation
        if (!validateEmail(sanitizedEmail)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Access level validation
        const validAccessLevels = ['Member', 'Editor', 'Viewer'];
        if (!validAccessLevels.includes(accessLevel)) {
            return res.status(400).json({ message: "Invalid access level" });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to add an employee" });
        }

        //Check if email is already registered as Company
        const existingUser = await User.findOne({ email: sanitizedEmail, role: "company" });
        if (existingUser) {
            return res.status(400).json({ message: "Email already registered as Company" });
        }

        if (accessLevel == "Member") {
            const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });
            if (companyProfile.employees.some(emp => emp.email === sanitizedEmail)) {
                return res.status(400).json({ message: "Employee already exists in company profile" });
            }
            const employeeProfile = {
                name: sanitizedName,
                email: sanitizedEmail,
                phone: sanitizedPhone,
                about: sanitizedShortDesc,
                highestQualification: sanitizedHighestQualification,
                skills,
                jobTitle: sanitizedJobTitle,
                accessLevel,
                employeeId: new mongoose.Types.ObjectId(),
            };
            await addEmployeeToCompanyProfile(req, employeeProfile);
        } else {
            const subscription = await Subscription.findOne({ user_id: req.user._id });
            const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });
            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }
            if (companyProfile.employees.some(emp => emp.email === sanitizedEmail)) {
                return res.status(400).json({ message: "Employee already exists in company profile" });
            }
            const noOfEditors = companyProfile.employees.filter(emp => emp.accessLevel === "Editor").length;
            const noOfViewers = companyProfile.employees.filter(emp => emp.accessLevel === "Viewer").length;
            if (!subscription || subscription.end_date < new Date()) {
                return res.status(404).json({ message: "Subscription not found" });
            }
            if (accessLevel === "Editor" && subscription.max_editors <= noOfEditors) {
                return res.status(400).json({ message: "You have reached the maximum number of editors" });
            }
            if (accessLevel === "Viewer" && subscription.max_viewers <= noOfViewers) {
                return res.status(400).json({ message: "You have reached the maximum number of viewers" });
            }
            const user_1 = await User.findOne({ email: sanitizedEmail });
            if (!user_1) {
                const password = generateStrongPassword();
                const hashedPassword = await bcrypt.hash(password, 10);
                const user_2 = await User.create({
                    fullName: sanitizedName,
                    email: sanitizedEmail,
                    mobile: sanitizedPhone,
                    password: hashedPassword,
                    role: "employee"
                });
                const employeeProfile = new EmployeeProfile({
                    userId: user_2._id,
                    name: sanitizedName,
                    email: sanitizedEmail,
                    phone: sanitizedPhone,
                    about: sanitizedShortDesc,
                    highestQualification: sanitizedHighestQualification,
                    skills,
                    jobTitle: sanitizedJobTitle,
                    accessLevel,
                    companyMail: user.email
                });
                await employeeProfile.save();
                await addEmployeeToCompanyProfile(req, employeeProfile);
                await sendEmail_1(sanitizedEmail, password, companyProfile.companyName, sanitizedName);
            } else {
                const employeeProfile = await EmployeeProfile.findOne({ userId: user_1._id });
                if (employeeProfile) {
                    employeeProfile.name = sanitizedName;
                    employeeProfile.email = sanitizedEmail;
                    employeeProfile.phone = sanitizedPhone;
                    employeeProfile.about = sanitizedShortDesc;
                    employeeProfile.jobTitle = sanitizedJobTitle;
                    employeeProfile.skills = skills;
                    employeeProfile.highestQualification = sanitizedHighestQualification;
                    employeeProfile.accessLevel = accessLevel;
                    employeeProfile.companyMail = user.email;
                    await employeeProfile.save();
                    await addEmployeeToCompanyProfile(req, employeeProfile);
                    const password = generateStrongPassword();
                    const hashedPassword = await bcrypt.hash(password, 10);
                    await User.findOneAndUpdate(
                        { email: sanitizedEmail },
                        { password: hashedPassword },
                        { new: true }
                    );
                    await sendEmail_1(sanitizedEmail, password, companyProfile.companyName, sanitizedName);
                } else {
                    const employeeProfile = new EmployeeProfile({
                        userId: user_1._id,
                        name: sanitizedName,
                        email: sanitizedEmail,
                        phone: sanitizedPhone,
                        about: sanitizedShortDesc,
                        highestQualification: sanitizedHighestQualification,
                        skills,
                        jobTitle: sanitizedJobTitle,
                        accessLevel,
                        companyMail: user.email
                    });
                    await employeeProfile.save();
                    await addEmployeeToCompanyProfile(req, employeeProfile);
                    const password = generateStrongPassword();
                    const hashedPassword = await bcrypt.hash(password, 10);
                    await User.findOneAndUpdate(
                        { email: sanitizedEmail },
                        { password: hashedPassword },
                        { new: true }
                    );
                    await sendEmail_1(sanitizedEmail, password, companyProfile.companyName, sanitizedName);
                }
            }
        }
        res.status(201).json({ message: "Employee added successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.removeEmployee = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to remove an employee" });
        }
        const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }
        const employeeProfile = await EmployeeProfile.findOne({ email, companyMail: user.email });
        if (!employeeProfile) {
            return res.status(404).json({ message: "Employee profile not found" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const companyProfile_1 = await CompanyProfile.findOneAndUpdate(
                { userId: req.user._id },
                { $pull: { employees: { email: email, companyMail: user.email } } },
                { new: true, session }
            );
            await companyProfile_1.save({ session });

            await session.commitTransaction();
            res.status(201).json({ message: "Employee removed successfully" });
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

exports.addCaseStudy = [
    singleCaseStudyUpload,
    async (req, res) => {
        try {
            const { title, company } = req.body;
            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.role !== "company") {
                return res.status(403).json({ message: "You are not authorized to add a case study" });
            }

            const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });

            if (!companyProfile) {
                return res.status(404).json({ message: "Company profile not found" });
            }

            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            // File validation
            const allowedTypes = ['application/pdf', 'text/plain'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                //Delete the file from GridFS
                const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
                    bucketName: "uploads",
                });
                await bucket.delete(req.file.id);
                return res.status(400).json({ message: "Only PDF and TXT files are allowed" });
            }

            // File size validation (5MB limit)
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (req.file.size > maxSize) {
                //Delete the file from GridFS
                const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
                    bucketName: "uploads",
                });
                await bucket.delete(req.file.id);
                return res.status(400).json({ message: "File size exceeds 5MB limit" });
            }

            const fileUrl = `${process.env.BACKEND_URL}/profile/getCaseStudy/${req.file.id}`;

            const companyProfile_1 = await CompanyProfile.findOneAndUpdate(
                { userId: req.user._id },
                {
                    $push: {
                        caseStudies: {
                            title,
                            company,
                            fileUrl,
                        }
                    }
                },
                { new: true }
            );
            await companyProfile_1.save();
            res.status(201).json({ message: "Case study added successfully" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
];

exports.addLicenseAndCertification = async (req, res) => {
    try {
        const { name, issuer, validTill } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const companyProfile = await CompanyProfile.findOneAndUpdate(
            { userId: req.user._id },
            { $push: { licensesAndCertifications: { name, issuer, validTill } } },
            { new: true }
        );
        res.status(201).json({ message: "License and certification added successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addDocument = [
    singleDocumentUpload,
    async (req, res) => {
        try {
            const { name, type } = req.body;
            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.role !== "company") {
                return res.status(403).json({ message: "You are not authorized to add documents" });
            }
            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            // File validation
            const allowedTypes = ['application/pdf', 'text/plain'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                //Delete the file from GridFS
                const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
                    bucketName: "uploads",
                });
                await bucket.delete(req.file.id);
                return res.status(400).json({ message: "Only PDF and TXT files are allowed" });
            }

            // File size validation (5MB limit)
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (req.file.size > maxSize) {
                //Delete the file from GridFS
                const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
                    bucketName: "uploads",
                });
                await bucket.delete(req.file.id);
                return res.status(400).json({ message: "File size exceeds 5MB limit" });
            }

            const fileUrl = `${process.env.BACKEND_URL}/profile/getDocument/${req.file.id}`;

            const buffer = await getFileBufferFromGridFS(req.file.id);


            let documentSummary = null;
            try {
                documentSummary = await summarizePdfBuffer(buffer);
            } catch (error) {
            }

            const companyProfile = await CompanyProfile.findOneAndUpdate(
                { userId: req.user._id },
                {
                    $push: {
                        documents: {
                            name: name || req.file.originalname,
                            type: type || "PDF",
                            size: req.file.size,
                            url: fileUrl,
                            fileId: req.file.id
                        },
                        documentSummaries: {
                            name: name || req.file.originalname,
                            fileId: req.file.id,
                            summary: documentSummary || "No summary available",
                        }
                    }
                },
                { new: true }
            );
            await companyProfile.save();

            res.status(201).json({ message: "Document added successfully" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
];

exports.getProfileImage = async (req, res) => {
    try {
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "uploads",
        });
        const fileId = new mongoose.Types.ObjectId(req.params.id);
        const downloadStream = bucket.openDownloadStream(fileId);
        downloadStream.on("error", () => res.status(404).send("File not found"));
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getCaseStudy = async (req, res) => {
    try {
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "uploads",
        });
        const fileId = new mongoose.Types.ObjectId(req.params.id);
        const downloadStream = bucket.openDownloadStream(fileId);
        downloadStream.on("error", () => res.status(404).send("File not found"));
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getDocument = async (req, res) => {
    try {
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "uploads",
        });
        const fileId = new mongoose.Types.ObjectId(req.params.id);
        const downloadStream = bucket.openDownloadStream(fileId);
        downloadStream.on("error", () => res.status(404).send("File not found"));
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteDocument = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to delete a document" });
        }
        const { id } = req.params;

        const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });
        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const document = companyProfile.documents.find(document => document._id.toString() === id);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "uploads",
        });
        await bucket.delete(document.fileId);

        companyProfile.documents = companyProfile.documents.filter(document => document._id.toString() !== id);

        companyProfile.documentSummaries = companyProfile.documentSummaries.filter(documentSummary => documentSummary.fileId.toString() !== document.fileId.toString());

        await companyProfile.save();

        res.status(200).json({ message: "Document deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteCaseStudy = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to delete a case study" });
        }

        const { id } = req.params;

        const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });

        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const caseStudy = companyProfile.caseStudies.find(caseStudy => caseStudy._id.toString() === id);
        if (!caseStudy) {
            return res.status(404).json({ message: "Case study not found" });
        }

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "uploads",
        });

        await bucket.delete(new mongoose.Types.ObjectId(caseStudy.fileUrl.split("/").pop()));

        companyProfile.caseStudies = companyProfile.caseStudies.filter(caseStudy => caseStudy._id.toString() !== id);

        await companyProfile.save();

        res.status(200).json({ message: "Case study deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteLicenseAndCertification = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to delete a license and certification" });
        }

        const { id } = req.params;

        const companyProfile = await CompanyProfile.findOne({ userId: req.user._id });

        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const licenseAndCertification = companyProfile.licensesAndCertifications.find(licenseAndCertification => licenseAndCertification._id.toString() === id);

        if (!licenseAndCertification) {
            return res.status(404).json({ message: "License and certification not found" });
        }

        companyProfile.licensesAndCertifications = companyProfile.licensesAndCertifications.filter(licenseAndCertification => licenseAndCertification._id.toString() !== id);

        await companyProfile.save();

        res.status(200).json({ message: "License and certification deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteEmployee = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "company") {
            return res.status(403).json({ message: "You are not authorized to delete an employee" });
        }

        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ message: "Employee ID is required" });
        }

        const employeeProfile = await EmployeeProfile.findById(id);

        if (!employeeProfile) {
            return res.status(404).json({ message: "Employee profile not found" });
        }

        const emprole = employeeProfile.accessLevel;

        const userId = employeeProfile.userId;

        const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });

        if (!companyProfile) {
            return res.status(404).json({ message: "Company profile not found" });
        }

        const employee = companyProfile.employees?.find(employee => employee.employeeId.toString() === id);

        if (!employee) {
            return res.status(404).json({ message: "Employee not found" });
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            if (companyProfile.employees) {
                companyProfile.employees = companyProfile.employees.filter(employee => employee.employeeId.toString() !== id);
            }

            await companyProfile.save({ session });

            const proposals = await Proposal.find({ currentEditor: userId });

            const grantProposals = await GrantProposal.find({ currentEditor: userId });

            if (proposals.length > 0 || grantProposals.length > 0) {
                await Promise.all(proposals.map(async (proposal) => {
                    proposal.currentEditor = companyProfile.userId;
                    await proposal.save({ session });
                }));
                await Promise.all(grantProposals.map(async (grantProposal) => {
                    grantProposal.currentEditor = companyProfile.userId;
                    await grantProposal.save({ session });
                }));
            }

            await EmployeeProfile.findByIdAndDelete(id, { session });

            if (emprole !== "Member") {
                await User.findByIdAndDelete(userId, { session });
            }

            await session.commitTransaction();
            res.status(200).json({ message: "Employee deleted successfully" });
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

exports.changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const isPasswordCorrect = await bcrypt.compare(oldPassword, user.password);
        if (!isPasswordCorrect) {
            return res.status(400).json({ message: "Invalid old password" });
        }
        if (!passwordValidator(newPassword)) {
            return res.status(400).json({ message: "Invalid new password" });
        }
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        const { subject, body } = await emailTemplates.getPasswordChangedEmail(user.fullName);

        queueEmail(user.email, subject, body, 'passwordChanged');

        res.status(201).json({ message: "Password changed successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


exports.getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;

        const payments = await Payment.find({
            user_id: id
        });

        if (payments.length === 0) {
            return res.status(404).json({ message: "Payments not found" });
        }

        res.status(200).json(payments);
    } catch (err) {
        res.status(500).json({
            message: "Error fetching payment by ID",
            error: err.message
        });
    }
};