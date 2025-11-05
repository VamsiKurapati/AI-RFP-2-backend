// models/CompanyProfile.js
const mongoose = require("mongoose");

const companyProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, required: true, unique: true },
  companyName: { type: String, required: true },
  adminName: { type: String, required: true },
  industry: { type: String, required: true },
  location: { type: String, required: true },
  website: { type: String, required: true },
  linkedIn: { type: String, required: true },
  services: { type: [String], default: [] },
  establishedYear: { type: Number, required: true },
  awards: { type: [String], default: [] },
  clients: { type: [String], default: [] },
  preferredIndustries: { type: [String], default: [] },
  numberOfEmployees: { type: String, default: "0-10" },
  employees: [
    {
      employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeProfile", default: null },
      name: String,
      shortDesc: String,
      highestQualification: String,
      skills: [String],
      jobTitle: String,
      email: String,
      phone: String,
      accessLevel: String,
    },
  ],
  bio: { type: String, required: true },
  caseStudies: [
    {
      title: { type: String, required: true },
      company: { type: String, required: true },
      fileUrl: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  licensesAndCertifications: [
    {
      name: { type: String, required: true },
      issuer: { type: String, required: true },
      validTill: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  documents: [
    {
      name: String,
      type: { type: String, default: "PDF" },
      size: { type: Number, required: true },
      url: { type: String, required: true },
      fileId: { type: mongoose.Types.ObjectId, required: true },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  documentSummaries: [
    {
      name: String,
      fileId: { type: mongoose.Types.ObjectId, required: true },
      summary: String,
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  proposals: [
    {
      title: { type: String, required: true },
      company: { type: String, required: true },
      amount: { type: Number, required: true },
      status: { type: String, default: "In Progress" },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  recentActivities: [
    {
      title: { type: String, required: true },
      description: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  deadlines: [
    {
      title: { type: String, required: true },
      status: { type: String, required: true },
      dueDate: { type: Date, required: true },
      createdAt: { type: Date, default: Date.now },
    }
  ],
  logoUrl: { type: String }, // URL to the company profile image/logo
  status: { type: String, default: "Inactive" },
  blocked: { type: Boolean, default: false },
  fetchedMatchingRFPs: { type: Boolean, default: false },
  fetchedMatchingRFPsAt: { type: Date, default: null },
}, { timestamps: true });

// Database indexes for performance optimization
companyProfileSchema.index({ userId: 1 }); // Already exists as ref, but explicit for clarity
// Note: email index is automatically created by unique: true
companyProfileSchema.index({ industry: 1 });
companyProfileSchema.index({ location: 1 });
companyProfileSchema.index({ status: 1 });
companyProfileSchema.index({ blocked: 1 });
companyProfileSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
companyProfileSchema.index({ industry: 1, status: 1 });
companyProfileSchema.index({ blocked: 1, status: 1 });

module.exports = mongoose.model("CompanyProfile", companyProfileSchema);
