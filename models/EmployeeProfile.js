// models/EmployeeProfile.js
const mongoose = require("mongoose");

const employeeProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", },
  companyMail: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  linkedIn: { type: String, default: "No linkedIn" },
  location: { type: String, default: "No location" },
  jobTitle: { type: String, required: true },
  about: { type: String, default: "No description" },
  accessLevel: { type: String, default: "Viewer" },
  highestQualification: { type: String, default: "Not specified" },
  skills: { type: [String], default: [] },
  logoUrl: { type: String, default: "https://via.placeholder.com/150" },
}, { timestamps: true });

// Database indexes for performance optimization
employeeProfileSchema.index({ userId: 1 });
employeeProfileSchema.index({ companyMail: 1 });
employeeProfileSchema.index({ email: 1 });
employeeProfileSchema.index({ accessLevel: 1 });
employeeProfileSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
employeeProfileSchema.index({ companyMail: 1, accessLevel: 1 });

module.exports = mongoose.model("EmployeeProfile", employeeProfileSchema);