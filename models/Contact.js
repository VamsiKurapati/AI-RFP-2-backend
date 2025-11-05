const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    company: { type: String, required: false },
    email: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, required: true, enum: ["Connected", "Open"] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contact", contactSchema);
