const axios = require('axios');
const EmailContent = require('../models/EmailContent');

// Simple in-memory cache for IP lookups
// Format: { "IP_ADDRESS": { locationInfo: "City, Region, Country", timestamp: 1690000000000 } }
const ipCache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getLocationFromIP(ipAddress) {
    if (!ipAddress) return 'Unknown Location';

    const now = Date.now();
    const cached = ipCache[ipAddress];

    // If cached and still valid, return it
    if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.locationInfo;
    }

    try {
        const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`);
        const data = response.data;

        let locationInfo = 'Unknown Location';
        if (data && data.city && data.region && data.country_name) {
            locationInfo = `${data.city}, ${data.region}, ${data.country_name}`;
        }

        // Cache the result
        ipCache[ipAddress] = { locationInfo, timestamp: now };
        return locationInfo;
    } catch (err) {
        console.error('Error fetching IP location:', err.message);
        return 'Unknown Location';
    }
}

// Helper function to replace placeholders in email content
function replacePlaceholders(template, replacements) {
    let result = template;
    // Add default replacements
    const defaultReplacements = {
        frontendUrl: process.env.FRONTEND_URL || '#',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com'
    };

    // Merge user replacements with defaults (user replacements take precedence)
    const allReplacements = { ...defaultReplacements, ...replacements };

    for (const [key, value] of Object.entries(allReplacements)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, value !== null && value !== undefined ? String(value) : '');
    }

    return applyConditionalBlocks(result, allReplacements);
}

function applyConditionalBlocks(template, replacements) {
    if (!template) return template;
    return template.replace(/<!--\s*IF\s+([a-zA-Z0-9_]+)\s*-->([\s\S]*?)<!--\s*ENDIF\s+\1\s*-->/g, (match, key, content) => {
        const value = replacements[key];
        if (value !== null && value !== undefined && value !== '') {
            return content;
        }
        return '';
    });
}

// Helper function to get email content from database with fallback
async function getEmailContentFromDB(emailType) {
    try {
        const emailContent = await EmailContent.findOne({ emailType: emailType });
        if (emailContent) {
            return {
                subject: emailContent.emailSubject,
                body: emailContent.emailBody
            };
        }
        // Return null if not found, caller should handle fallback
        return null;
    } catch (error) {
        console.error(`Error fetching email content for ${emailType}:`, error);
        return null;
    }
}

/**
 * Outlook-compatible Email Templates for RFP2GRANTS
 * - All important colors and backgrounds are inline for Outlook compatibility.
 * - Layout / alignment preserved.
 *
 * Color choices (slightly boosted contrast for Outlook):
 * Primary blue: #1E4EDD
 * Secondary gray: #475569
 * Success: #15803D
 * Warning: #DC2626
 * Page background: #F8FAFC
 * Footer bg: #0F172A
 */

// Helper: base wrapper that keeps layout same and inlines header/footer
const getBaseTemplate = (content, preheader = '') => {
    // Note: We keep the content HTML (which already uses inline styles in the templates below).
    // The outer wrapper uses table-based layout and inline styles for reliable rendering in Outlook.
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <title>RFP2GRANTS</title>
    </head>
    <body style="margin:0; padding:0; background-color: #F8FAFC; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a;">
        ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${preheader}</div>` : ''}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F8FAFC; padding:20px 0;">
            <tr>
                <td align="center">
                    <!-- email wrapper -->
                    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff; border-collapse:collapse;">
                        <!-- header -->
                        <tr>
                            <td align="center" style="background-color:#1E4EDD; padding:40px 30px; text-align:center;">
                                <a href="${process.env.FRONTEND_URL || '#'}" style="color:#ffffff; font-size:28px; font-weight:700; text-decoration:none; display:inline-block; font-family: 'Segoe UI', Arial, sans-serif;">
                                    RFP2GRANTS
                                </a>
                            </td>
                        </tr>

                        <!-- content area -->
                        <tr>
                            <td style="padding:40px 30px;">

                                ${content}

                            </td>
                        </tr>

                        <!-- footer -->
                        <tr>
                            <td align="center" style="background-color:#0F172A; padding:30px; text-align:center;">
                                <p style="font-size:14px; color:#94A3B8; margin:0 0 12px;">
                                    © ${new Date().getFullYear()} RFP2GRANTS. All rights reserved.
                                </p>
                                <p style="margin:0 0 12px;">
                                    <a href="${process.env.FRONTEND_URL || '#'}" style="color:#CBD5E1; text-decoration:none; font-weight:500; font-size:14px; margin:0 8px;">Home</a>
                                    <span style="color:#CBD5E1;">|</span>
                                    <a href="${process.env.FRONTEND_URL || '#'}\/contact" style="color:#CBD5E1; text-decoration:none; font-weight:500; font-size:14px; margin:0 8px;">Contact Us</a>
                                    <span style="color:#CBD5E1;">|</span>
                                    <a href="${process.env.FRONTEND_URL || '#'}\/privacy" style="color:#CBD5E1; text-decoration:none; font-weight:500; font-size:14px; margin:0 8px;">Privacy Policy</a>
                                </p>
                                <p style="font-size:14px; color:#94A3B8; margin:12px 0 0;">
                                    Need help? Contact us at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@example.com'}" style="color:#60A5FA; text-decoration:none;">${process.env.SUPPORT_EMAIL || 'support@example.com'}</a>
                                </p>
                            </td>
                        </tr>
                    </table>
                    <!-- /email wrapper -->
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
};

// Reusable inline style snippets (for readability)
const styles = {
    greeting: 'font-size:24px; font-weight:600; color:#0f172a; margin:0 0 20px;',
    message: 'font-size:16px; color:#475569; line-height:1.8; margin:0 0 20px;',
    highlightBox: 'background-color:#dbeafe; border-left:4px solid #1E4EDD; padding:20px; margin:30px 0; border-radius:6px;',
    infoItem: 'padding:10px 0; border-bottom:1px solid #E2E8F0;',
    infoLabel: 'color:#64748b; font-size:14px; font-weight:500; margin-bottom:4px;',
    infoValue: 'color:#0f172a; font-size:16px; font-weight:600;',
    btnPrimary: 'display:inline-block; background-color:#1E4EDD; color:#ffffff !important; padding:14px 32px; text-decoration:none; border-radius:6px; font-weight:600; font-size:16px; margin:20px 0; box-shadow:0 4px 6px rgba(30,78,221,0.22);',
    btnSecondary: 'display:inline-block; background-color:#475569; color:#ffffff !important; padding:14px 32px; text-decoration:none; border-radius:6px; font-weight:600; font-size:16px; margin:20px 0; box-shadow:0 4px 6px rgba(71,85,105,0.22);',
    otpCode: 'font-size:32px; font-weight:700; color:#1E4EDD; letter-spacing:8px; text-align:center; padding:20px; background-color:#dbeafe; border-radius:8px; margin:30px 0; border:2px dashed #1E4EDD;',
    divider: 'height:1px; background-color:#E2E8F0; margin:30px 0;',
    warningBox: 'background-color:#fee2e2; border-left:4px solid #DC2626; padding:16px; margin:20px 0; border-radius:6px;',
    successBox: 'background-color:#dcfce7; border-left:4px solid #15803D; padding:20px; margin:20px 0; border-radius:6px;'
};

// Welcome Email Template
exports.getWelcomeEmail = async (fullName) => {
    const emailContent = await getEmailContentFromDB('welcome');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Welcome to RFP2GRANTS! 🎉</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">🎊 Your account has been successfully created! We're thrilled to have you join our community.</p>
        </div>

        <p style="${styles.message}">
            You're now part of a powerful platform designed to streamline your RFP and grant proposal process. Get started by logging in and exploring all the features we have to offer.
        </p>

        <p style="${styles.message}">
            A free subscription has been created for you with access to 1 RFP and 1 Grant proposal generation.
        </p>

        <p style="${styles.message}">
            You can upgrade to a paid plan at any time to get more RFP and Grant proposal generations and access to all features.
        </p>

        <div style="text-align:center;">
            <a href="${process.env.FRONTEND_URL || '#'}\/login" style="${styles.btnPrimary}">Login to Your Account →</a>
        </div>

        <div style="${styles.divider}"></div>

        <div style="${styles.highlightBox}">
            <p style="margin:0; color:#1E40AF; font-weight:600;">✨ Quick Start Tips:</p>
            <ul style="margin:12px 0 0 20px; color:#475569;">
                <li style="margin:8px 0;">Complete your company profile for better proposal matching</li>
                <li style="margin:8px 0;">Upload relevant documents to enhance AI-generated proposals</li>
                <li style="margin:8px 0;">Explore your dashboard to discover active RFPs and grants</li>
            </ul>
        </div>

        <p style="${styles.message}">If you have any questions, our support team is always here to help!</p>
    `;

    return {
        subject: 'Welcome to RFP2GRANTS - Your account is ready!',
        body: getBaseTemplate(content, 'Welcome to RFP2GRANTS - Your account is ready!')
    };
};

// Login Alert Email
exports.getLoginAlertEmail = async (fullName, ipAddress) => {
    const locationInfo = await getLocationFromIP(ipAddress);

    // Get current time & timezone
    const date = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formattedTime = date.toLocaleString('en-US', { timeZone });

    const emailContent = await getEmailContentFromDB('loginAlert');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            ipAddress: ipAddress || 'Unknown',
            locationInfo: locationInfo,
            formattedTime: formattedTime,
            timeZone: timeZone,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">New Sign-In Detected 🔐</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">
            We detected a sign-in to your account from a new device or location. If this was you, no action is required.
        </p>

        <div style="${styles.highlightBox}">
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Sign-in Time</div>
                <div style="${styles.infoValue}">${formattedTime} (${timeZone})</div>
            </div>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">IP Address</div>
                <div style="${styles.infoValue}">${ipAddress || 'Unknown'}</div>
            </div>
            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Location</div>
                <div style="${styles.infoValue}">${locationInfo}</div>
            </div>
        </div>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">⚠️ <strong>Didn't sign in?</strong> Secure your account immediately by changing your password.</p>
        </div>

        <div style="text-align:center; margin-top:10px;">
            <a href="${process.env.FRONTEND_URL || '#'}\/forgot-password" style="${styles.btnPrimary}">Secure My Account</a>
            <span style="display:inline-block; width:10px;"></span>
            <a href="${process.env.FRONTEND_URL || '#'}\/login" style="${styles.btnSecondary}">Login to Your Account</a>
        </div>
    `;

    return {
        subject: 'New sign-in detected on your account',
        body: getBaseTemplate(content, 'New sign-in detected on your account')
    };
};

// OTP Email Template
exports.getOTPEmail = async (fullName, otp, purpose = 'password reset') => {
    const emailContent = await getEmailContentFromDB('otp');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            otp: otp,
            purpose: purpose
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Verification Code</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">You requested a verification code for ${purpose}. Use the code below to proceed:</p>

        <div style="${styles.otpCode}">${otp}</div>

        <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px;">
            This code will expire in <strong style="color:#DC2626;">10 minutes</strong>
        </p>

        <div style="${styles.divider}"></div>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">🛡️ <strong>Security Tip:</strong> Never share this code with anyone. Our team will never ask for your verification code.</p>
        </div>

        <p style="${styles.message}">If you didn't request this code, you can safely ignore this email.</p>
    `;

    return {
        subject: `Your verification code: ${otp}`,
        body: getBaseTemplate(content, `Your verification code: ${otp}`)
    };
};

// Password Reset Success Email
exports.getPasswordResetSuccessEmail = async (fullName) => {
    const emailContent = await getEmailContentFromDB('passwordResetSuccess');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Password Updated Successfully ✓</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">✅ Your password has been successfully changed. Your account is now secured with your new password.</p>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/login" style="${styles.btnPrimary}">Login with New Password</a>
        </div>

        <div style="${styles.divider}"></div>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">⚠️ <strong>Didn't make this change?</strong> Reset your password immediately and contact our support team.</p>
        </div>

        <div style="text-align:center; margin-top:20px;">
            <a href="${process.env.FRONTEND_URL || '#'}\/forgot-password" style="${styles.btnSecondary}">Reset Password Again</a>
        </div>
    `;

    return {
        subject: 'Your password has been successfully updated',
        body: getBaseTemplate(content, 'Your password has been successfully updated')
    };
};

// Email Verification Code Template
exports.getEmailVerificationEmail = async (verificationCode) => {
    const emailContent = await getEmailContentFromDB('emailVerification');

    if (emailContent) {
        const replacements = {
            verificationCode: verificationCode
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Verify Your Email Address</div>

        <p style="${styles.message}">Hello!</p>

        <p style="${styles.message}">Thank you for signing up with RFP2GRANTS. To complete your registration, please verify your email address using the code below:</p>

        <div style="${styles.otpCode}">${verificationCode}</div>

        <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px;">
            This code will expire in <strong style="color:#DC2626;">10 minutes</strong>
        </p>

        <div style="${styles.divider}"></div>

        <p style="${styles.message}">Once verified, you'll be able to complete your profile setup and start using the platform.</p>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">If you didn't create an account with RFP2GRANTS, you can safely ignore this email.</p>
        </div>
    `;

    return {
        subject: `Verify your email - Code: ${verificationCode}`,
        body: getBaseTemplate(content, `Verify your email - Code: ${verificationCode}`)
    };
};

// Employee Welcome Email Template
exports.getEmployeeWelcomeEmail = async (name, email, password, companyName) => {
    const emailContent = await getEmailContentFromDB('employeeWelcome');

    if (emailContent) {
        const replacements = {
            name: name,
            email: email,
            password: password,
            companyName: companyName,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Welcome to ${companyName}! 👋</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${name}</strong>,</p>

        <p style="${styles.message}">An account has been created for you to collaborate on ${companyName}'s RFP2GRANTS workspace. Use the credentials below to get started:</p>

        <div style="${styles.highlightBox}">
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Email</div>
                <div style="${styles.infoValue}">${email}</div>
            </div>
            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Temporary Password</div>
                <div style="${styles.infoValue}">
                    <span style="font-family: 'Courier New', monospace; background-color:#F1F5F9; padding:8px; border-radius:4px; display:inline-block;">${password}</span>
                </div>
            </div>
        </div>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">🔒 <strong>Important:</strong> Please change your password after your first login for security purposes.</p>
        </div>

        <div style="text-align:center;">
            <a href="${process.env.FRONTEND_URL || '#'}\/login" style="${styles.btnPrimary}">Login Now →</a>
            <span style="display:inline-block; width:10px;"></span>
            <a href="${process.env.FRONTEND_URL || '#'}\/forgot-password" style="${styles.btnSecondary}">Reset Password</a>
        </div>
    `;

    return {
        subject: `Welcome to ${companyName} on RFP2GRANTS`,
        body: getBaseTemplate(content, `Welcome to ${companyName} on RFP2GRANTS`)
    };
};

// Payment Success Email Template
exports.getPaymentSuccessEmail = async (fullName, planName, amount, billingCycle, startDate, endDate) => {
    const emailContent = await getEmailContentFromDB('paymentSuccess');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            planName: planName,
            amount: amount.toFixed(2),
            billingCycle: billingCycle === 'yearly' ? 'Yearly' : 'Monthly',
            startDate: new Date(startDate).toLocaleDateString(),
            endDate: new Date(endDate).toLocaleDateString(),
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Payment Successful! 🎉</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">✅ Your payment has been successfully processed. Your <strong style="color:#0f172a;">${planName}</strong> subscription is now active!</p>
        </div>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📋 Subscription Details</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan</div>
                <div style="${styles.infoValue}">${planName}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Amount Paid</div>
                <div style="${styles.infoValue}""><span style="color:#15803D;">$${amount.toFixed(2)}</span></div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Billing Cycle</div>
                <div style="${styles.infoValue}">${billingCycle === 'yearly' ? 'Yearly' : 'Monthly'}</div>
            </div>

            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Subscription Period</div>
                <div style="${styles.infoValue}">${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}</div>
            </div>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/dashboard" style="${styles.btnPrimary}">Go to Dashboard →</a>
        </div>

        <p style="${styles.message}">Start exploring all the premium features available with your new subscription!</p>
    `;

    return {
        subject: `Payment Successful - ${planName} Plan Activated`,
        body: getBaseTemplate(content, `Payment Successful - ${planName} Plan Activated`)
    };
};

// Refund Notification Email Template
exports.getRefundNotificationEmail = async (fullName, planName, refundId, errorMessage) => {
    const emailContent = await getEmailContentFromDB('refundNotification');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            planName: planName,
            refundId: refundId,
            errorMessage: errorMessage,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Payment Refunded</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">We encountered a technical issue while processing your subscription for the <strong style="color:#0f172a;">${planName}</strong> plan. As a result, we have automatically refunded your payment.</p>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">💳 Refund Details</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan</div>
                <div style="${styles.infoValue}">${planName}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Refund ID</div>
                <div style="${styles.infoValue}"><span style="font-family:'Courier New', monospace; font-size:14px;">${refundId}</span></div>
            </div>

            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Status</div>
                <div style="${styles.infoValue}"><span style="color:#DC2626;">Refunded to original payment method</span></div>
            </div>
        </div>

        <div style="${styles.warningBox}">
            <p style="margin:0;"><strong>What happened?</strong><br>${errorMessage}</p>
        </div>

        <p style="${styles.message}"><strong>Next Steps:</strong></p>

        <ul style="margin:12px 0 0 20px; color:#475569;">
            <li style="margin:8px 0;">Your refund will appear in your account within 5-10 business days</li>
            <li style="margin:8px 0;">You can try subscribing again once the issue is resolved</li>
            <li style="margin:8px 0;">Contact our support team if you have any questions</li>
        </ul>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/contact" style="${styles.btnPrimary}">Contact Support</a>
        </div>

        <p style="${styles.message}">We apologize for any inconvenience caused.</p>
    `;

    return {
        subject: `Payment Refunded - ${planName} Plan`,
        body: getBaseTemplate(content, `Payment Refunded - ${planName} Plan`)
    };
};

// Password Changed Notification Template
exports.getPasswordChangedEmail = async (fullName) => {
    const emailContent = await getEmailContentFromDB('passwordChanged');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            timestamp: new Date().toLocaleString(),
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Password Changed Successfully</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">✅ Your account password has been successfully changed at ${new Date().toLocaleString()}.</p>
        </div>

        <div style="${styles.warningBox}">
            <p style="margin:0; color:#991b1b;">⚠️ <strong>Didn't make this change?</strong><br>If you did not authorize this password change, please reset your password immediately and contact our support team.</p>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/forgot-password" style="${styles.btnPrimary}">Reset Password</a>
        </div>

        <div style="${styles.divider}"></div>

        <p style="${styles.message}">For your security, we recommend:</p>

        <ul style="margin:12px 0 0 20px; color:#475569;">
            <li style="margin:8px 0;">Using a unique password for your RFP2GRANTS account</li>
            <li style="margin:8px 0;">Enabling two-factor authentication when available</li>
            <li style="margin:8px 0;">Never sharing your password with anyone</li>
        </ul>
    `;

    return {
        subject: 'Your password has been changed',
        body: getBaseTemplate(content, 'Your password has been changed')
    };
};

// Enterprise Plan Email Template
exports.getEnterprisePlanEmail = async (fullName, email, price, planType, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, checkoutUrl) => {
    const emailContent = await getEmailContentFromDB('enterprisePlan');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            email: email,
            price: price,
            planType: planType,
            maxEditors: maxEditors,
            maxViewers: maxViewers,
            maxRFPProposalGenerations: maxRFPProposalGenerations,
            maxGrantProposalGenerations: maxGrantProposalGenerations,
            checkoutUrl: checkoutUrl || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Your Enterprise Plan is Ready! 🚀</div>

        <p style="${styles.message}">Hello <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">Your custom enterprise plan has been created with features tailored specifically for your organization. Review the details below and complete your payment to activate your subscription.</p>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📦 Plan Details</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Price</div>
                <div style="${styles.infoValue}"><span style="color:#15803D;">$${price}</span></div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan Type</div>
                <div style="${styles.infoValue}">${planType}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Editors</div>
                <div style="${styles.infoValue}">${maxEditors}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Viewers</div>
                <div style="${styles.infoValue}">${maxViewers}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max RFP Proposal Generations</div>
                <div style="${styles.infoValue}">${maxRFPProposalGenerations}</div>
            </div>

            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Max Grant Proposal Generations</div>
                <div style="${styles.infoValue}">${maxGrantProposalGenerations}</div>
            </div>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${checkoutUrl || '#'}" style="${styles.btnPrimary}">Complete Payment Securely →</a>
        </div>

        <p style="text-align:center; color:#64748b; font-size:14px;">🔒 All payments are processed securely through Stripe</p>
    `;

    return {
        subject: 'Your Enterprise Plan Payment Link - RFP2GRANTS',
        body: getBaseTemplate(content, `Your Enterprise Plan Payment Link - RFP2GRANTS`)
    };
};

// Enterprise Payment Success Template
exports.getEnterprisePaymentSuccessEmail = async (fullName, planType, price, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations) => {
    const emailContent = await getEmailContentFromDB('enterprisePaymentSuccess');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            planType: planType,
            price: price,
            maxEditors: maxEditors,
            maxViewers: maxViewers,
            maxRFPProposalGenerations: maxRFPProposalGenerations,
            maxGrantProposalGenerations: maxGrantProposalGenerations,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Enterprise Plan Activated! 🎉</div>

        <p style="${styles.message}">Hello <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">🎊 Your payment for the custom Enterprise Plan was successful! Your account has been upgraded with all premium features.</p>
        </div>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📦 Your Active Plan</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan Type</div>
                <div style="${styles.infoValue}">${planType}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Price</div>
                <div style="${styles.infoValue}"><span style="color:#15803D;">$${price}</span></div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Editors</div>
                <div style="${styles.infoValue}">${maxEditors} team members</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Viewers</div>
                <div style="${styles.infoValue}">${maxViewers} team members</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">RFP Proposal Generations</div>
                <div style="${styles.infoValue}">${maxRFPProposalGenerations} per cycle</div>
            </div>

            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Grant Proposal Generations</div>
                <div style="${styles.infoValue}">${maxGrantProposalGenerations} per cycle</div>
            </div>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/dashboard" style="${styles.btnPrimary}">Access Your Dashboard →</a>
        </div>

        <p style="${styles.message}">Thank you for choosing RFP2GRANTS Enterprise. Our team is here to support your success!</p>
    `;

    return {
        subject: 'Enterprise Plan Payment Successful',
        body: getBaseTemplate(content, 'Enterprise Plan Payment Successful')
    };
};

// Enterprise Payment Failed Template
exports.getEnterprisePaymentFailedEmail = async (fullName) => {
    const emailContent = await getEmailContentFromDB('enterprisePaymentFailed');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Payment Issue Detected</div>

        <p style="${styles.message}">Hello <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">We were unable to process your payment for the custom Enterprise Plan. This can happen for several reasons:</p>

        <ul style="margin:12px 0 0 20px; color:#475569;">
            <li style="margin:8px 0;">Insufficient funds in your account</li>
            <li style="margin:8px 0;">Payment method declined by your bank</li>
            <li style="margin:8px 0;">Network connectivity issues during checkout</li>
            <li style="margin:8px 0;">Payment details entered incorrectly</li>
        </ul>

        <div style="${styles.warningBox}">
            <p style="margin:0;">Don't worry! You can try again or contact our support team for assistance.</p>
        </div>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/pricing" style="${styles.btnPrimary}">Try Again</a>
            <span style="display:inline-block; width:10px;"></span>
            <a href="${process.env.FRONTEND_URL || '#'}\/contact" style="${styles.btnSecondary}">Contact Support</a>
        </div>
    `;

    return {
        subject: 'Enterprise Plan Payment Failed',
        body: getBaseTemplate(content, 'Enterprise Plan Payment Failed')
    };
};

// Contact Form Email Template (for Support Team)
exports.getContactFormEmail = async (name, email, company, description) => {
    const emailContent = await getEmailContentFromDB('contactForm');

    if (emailContent) {
        const replacements = {
            name: name,
            email: email,
            company: company || '',
            description: description
        };
        // Handle conditional company display
        let body = replacePlaceholders(emailContent.body, replacements);
        if (!company) {
            // Remove company section if company is empty
            body = body.replace(/<div[^>]*>.*?Company.*?<\/div>/gis, '');
        }
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">New Contact Request 📬</div>

        <p style="${styles.message}">A new contact request has been submitted through the website contact form.</p>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📋 Contact Details</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Name</div>
                <div style="${styles.infoValue}">${name}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Email Address</div>
                <div style="${styles.infoValue}"><a href="mailto:${email}" style="color:#1E4EDD; text-decoration:none;">${email}</a></div>
            </div>

            ${company ? `
            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Company</div>
                <div style="${styles.infoValue}">${company}</div>
            </div>
            ` : ''}
        </div>

        <div style="${styles.successBox}">
            <p style="margin:0 0 8px 0; color:#15803D; font-weight:600;">📝 Message:</p>
            <p style="margin:0; color:#166534; white-space:pre-wrap; word-break:break-word;">${description}</p>
        </div>

        <div style="${styles.divider}"></div>

        <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 16px;">
            💡 <strong>Quick Action:</strong> Reply directly to <a href="mailto:${email}" style="color:#1E4EDD; text-decoration:none;">${email}</a> to respond to this inquiry
        </p>

        <div style="text-align:center; margin:30px 0;">
            <a href="mailto:${email}" style="${styles.btnPrimary}">Reply to ${name} →</a>
        </div>
    `;

    return {
        subject: `New Contact Request from ${name}`,
        body: getBaseTemplate(content, `New Contact Request from ${name}`)
    };
};

// Subscription Updated Email Template
exports.getSubscriptionUpdatedEmail = async (fullName, subscriptionName, subscriptionType, subscriptionPrice, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, noteFromAdmin) => {
    const emailContent = await getEmailContentFromDB('subscriptionUpdated');
    if (emailContent) {
        const replacements = {
            fullName: fullName,
            subscriptionName: subscriptionName,
            subscriptionType: subscriptionType,
            subscriptionPrice: subscriptionPrice,
            maxEditors: maxEditors,
            maxViewers: maxViewers,
            maxRFPProposalGenerations: maxRFPProposalGenerations,
            maxGrantProposalGenerations: maxGrantProposalGenerations,
            noteFromAdmin: noteFromAdmin,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Subscription Updated! 🎉</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">Your subscription has been updated. Please login to your account to access your subscription.</p>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📋 Subscription Details</p>
        </div>

        <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan</div>
                <div style="${styles.infoValue}">${subscriptionName}</div>
            </div>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Price</div>
                <div style="${styles.infoValue}">$${subscriptionPrice}</div>
            </div>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Editors</div>
                <div style="${styles.infoValue}">${maxEditors}</div>
            </div>
        </div>
        <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Viewers</div>
                <div style="${styles.infoValue}">${maxViewers}</div>
            </div>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max RFP Proposal Generations</div>
                <div style="${styles.infoValue}">${maxRFPProposalGenerations}</div>
            </div>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Grant Proposal Generations</div>
                <div style="${styles.infoValue}">${maxGrantProposalGenerations}</div>
            </div>
        </div>

        ${noteFromAdmin && (
            `
                <div style="${styles.divider}"></div>
                <p style="${styles.message}">Note From Admin:</p>
                <p style="${styles.message}">${noteFromAdmin}</p>
                <div style="${styles.divider}"></div>
            `
        )}


        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/dashboard" style="${styles.btnPrimary}">Go to Dashboard →</a>
        </div>

        <p style="${styles.message}">Start exploring all the premium features available with your new subscription!</p>

        <p style="${styles.message}">Thank you for choosing RFP2GRANTS. Our team is here to support your success!</p>

        <p style="${styles.message}">Best regards,</p>
        <p style="${styles.message}">RFP2GRANTS Team</p>
    `;

    return {
        subject: 'Subscription Updated!',
        body: getBaseTemplate(content, 'Subscription Updated!')
    };
};

// Subscription Assigned Email Template
exports.getSubscriptionActivatedEmail = async (fullName, subscriptionName, subscriptionType, subscriptionPrice, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, noteFromAdmin) => {
    const emailContent = await getEmailContentFromDB('subscriptionAssigned');

    if (emailContent) {
        const replacements = {
            fullName: fullName,
            subscriptionName: subscriptionName,
            subscriptionType: subscriptionType,
            subscriptionPrice: subscriptionPrice,
            maxEditors: maxEditors,
            maxViewers: maxViewers,
            maxRFPProposalGenerations: maxRFPProposalGenerations,
            maxGrantProposalGenerations: maxGrantProposalGenerations,
            noteFromAdmin: noteFromAdmin,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Subscription Assigned to You! 🎉</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">A subscription has been assigned to you. Please login to your account to access your subscription.</p>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📋 Subscription Details</p>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Plan</div>
                <div style="${styles.infoValue}">${subscriptionName}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Price</div>
                <div style="${styles.infoValue}">$${subscriptionPrice}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Editors</div>
                <div style="${styles.infoValue}">${maxEditors}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Viewers</div>
                <div style="${styles.infoValue}">${maxViewers}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max RFP Proposal Generations</div>
                <div style="${styles.infoValue}">${maxRFPProposalGenerations}</div>
            </div>

            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Max Grant Proposal Generations</div>
                <div style="${styles.infoValue}">${maxGrantProposalGenerations}</div>
            </div>
        </div>

        ${noteFromAdmin && (
            `
                <div style="${styles.divider}"></div>
                <p style="${styles.message}">Note From Admin:</p>
                <p style="${styles.message}">${noteFromAdmin}</p>
                <div style="${styles.divider}"></div>
            `
        )}

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/dashboard" style="${styles.btnPrimary}">Go to Dashboard →</a>
        </div>

        <p style="${styles.message}">Start exploring all the premium features available with your new subscription!</p>
    `;

    return {
        subject: 'Subscription Assigned to You!',
        body: getBaseTemplate(content, 'Subscription Assigned to You!')
    };
};

// Subscription Deactivated Email Template
exports.getSubscriptionDeactivatedEmail = async (fullName, email, noteFromAdmin) => {
    const emailContent = await getEmailContentFromDB('userSubscriptionDeactivated');
    if (emailContent) {
        const replacements = {
            fullName: fullName,
            email: email,
            noteFromAdmin: noteFromAdmin,
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">User Subscription Deactivated! ⚠️</div>

        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>

        <p style="${styles.message}">Your subscription has been deactivated. Please purchase a new subscription from our website.</p>

        ${noteFromAdmin && (
            `
                <div style="${styles.divider}"></div>
                <p style="${styles.message}">Note From Admin:</p>
                <p style="${styles.message}">${noteFromAdmin}</p>
                <div style="${styles.divider}"></div>
            `
        )}

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/login" style="${styles.btnPrimary}">Go to Login →</a>
        </div>
    `;

    return {
        subject: 'User Subscription Deactivated!',
        body: getBaseTemplate(content, 'User Subscription Deactivated!')
    };
};

// Add-on Activated Email Template
exports.getAddOnActivatedEmail = async (fullName, addOnName, addOnPrice) => {
    const emailContent = await getEmailContentFromDB('addOnActivated');
    if (emailContent) {
        const replacements = {
            fullName: fullName,
            addOnName: addOnName,
            addOnPrice: addOnPrice,
            frontendUrl: process.env.FRONTEND_URL || '#'
        };
        const body = replacePlaceholders(emailContent.body, replacements);
        const subject = replacePlaceholders(emailContent.subject, replacements);
        return { subject, body };
    }

    // Fallback to original template
    const content = `
        <div style="${styles.greeting}">Add-on Activated! 🎉</div>
        <p style="${styles.message}">Hi <strong style="color:#0f172a;">${fullName}</strong>,</p>
        
        <div style="${styles.successBox}">
            <p style="margin:0; color:#15803D; font-weight:600;">✅ Your add-on "<strong style="color:#0f172a;">${addOnName}</strong>" has been successfully activated!</p>
        </div>

        <div style="${styles.highlightBox}">
            <p style="margin:0 0 16px 0; color:#1E40AF; font-weight:600; font-size:18px;">📦 Add-on Details</p>
            <div style="${styles.infoItem}">
                <div style="${styles.infoLabel}">Add-on Name</div>
                <div style="${styles.infoValue}">${addOnName}</div>
            </div>
            <div style="padding:10px 0;">
                <div style="${styles.infoLabel}">Price</div>
                <div style="${styles.infoValue}"><span style="color:#15803D;">$${addOnPrice}</span></div>
            </div>
        </div>

        <p style="${styles.message}">You can now access all the features included with this add-on. Login to your account to get started!</p>

        <div style="text-align:center; margin:30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}\/dashboard" style="${styles.btnPrimary}">Go to Dashboard →</a>
        </div>

        <p style="${styles.message}">Thank you for choosing RFP2GRANTS!</p>
    `;

    return {
        subject: 'Add-on Activated!',
        body: getBaseTemplate(content, 'Add-on Activated!')
    };
};