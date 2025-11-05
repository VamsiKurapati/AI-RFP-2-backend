const mongoose = require('mongoose');

const emailContentSchema = new mongoose.Schema({
    emailSubject: { type: String, required: true },
    emailBody: { type: String, required: true },
    emailType: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('EmailContent', emailContentSchema);

//Create index for emailType for performance optimization
emailContentSchema.index({ emailType: 1 });
