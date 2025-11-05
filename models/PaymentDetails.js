const mongoose = require("mongoose");

const paymentDetailsSchema = new mongoose.Schema({
  upi_id: { type: String, required: false, default: null },
  account_holder_name: { type: String, required: false, default: null },
  account_number: { type: String, required: false, default: null },
  ifsc_code: { type: String, required: false, default: null },
  bank_name: { type: String, required: false, default: null },
  branch_name: { type: String, required: false, default: null },
  bank_address: { type: String, required: false, default: null },
  is_primary: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("PaymentDetails", paymentDetailsSchema);
