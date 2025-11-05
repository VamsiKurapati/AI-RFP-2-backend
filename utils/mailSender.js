const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    }
});

exports.sendEmail = async (email, subject, body) => {
    if (!email || !subject || !body) {
        throw new Error("Email, subject, and body are required");
    }

    // Defensive check: Ensure body is not a Promise
    if (body instanceof Promise || (typeof body === 'object' && typeof body.then === 'function')) {
        throw new Error("Email body must be a string, not a Promise. Did you forget to await an async email template function?");
    }

    // Ensure body is a string
    if (typeof body !== 'string') {
        throw new Error(`Email body must be a string, received ${typeof body}`);
    }

    return new Promise((resolve, reject) => {
        const mailOptions = {
            from: process.env.MAIL_USER,
            to: email,
            subject: subject,
            html: body,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                reject(error);
            } else {
                resolve(info);
            }
        });
    });
};
