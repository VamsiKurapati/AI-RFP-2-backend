const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const CompanyProfile = require("../models/CompanyProfile");
const EmployeeProfile = require("../models/EmployeeProfile");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { GridFsStorage } = require("multer-gridfs-storage");
const crypto = require("crypto");
const path = require("path");
const Subscription = require("../models/Subscription");
const Notification = require("../models/Notification");
const OTP = require("../models/OTP");
const VerificationCode = require("../models/VerificationCode");
const { queueEmail } = require("../utils/mailSender");
const { validateEmail, validatePassword, sanitizeInput, validateRequiredFields } = require("../utils/validation");
const { cleanupUploadedFiles } = require("../utils/fileCleanup");
const emailTemplates = require("../utils/emailTemplates");

const storage = new GridFsStorage({
  url: process.env.MONGO_URI,
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if (err) return reject(err);
        const filename = buf.toString("hex") + path.extname(file.originalname);
        resolve({
          filename,
          bucketName: "uploads",
          metadata: { originalname: file.originalname },
        });
      });
    });
  },
});

const upload = multer({ storage });
const multiUpload = upload.fields([
  { name: "documents", maxCount: 10 },
  { name: "proposals", maxCount: 10 },
]);

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


exports.signupWithProfile = [
  multiUpload,
  async (req, res) => {
    try {
      const { email, fullName, password, phone, role } = req.body;

      // Input validation
      const requiredFields = ['email', 'fullName', 'password', 'phone', 'role'];
      const validation = validateRequiredFields(req.body, requiredFields);
      if (!validation.isValid) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({
          message: "Missing required fields",
          missingFields: validation.missingFields
        });
      }

      // Sanitize inputs
      const sanitizedEmail = sanitizeInput(email);
      const sanitizedFullName = sanitizeInput(fullName);
      const sanitizedPhone = sanitizeInput(phone);

      // Validate email format
      if (!validateEmail(sanitizedEmail)) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({ message: "Invalid email format" });
      }

      const verificationCodeData = await VerificationCode.findOne({ email: sanitizedEmail });
      if (!verificationCodeData || !verificationCodeData.verifiedAt) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({ message: "Email not verified" });
      }

      // Validate password
      if (!validatePassword(password)) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({ message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character" });
      }

      // Validate role. Only company role is allowed
      const validRoles = ['company'];
      if (!validRoles.includes(role)) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({ message: "Invalid role. Must be 'company'" });
      }

      const existing = await User.findOne({ email: sanitizedEmail });
      if (existing) {
        // Clean up uploaded files on validation failure
        await cleanupUploadedFiles(req);
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password with proper salt rounds
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Use transaction for data consistency
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const user = new User({
          email: sanitizedEmail,
          fullName: sanitizedFullName,
          password: hashedPassword,
          mobile: sanitizedPhone,
          role
        });
        await user.save({ session });

        const profileData = {
          userId: user._id,
        };

        if (role === "company") {
          // Validate and sanitize company profile data
          const companyFields = ['companyName', 'industry', 'location', 'numberOfEmployees', 'website', 'bio', 'establishedYear', 'linkedIn', 'adminName'];
          const companyData = {};

          for (const field of companyFields) {
            if (req.body[field]) {
              companyData[field] = sanitizeInput(req.body[field]);
            }
          }

          profileData.email = sanitizedEmail;
          Object.assign(profileData, companyData);

          const companyProfile = new CompanyProfile(profileData);
          await companyProfile.save({ session });
        }

        const notification = new Notification({
          type: "User",
          title: "New user registered",
          description: "A new user has registered to the platform",
          created_at: new Date(),
        });
        await notification.save({ session });

        //Create a free subscription for the user with the free plan of 1 proposal generation and 1 grant proposal generation
        const freeSubscription = new Subscription({
          user_id: user._id,
          plan_name: "Free",
          plan_price: 0,
          start_date: new Date(),
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          max_rfp_proposal_generations: 1,
          max_grant_proposal_generations: 1,
          max_editors: 0,
          max_viewers: 0,
          current_rfp_proposal_generations: 0,
          current_grant_proposal_generations: 0,
          auto_renewal: false,
        });
        await freeSubscription.save({ session });

        //Update the user with the free subscription
        user.subscription_id = freeSubscription._id;
        await user.save({ session });

        await session.commitTransaction();
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }

      const { subject, body } = await emailTemplates.getWelcomeEmail(sanitizedFullName);

      try {
        queueEmail(sanitizedEmail, subject, body, 'welcome');
      } catch (emailError) {
        console.error('Email queuing failed:', emailError);
        // Don't fail the signup if email fails
      }

      // Delete the verification code
      await VerificationCode.deleteOne({ email: sanitizedEmail });

      res.status(201).json({ message: "Signup and profile created successfully" });
    } catch (err) {
      // Clean up uploaded files if signup fails
      await cleanupUploadedFiles(req);

      console.error('Signup error:', err);
      res.status(500).json({ message: err.message || "Server error" });
    }
  },
];

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Input validation
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Sanitize email
    const sanitizedEmail = sanitizeInput(email);

    // Validate email format
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const user = await User.findOne({ email: sanitizedEmail });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const userObj = user.toObject();
    const { password: _, ...userWithoutPassword } = userObj; // excluded password

    // Check if the company is blocked or if employee is logging in check if the company is blocked
    if (user.role === "company") {
      const companyProfile = await CompanyProfile.findOne({ userId: user._id });
      if (companyProfile && companyProfile.blocked) {
        return res.status(400).json({ message: "Your account is blocked. Please contact support." });
      }
    }

    if (user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: user._id });
      if (employeeProfile && employeeProfile.companyMail) {
        const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
        if (companyProfile && companyProfile.blocked) {
          return res.status(400).json({ message: "Your company is blocked. Please contact support." });
        }
      }
    }

    const token = jwt.sign(
      { user: userWithoutPassword },
      process.env.JWT_SECRET,
      { expiresIn: "12h", issuer: "rfp-grants-api", audience: "rfp-grants-client" }
    );

    if (user.role === "SuperAdmin" || user.role === "company") {
      const subscription = await Subscription.find({ user_id: user._id }).sort({ created_at: -1 }).limit(1).lean();
      let subscriptionData = {};
      if (subscription.length === 0 || subscription[0].end_date < new Date()) {
        subscriptionData = {
          plan_name: "None",
          max_rfp_proposal_generations: 0,
          max_grant_proposal_generations: 0,
        };
      } else {
        subscriptionData = subscription[0];
      }

      const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || "Not found";
      const { subject, body } = await emailTemplates.getLoginAlertEmail(user.fullName, ipAddress);

      try {
        queueEmail(user.email, subject, body, 'loginAlert');
      } catch (emailError) {
        console.error('Email queuing failed:', emailError);
        // Don't fail login if email fails
      }

      user.onboarding_status = true;
      await user.save();

      return res.status(200).json({ token, user: userWithoutPassword, subscription: subscriptionData });
    } else if (user.role === "employee") {
      const employeeProfile = await EmployeeProfile.findOne({ userId: user._id });
      if (!employeeProfile) {
        return res.status(404).json({ message: "Employee profile not found" });
      }
      const data = {
        ...userWithoutPassword,
        accessLevel: employeeProfile.accessLevel,
      };

      const companyProfile = await CompanyProfile.findOne({ email: employeeProfile.companyMail });
      if (!companyProfile) {
        return res.status(404).json({ message: "Company profile not found" });
      }

      const User_1 = await User.findOne({ email: companyProfile.email });
      const subscription = await Subscription.find({ user_id: User_1._id }).sort({ created_at: -1 }).limit(1).lean();

      let subscriptionData = {};
      if (subscription.length === 0 || subscription[0].end_date < new Date()) {
        subscriptionData = {
          plan_name: "None",
          max_rfp_proposal_generations: 0,
          max_grant_proposal_generations: 0,
        };
      } else {
        subscriptionData = subscription[0];
      }

      const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || "Not found";
      const { subject, body } = await emailTemplates.getLoginAlertEmail(user.fullName, ipAddress);

      try {
        queueEmail(user.email, subject, body, 'loginAlert');
      } catch (emailError) {
        console.error('Email queuing failed:', emailError);
        // Don't fail login if email fails
      }

      user.onboarding_status = true;
      await user.save();

      return res.status(200).json({ token, user: data, subscription: subscriptionData });
    } else {
      return res.status(400).json({ message: "Invalid user role" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

exports.logout = async (req, res) => {
  try {
    if (!req.headers.authorization) {
      return res.status(400).json({ message: "Authorization header missing" });
    }

    const token = req.headers.authorization.split(" ")[1];
    if (!token) {
      return res.status(400).json({ message: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "Logout successful" });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Token expired" });
    }
    res.status(500).json({ message: err.message || "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Input validation
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Sanitize and validate email
    const sanitizedEmail = sanitizeInput(email);
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate secure OTP using crypto.randomInt() and convert to string
    const otp = crypto.randomInt(100000, 999999).toString();

    const otpData = new OTP({ email: sanitizedEmail, otp });

    await otpData.save();

    // Send email with OTP using the existing utility
    const { subject, body } = await emailTemplates.getOTPEmail(user.fullName, otp, 'password reset');

    try {
      queueEmail(sanitizedEmail, subject, body, 'otp');
    } catch (emailError) {
      console.error('Email queuing failed:', emailError);
      // Clean up OTP record if email fails
      await OTP.deleteOne({ email: sanitizedEmail, otp });
      return res.status(500).json({ message: "Email queuing failed" });
    }

    res.status(200).json({ message: "Password reset email sent" });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Input validation
    const requiredFields = ['email', 'otp', 'newPassword'];
    const validation = validateRequiredFields(req.body, requiredFields);
    if (!validation.isValid) {
      return res.status(400).json({
        message: "Missing required fields",
        missingFields: validation.missingFields
      });
    }

    // Sanitize and validate email
    const sanitizedEmail = sanitizeInput(email);
    if (!validateEmail(sanitizedEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    // Validate new password
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character" });
    }

    const otpData = await OTP.findOne({ email: sanitizedEmail, otp });

    if (!otpData) {
      return res.status(404).json({ message: "Invalid OTP" });
    }

    if (otpData.expiresAt < new Date()) {
      return res.status(404).json({ message: "OTP expired" });
    }

    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      user.password = hashedPassword;
      await user.save({ session });

      await OTP.deleteOne({ email: sanitizedEmail, otp }, { session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    const { subject, body } = await emailTemplates.getPasswordResetSuccessEmail(user.fullName);
    queueEmail(user.email, subject, body, 'passwordResetSuccess');

    res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
};

exports.sendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: sanitizeInput(email) });
    if (user) {
      return res.status(404).json({ message: "User already exists with this email" });
    }

    const verificationCode = crypto.randomInt(100000, 999999).toString();

    // Delete the existing verification codes
    await VerificationCode.deleteMany({ email: sanitizeInput(email) });

    const verificationCodeData = new VerificationCode({ email: sanitizeInput(email), code: verificationCode, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await verificationCodeData.save();

    const { subject, body } = await emailTemplates.getEmailVerificationEmail(verificationCode);

    try {
      queueEmail(sanitizeInput(email), subject, body, 'emailVerification');
    } catch (emailError) {
      console.error('Email queuing failed:', emailError);
      return res.status(500).json({ message: "Email queuing failed" });
    }

    res.status(200).json({ message: "Verification email sent" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    const verificationCodeData = await VerificationCode.findOne({ email: sanitizeInput(email), code });
    if (!verificationCodeData) {
      return res.status(404).json({ message: "Invalid verification code" });
    }

    if (verificationCodeData.expiresAt < new Date()) {
      return res.status(404).json({ message: "Verification code expired" });
    }

    verificationCodeData.verifiedAt = new Date();
    await verificationCodeData.save();

    res.status(200).json({ message: "Email verified successfully" });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};
