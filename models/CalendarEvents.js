const mongoose = require("mongoose");

const calendarEventSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyProfile", required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeProfile", required: true },
  proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal", required: false },
  grantId: { type: mongoose.Schema.Types.ObjectId, ref: "Grant", required: false },
  title: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ["In Progress", "Submitted", "Won", "Rejected", "Deadline"], default: "Deadline" },
}, { timestamps: true });

// Database indexes for performance optimization
calendarEventSchema.index({ companyId: 1 });
calendarEventSchema.index({ employeeId: 1 });
calendarEventSchema.index({ proposalId: 1 });
calendarEventSchema.index({ grantId: 1 });
calendarEventSchema.index({ createdAt: -1 });
// Compound index for common query patterns
calendarEventSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model("CalendarEvent", calendarEventSchema);