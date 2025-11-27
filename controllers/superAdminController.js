const mongoose = require('mongoose');
const Proposal = require("../models/Proposal");
const CompanyProfile = require("../models/CompanyProfile");
const Notification = require("../models/Notification");
const Support = require("../models/Support");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Payment = require("../models/Payments");
const Subscription = require("../models/Subscription");
const nodemailer = require('nodemailer');
const User = require("../models/User");
const CustomPlan = require("../models/CustomPlan");
const PaymentDetails = require("../models/PaymentDetails");
const Contact = require("../models/Contact");
const GrantProposal = require("../models/GrantProposal");
const EmployeeProfile = require("../models/EmployeeProfile");
const emailTemplates = require("../utils/emailTemplates");
const EmailContent = require("../models/EmailContent");
const AddOnPlan = require("../models/AddOnPlan");

const { queueEmail } = require("../utils/mailSender");

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Merged Company Stats and Company Data API
exports.getCompanyStatsAndData = async (req, res) => {
  try {
    // Parallelize independent count queries
    const [totalCompanies, proposalCount, grantProposalCount, activeUsers, inactiveUsers] = await Promise.all([
      CompanyProfile.countDocuments(),
      Proposal.countDocuments(),
      GrantProposal.countDocuments(),
      User.countDocuments({ subscription_status: "active", role: "company" }),
      User.countDocuments({ subscription_status: "inactive", role: "company" })
    ]);

    const totalProposals = proposalCount + grantProposalCount;

    // Use aggregation pipeline to get companies with latest subscription plan_name
    // This replaces multiple queries and manual mapping with a single database operation
    const companies = await CompanyProfile.aggregate([
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'userId',
          foreignField: 'user_id',
          as: 'subscriptions'
        }
      },
      {
        $addFields: {
          latestSubscription: {
            $arrayElemAt: [
              {
                $slice: [
                  {
                    $sortArray: {
                      input: '$subscriptions',
                      sortBy: { end_date: -1 }
                    }
                  },
                  1
                ]
              },
              0
            ]
          }
        }
      },
      {
        $addFields: {
          plan_name: { $ifNull: ['$latestSubscription.plan_name', null] }
        }
      },
      {
        $project: {
          subscriptions: 0,
          latestSubscription: 0
        }
      }
    ]);

    res.json({
      stats: {
        "Total Proposals": totalProposals,
        "Total Users": totalCompanies,
        "Active Users": activeUsers,
        "Inactive Users": inactiveUsers
      },
      CompanyData: companies
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching company stats and data", error: err.message });
  }
};

// Update Company Status
exports.updateCompanyStatus = async (req, res) => {
  try {
    const id = req.params.id;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: "company ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid company ID format" });
    }

    const blocked = req.body.blocked === "Blocked" ? true : false;
    const updatedCompany = await CompanyProfile.findByIdAndUpdate(
      id,
      { $set: { blocked } },
      { new: true, runValidators: true }
    );

    if (!updatedCompany) {
      return res.status(404).json({ message: "Company not found" });
    }

    res.json(updatedCompany);
  } catch (err) {
    console.error('Error updating company status:', err);
    res.status(500).json({ message: "Error updating company status", error: err.message });
  }
};


// Get Notification Data
exports.getNotificationData = async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: "Error fetching notification data", error: err.message });
  }
};


// Controller to get support ticket type counts and all support tickets in one API call
exports.getSupportStatsAndData = async (req, res) => {
  try {
    // Fetch all support tickets
    const supportTickets = await Support.find();

    // Extract unique user IDs
    const supportUserIds = supportTickets
      .map(ticket => ticket.userId)
      .filter(id => !!id); // ignore null/undefined

    const supportUniqueUserIds = [...new Set(supportUserIds.map(id => id.toString()))];

    // Parallelize independent queries
    let companiesMap = {};
    let userMap = {};
    let employeeMap = {};
    let companyEmailMap = {};

    if (supportUniqueUserIds.length > 0) {
      // Get unique company emails from employee profiles first (needed for parallel query)
      const employeeProfilesTemp = await EmployeeProfile.find({ userId: { $in: supportUniqueUserIds } }).lean();
      const companyEmails = employeeProfilesTemp.map(emp => emp.companyMail).filter(email => email);
      const uniqueCompanyEmails = [...new Set(companyEmails)];

      // Parallelize all independent queries
      const [companies, users, employeeProfiles, companyProfiles] = await Promise.all([
        CompanyProfile.find(
          { _id: { $in: supportUniqueUserIds } },
          { companyName: 1, logoUrl: 1 }
        ).lean(),
        User.find({ _id: { $in: supportUniqueUserIds } }).lean(),
        EmployeeProfile.find({ userId: { $in: supportUniqueUserIds } }).lean(),
        CompanyProfile.find({ email: { $in: uniqueCompanyEmails } }).lean()
      ]);

      companiesMap = companies.reduce((acc, company) => {
        acc[company._id.toString()] = {
          companyName: company.companyName,
          logoUrl: company.logoUrl || null,
        };
        return acc;
      }, {});

      userMap = users.reduce((acc, user) => {
        acc[user._id.toString()] = user;
        return acc;
      }, {});

      employeeMap = employeeProfiles.reduce((acc, emp) => {
        acc[emp.userId.toString()] = emp;
        return acc;
      }, {});

      companyEmailMap = companyProfiles.reduce((acc, company) => {
        acc[company.email] = company;
        return acc;
      }, {});
    }

    // Add companyName and logoUrl to tickets
    const supportWithCompany = supportTickets.map((ticket) => {
      let companyData = { companyName: "Unknown Company", logoUrl: null };

      const user = userMap[ticket.userId?.toString()];
      if (user && user.role === "employee") {
        const employeeProfile = employeeMap[ticket.userId?.toString()];
        if (employeeProfile) {
          const companyProfile = companyEmailMap[employeeProfile.companyMail];
          if (companyProfile) {
            companyData.companyName = companyProfile.companyName || "Unknown Company";
            companyData.logoUrl = companyProfile.logoUrl || null;
          }
        }
      } else {
        const companyInfo = companiesMap[ticket.userId?.toString()];
        companyData.companyName = companyInfo ? companyInfo.companyName : "Unknown Company";
        companyData.logoUrl = companyInfo ? companyInfo.logoUrl : null;
      }

      return {
        ...ticket.toObject(),
        companyName: companyData.companyName,
        logoUrl: companyData.logoUrl,
        status: ticket.status === "Created" && !ticket.isOpen ? "Pending" : ticket.isOpen && (ticket.status !== "In Progress" && ticket.status !== "Completed" && ticket.status !== "Withdrawn") ? "Re-Opened" : ticket.status
      };
    });

    // Filter the tickets into three categories: Completed, Enterprise, and Other
    const completedTickets = supportWithCompany.filter(ticket => ticket.status === "Completed");
    const enterpriseTickets = supportWithCompany.filter(ticket => (ticket.plan_name === "Enterprise" || ticket.plan_name === "Custom Enterprise Plan") && ticket.status !== "Completed");
    const otherTickets = supportWithCompany.filter(ticket => ticket.plan_name !== "Enterprise" && ticket.plan_name !== "Custom Enterprise Plan" && ticket.status !== "Completed");

    // Use aggregation to count categories instead of manual loops
    const categoryCounts = (tickets) => {
      const counts = tickets.reduce((acc, ticket) => {
        const category = ticket.category || "Others";
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});

      return {
        "Billing & Payments": counts["Billing & Payments"] || 0,
        "Proposal Issues": counts["Proposal Issues"] || 0,
        "Account & Access": counts["Account & Access"] || 0,
        "Technical Errors": counts["Technical Errors"] || 0,
        "Feature Requests": counts["Feature Requests"] || 0,
        "Others": Object.keys(counts).filter(k => !["Billing & Payments", "Proposal Issues", "Account & Access", "Technical Errors", "Feature Requests"].includes(k))
          .reduce((sum, k) => sum + (counts[k] || 0), 0) + (counts["Others"] || 0)
      };
    };

    const TicketStats = categoryCounts(otherTickets);
    const TicketStatsCompleted = categoryCounts(completedTickets);
    const TicketStatsEnterprise = categoryCounts(enterpriseTickets);

    res.json({
      TicketStats,
      TicketStatsCompleted,
      TicketStatsEnterprise,
      supportTicketsData: otherTickets,
      enterpriseTicketsData: enterpriseTickets,
      completedTicketsData: completedTickets
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching support stats and data",
      error: err.message,
    });
  }
};

// Controller to update (edit) a support ticket according to Support.js schema
exports.updateSupportTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: "Support ticket ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid support ticket ID format" });
    }

    // Accept all updatable fields as per Support.js schema
    const { status } = req.body;
    const { Resolved_Description } = req.body || "";

    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }

    const updatedSupport = await Support.findByIdAndUpdate(
      id,
      { $set: { status, Resolved_Description } },
      { new: true }
    );

    if (!updatedSupport) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    res.json(updatedSupport);
  } catch (err) {
    res.status(500).json({ message: "Error updating support ticket", error: err.message });
  }
};

// Add Admin Message
exports.addAdminMessage = async (req, res) => {
  try {
    const id = req.params.id;
    const { newAdminMessage } = req.body;
    const updatedSupport = await Support.findByIdAndUpdate(
      id,
      { $push: { adminMessages: { message: newAdminMessage, createdAt: new Date() } } },
      { new: true }
    );
    res.json(updatedSupport);
  } catch (err) {
    res.status(500).json({ message: "Error adding admin message", error: err.message });
  }
};

// Get Payment Summary and Payment Data
exports.getPaymentsSummaryAndData = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Use aggregation pipeline to join payments with related data and calculate stats
    // This replaces multiple queries and manual mapping with efficient database operations
    const [paymentsWithCompanyName, revenueStats, activeUsers, inactiveUsers] = await Promise.all([
      Payment.aggregate([
        // Lookup company profile via user_id
        {
          $lookup: {
            from: 'companyprofiles',
            localField: 'user_id',
            foreignField: 'userId',
            as: 'company'
          }
        },
        // Lookup subscription to get plan_name and user_id for email
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'subscription_id',
            foreignField: '_id',
            as: 'subscription'
          }
        },
        // Lookup user email via subscription's user_id
        {
          $lookup: {
            from: 'users',
            let: { userId: { $ifNull: [{ $arrayElemAt: ['$subscription.user_id', 0] }, null] } },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
              { $project: { email: 1 } }
            ],
            as: 'user'
          }
        },
        // Add computed fields
        {
          $addFields: {
            companyName: {
              $ifNull: [
                { $arrayElemAt: ['$company.companyName', 0] },
                'Unknown Company'
              ]
            },
            planName: {
              $ifNull: [
                { $arrayElemAt: ['$subscription.plan_name', 0] },
                'Unknown Plan'
              ]
            },
            email: {
              $ifNull: [
                { $arrayElemAt: ['$user.email', 0] },
                'Unknown Email'
              ]
            }
          }
        },
        // Remove temporary lookup arrays
        {
          $project: {
            company: 0,
            subscription: 0,
            user: 0
          }
        },
        // Sort by creation date (most recent first)
        {
          $sort: { createdAt: -1 }
        }
      ]),
      // Calculate revenue stats
      Payment.aggregate([
        { $match: { status: 'Success' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$price' },
            revenueThisMonth: {
              $sum: {
                $cond: [
                  { $and: [{ $gte: ['$paid_at', startOfMonth] }, { $lt: ['$paid_at', now] }] },
                  '$price',
                  0
                ]
              }
            }
          }
        }
      ]),
      User.countDocuments({ subscription_status: "active", role: "company" }),
      User.countDocuments({ subscription_status: "inactive", role: "company" })
    ]);

    const totalRevenue = revenueStats.length > 0 ? revenueStats[0].totalRevenue || 0 : 0;
    const revenueThisMonth = revenueStats.length > 0 ? revenueStats[0].revenueThisMonth || 0 : 0;

    res.json({
      PaymentStats: {
        "Total Revenue": `${totalRevenue}`,
        "Active Subscriptions": `${activeUsers}`,
        "Inactive Subscriptions": `${inactiveUsers}`,
        "Revenue This Month": `${revenueThisMonth}`
      },
      PaymentData: paymentsWithCompanyName
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching payment summary and data",
      error: err.message
    });
  }
};

// Get Subscription Plans Data
exports.getSubscriptionPlansData = async (req, res) => {
  try {
    const subscriptionPlans = await SubscriptionPlan.find();
    // Find the most popular plan by counting subscriptions per plan_id
    const planCounts = await Subscription.aggregate([
      { $group: { _id: "$plan_name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    let mostPopularPlanName = null;

    if (planCounts.length > 0) {
      mostPopularPlanName = planCounts[0]._id;
    }

    // Send response with all plans and most popular plan
    res.json({
      plans: subscriptionPlans,
      mostPopularPlan: mostPopularPlanName
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching subscription plans data",
      error: err.message
    });
  }
};


// Controller to update the price of a subscription plan
exports.updateSubscriptionPlanPrice = async (req, res) => {
  try {
    const id = req.params.id;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: "Subscription plan ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid subscription plan ID format" });
    }

    const { monthlyPrice, yearlyPrice, maxRFPProposalGenerations, maxGrantProposalGenerations } = req.body;

    const existingSubscriptionPlan = await SubscriptionPlan.findById(id);

    if (!existingSubscriptionPlan) {
      return res.status(404).json({ message: "Subscription plan not found" });
    }

    //if "enterprise" plan is being updated, then update only the price, maxRFPProposalGenerations, maxGrantProposalGenerations
    if (existingSubscriptionPlan.name === "Enterprise") {
      const updatedSubscriptionPlan = await SubscriptionPlan.findByIdAndUpdate(id, { monthlyPrice, yearlyPrice, maxRFPProposalGenerations, maxGrantProposalGenerations }, { new: true });
      res.json(updatedSubscriptionPlan);
    }

    //if "basic" plan is being updated, then update only the price, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, maxMagicBrushUsage

    const { maxEditors, maxViewers, maxMagicBrushUsage } = req.body;
    if (existingSubscriptionPlan.name === "Basic") {
      const updatedSubscriptionPlan = await SubscriptionPlan.findByIdAndUpdate(id, { monthlyPrice, yearlyPrice, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, maxMagicBrushUsage }, { new: true });
      res.json(updatedSubscriptionPlan);
    }

    //if "pro" plan is being updated, then update only the price, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, maxMagicBrushUsage, maxImageGenerationUsage
    const { maxImageGenerationUsage } = req.body;
    if (existingSubscriptionPlan.name === "Pro") {
      const updatedSubscriptionPlan = await SubscriptionPlan.findByIdAndUpdate(id, { monthlyPrice, yearlyPrice, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations, maxMagicBrushUsage, maxImageGenerationUsage }, { new: true });
      res.json(updatedSubscriptionPlan);
    }
  } catch (err) {
    res.status(500).json({ message: "Error updating subscription plan", error: err.message });
  }
};

// Controller to update the isContact of a subscription plan
exports.updateSubscriptionPlanIsContact = async (req, res) => {
  try {
    const id = req.params.id;
    const { isContact } = req.body;
    const updatedSubscriptionPlan = await SubscriptionPlan.findByIdAndUpdate(id, { isContact }, { new: true });
    res.json(updatedSubscriptionPlan);
  } catch (err) {
    res.status(500).json({ message: "Error updating subscription plan isContact", error: err.message });
  }
};

exports.sendEmail = async (req, res) => {
  try {
    const {
      email,
      price,
      planType,
      maxEditors,
      maxViewers,
      maxRFPProposalGenerations,
      maxGrantProposalGenerations
    } = req.body;

    const user = await User.findOne({ email });
    if (!user || user.role !== "company") {
      return res.status(404).json({ message: "User not found or user is not a company" });
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    let customPlan;
    let stripeSession;

    try {
      // Delete any existing custom plans for this email
      await CustomPlan.deleteMany({ email }, { session });

      customPlan = new CustomPlan({
        userId: user._id,
        email,
        price,
        planType,
        maxEditors,
        maxViewers,
        maxRFPProposalGenerations,
        maxGrantProposalGenerations,
        status: 'payment_link_generated'  // Track initial status
      });
      await customPlan.save({ session });

      // Ensure Stripe customer exists
      let stripeCustomerId = user.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email
        });
        stripeCustomerId = customer.id;
        user.stripeCustomerId = stripeCustomerId;
        await user.save({ session });
      }

      // Create Stripe Checkout Session
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: email,
        metadata: {
          maxEditors,
          maxViewers,
          maxRFPProposalGenerations,
          maxGrantProposalGenerations,
          planType
        },
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Custom Enterprise Plan (${planType})`
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/enterprise-success?customPlanId=${customPlan._id}`,
        cancel_url: `${process.env.FRONTEND_URL}/enterprise-cancelled`,
      });

      customPlan.stripeCheckoutSessionId = stripeSession.id;
      customPlan.checkoutUrl = stripeSession.url;
      await customPlan.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // Send payment link via email
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const { subject, body } = await emailTemplates.getEnterprisePlanEmail(
      user.fullName || '',
      email,
      price,
      planType,
      maxEditors,
      maxViewers,
      maxRFPProposalGenerations,
      maxGrantProposalGenerations,
      stripeSession.url
    );

    // Queue enterprise plan email (payment-related, priority 1)
    queueEmail(email, subject, body, 'enterprisePlan');

    res.status(200).json({
      message: 'Custom enterprise plan created and email sent successfully',
      checkoutUrl: stripeSession.url
    });

  } catch (error) {
    console.error('Error in sendEmail controller:', error);
    res.status(500).json({ message: error.message });
  }
};

//Fetch the subscriptions of all users
exports.getSubscriptionsOfAllUsers = async (req, res) => {
  try {
    // Use aggregation pipeline to join subscriptions with users and company profiles
    // This replaces N+1 queries with a single efficient database operation
    const userSubscriptions = await Subscription.aggregate([
      // Filter out subscriptions without user_id
      { $match: { user_id: { $ne: null } } },
      // Lookup user information
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      // Filter out subscriptions where user doesn't exist
      { $match: { 'user.0': { $exists: true } } },
      // Lookup company profile via user_id
      {
        $lookup: {
          from: 'companyprofiles',
          localField: 'user_id',
          foreignField: 'userId',
          as: 'companyProfile'
        }
      },
      // Filter out subscriptions where company profile doesn't exist
      { $match: { 'companyProfile.0': { $exists: true } } },
      // Add computed fields
      {
        $addFields: {
          userName: { $arrayElemAt: ['$user.fullName', 0] },
          userEmail: { $arrayElemAt: ['$user.email', 0] },
          companyName: { $arrayElemAt: ['$companyProfile.companyName', 0] }
        }
      },
      // Remove temporary lookup arrays
      {
        $project: {
          user: 0,
          companyProfile: 0
        }
      },
      // Sort by creation date (most recent first)
      {
        $sort: { createdAt: -1 }
      }
    ]);

    res.status(200).json(userSubscriptions);
  } catch (err) {
    res.status(500).json({ message: "Error fetching subscriptions of all users", error: err.message });
  }
};

// Get Custom Plan Data
exports.getCustomPlanData = async (req, res) => {
  const customPlans = await CustomPlan.find();

  // For each custom plan, fetch the corresponding companyName from CompanyProfile using the email
  const customPlansWithCompanyName = await Promise.all(
    customPlans.map(async (plan) => {
      const companyProfile = await CompanyProfile.findOne({ email: plan.email });
      return {
        ...plan.toObject(),
        companyName: companyProfile ? companyProfile.companyName : null,
      };
    })
  );
  res.json(customPlansWithCompanyName);
};

exports.editCustomPlan = async (req, res) => {
  const { id } = req.params;

  const { price, planType, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations } = req.body;

  const customPlan = await CustomPlan.findByIdAndUpdate(id, { price, planType, maxEditors, maxViewers, maxRFPProposalGenerations, maxGrantProposalGenerations }, { new: true });

  let AdminPaymenyData = {};

  const paymentDetails = await PaymentDetails.find();

  if (!paymentDetails) {
    AdminPaymenyData = {
      upi_id: null,
      account_holder_name: null,
      account_number: null,
      ifsc_code: null,
      bank_name: null,
      branch_name: null,
      bank_address: null,
      is_primary: false,
    };
  }
  else {
    AdminPaymenyData = paymentDetails[0];
  }

  const emailSubject = `RFP2GRANTS - Enterprise Subscription Plan Request`;
  const emailBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <h2 style="color: #2563EB;">RFP2GRANTS - Enterprise Subscription Plan Request</h2>
        <p><strong>Email:</strong> ${customPlan.email}</p>
        <p><strong>Price:</strong> ${price || "Not provided"}</p>
        <p><strong>Plan Type:</strong> ${planType || "Not provided"}</p>   
        <p><strong>Max Editors:</strong> ${maxEditors || "Not specified"}</p>
        <p><strong>Max Viewers:</strong> ${maxViewers || "Not specified"}</p>
        <p><strong>Max RFP Proposal Generations:</strong> ${maxRFPProposalGenerations || "Not specified"}</p>
        <p><strong>Max Grant Proposal Generations:</strong> ${maxGrantProposalGenerations || "Not specified"}</p>
        <hr />

        <h2 style="color: #2563EB;">Payment Details:</h2>
        <p><strong>UPI ID:</strong> ${AdminPaymenyData.upi_id || "Not provided"}</p>
        <p><strong>    (OR)</strong></p>
        <p><strong>Account Holder Name:</strong> ${AdminPaymenyData.account_holder_name || "Not provided"}</p>
        <p><strong>Account Number:</strong> ${AdminPaymenyData.account_number || "Not provided"}</p>
        <p><strong>IFSC Code:</strong> ${AdminPaymenyData.ifsc_code || "Not provided"}</p>
        <p><strong>Bank Name:</strong> ${AdminPaymenyData.bank_name || "Not provided"}</p>
        <p><strong>Branch Name:</strong> ${AdminPaymenyData.branch_name || "Not provided"}</p>
        <p style="font-size: 12px; color: #666;">This email was generated from the Enterprise Plan Request.</p>
      </div>
    `;

  try {
    // Queue enterprise plan request email (payment-related, priority 1)
    queueEmail(customPlan.email, emailSubject, emailBody, 'enterprisePlan');
    res.status(200).json({ message: "Email queued successfully!" });
  } catch (error) {
    console.error('Error in editCustomPlan:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.deleteCustomPlan = async (req, res) => {
  try {
    const { id } = req.params;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: "Custom plan ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid custom plan ID format" });
    }

    const deletedPlan = await CustomPlan.findByIdAndDelete(id);

    if (!deletedPlan) {
      return res.status(404).json({ message: "Custom plan not found" });
    }

    res.status(200).json({ message: "Custom plan deleted successfully" });
  } catch (error) {
    console.error('Error deleting custom plan:', error);
    res.status(500).json({ message: "Error deleting custom plan", error: error.message });
  }
};



exports.createCustomPlan = async (req, res) => {
  try {
    const {
      email,
      price,
      planType,
      maxEditors,
      maxViewers,
      maxRFPProposalGenerations,
      maxGrantProposalGenerations,
      transaction_id,
      companyName,
      payment_method,
    } = req.body;

    // 1. Validate user by email
    const user = await User.findOne({ email });
    if (!user || user.role !== "company") {
      return res.status(404).json({ message: "User not found for the given email or user is not a company" });
    }

    // 2. Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (planType === "monthly") {
      endDate.setMonth(startDate.getMonth() + 1);
    } else if (planType === "yearly") {
      endDate.setFullYear(startDate.getFullYear() + 1);
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find and delete any existing CustomPlan with the same email before creating a new one
      await CustomPlan.deleteMany({ email }, { session });

      // 3. Create Subscription record
      const subscription = await Subscription.create([{
        user_id: user._id,
        plan_name: "Enterprise",
        plan_price: price,
        start_date: startDate,
        end_date: endDate,
        renewal_date: endDate,
        max_editors: maxEditors,
        max_viewers: maxViewers,
        max_rfp_proposal_generations: maxRFPProposalGenerations,
        max_grant_proposal_generations: maxGrantProposalGenerations,
        auto_renewal: false,
      }], { session });

      // 4. Create Payment record
      const payment = await Payment.create([{
        user_id: user._id,
        subscription_id: subscription[0]._id,
        price: price,
        status: "Success",
        paid_at: new Date(),
        transaction_id: transaction_id || null,
        companyName: companyName || null,
        payment_method: payment_method || "Manual Entry",
      }], { session });

      await session.commitTransaction();

      // 5. Return success response
      res.status(201).json({
        message: "Custom subscription and payment created successfully",
        subscription: subscription[0],
        payment: payment[0],
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error in createCustomPlan:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};



// payment details
exports.getPaymentDetails = async (req, res) => {
  const paymentDetails = await PaymentDetails.find();
  res.json(paymentDetails);
};

exports.editPaymentDetails = async (req, res) => {
  const { id } = req.params;
  const { upi_id, account_holder_name, account_number, ifsc_code, bank_name, branch_name, bank_address, is_primary } = req.body;
  const paymentDetails = await PaymentDetails.findByIdAndUpdate(id, { upi_id, account_holder_name, account_number, ifsc_code, bank_name, branch_name, bank_address, is_primary }, { new: true });
  res.json(paymentDetails);
};



//contact 
exports.getContactData = async (req, res) => {
  // Only return contacts from the past 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const contactData = await Contact.find({ createdAt: { $gte: thirtyDaysAgo } });
  res.json(contactData);
};

exports.deleteContactData = async (req, res) => {
  const { id } = req.params;
  await Contact.findByIdAndDelete(id);
  res.status(200).json({ message: "Contact data deleted successfully" });
};

exports.updateContactData = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  await Contact.findByIdAndUpdate(id, { status }, { new: true });
  res.status(200).json({ message: "Contact data updated successfully" });
};

exports.updateEmailContentinDB = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  }
  else {
    try {
      const { id } = req.params;
      const { emailSubject, emailBody } = req.body;
      await EmailContent.findByIdAndUpdate(id, { emailSubject, emailBody }, { new: true });
      res.status(200).json({ message: "Email content in database updated successfully" });
    } catch (error) {
      console.error('Error in updateEmailContentinDB:', error);
      res.status(500).json({ message: "Error updating email content in database", error: error.message });
    }
  }
};

exports.getEmailContentFromDB = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  }
  else {
    try {
      const emailContent = await EmailContent.find();
      res.status(200).json({ message: "Email content in database fetched successfully", emailContent: emailContent });
    } catch (error) {
      console.error('Error in getEmailContentFromDB:', error);
      res.status(500).json({ message: "Error fetching email content from database", error: error.message });
    }
  }
};

// Deactivate subscription to a user
exports.deactivateSubscription = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  } else {
    try {
      const { userEmail, note } = req.body;
      const userToDeactivateSubscription = await User.findOne({ email: userEmail });

      if (!userToDeactivateSubscription) {
        return res.status(404).json({ message: "User not found" });
      }

      if (userToDeactivateSubscription.email !== userEmail) {
        return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
      }

      //Delete the subscriptions for the user
      await Subscription.deleteMany({ user_id: userToDeactivateSubscription._id });

      //Update the user's subscription status to inactive
      await User.findByIdAndUpdate(userToDeactivateSubscription._id, { subscription_status: "inactive" });

      await CompanyProfile.findOneAndUpdate({ userId: userToDeactivateSubscription._id }, { status: "Inactive" });

      //Send email to the user
      const { subject, body } = await emailTemplates.getSubscriptionDeactivatedEmail(userToDeactivateSubscription.fullName, userToDeactivateSubscription.email, note);
      queueEmail(userToDeactivateSubscription.email, subject, body, 'subscriptionDeactivated');
      res.status(200).json({ message: "User subscription deactivated successfully" });
    }
    catch (error) {
      console.error('Error in deactivateSubscription:', error);
      res.status(500).json({ message: "Error deactivating user subscription", error: error.message });
    }
  }
};

// Assign new subscription to a user
exports.assignNewSubscriptionToUser = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  } else {
    try {
      const { userEmail, planName, type, note } = req.body;
      const userToAssignNewSubscription = await User.findOne({ email: userEmail });

      if (!userToAssignNewSubscription) {
        return res.status(404).json({ message: "User not found" });
      }

      if (userToAssignNewSubscription.email !== userEmail) {
        return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
      }

      const subscriptionPlan = await SubscriptionPlan.findOne({ name: planName });

      if (!subscriptionPlan) {
        return res.status(404).json({ message: "Subscription plan not found" });
      }

      let start_date = new Date();
      let end_date = new Date();

      if (type === "Monthly") {
        end_date.setMonth(start_date.getMonth() + 1);
      } else if (type === "Yearly") {
        end_date.setFullYear(start_date.getFullYear() + 1);
      }

      //Delete the existing subscription for the user if it exists
      await Subscription.deleteMany({ user_id: userToAssignNewSubscription._id });

      //Create a new subscription
      const newSubscription = await Subscription.create({
        user_id: userToAssignNewSubscription._id,
        plan_name: subscriptionPlan.name,
        plan_price: type === "Monthly" ? subscriptionPlan.monthlyPrice : subscriptionPlan.yearlyPrice,
        start_date: start_date,
        end_date: end_date,
        renewal_date: end_date,
        max_editors: subscriptionPlan.maxEditors,
        max_viewers: subscriptionPlan.maxViewers,
        max_rfp_proposal_generations: subscriptionPlan.maxRFPProposalGenerations,
        max_grant_proposal_generations: subscriptionPlan.maxGrantProposalGenerations,
        current_rfp_proposal_generations: 0,
        current_grant_proposal_generations: 0,
        auto_renewal: false,
        stripeSubscriptionId: null,
        stripePriceId: type === "Monthly" ? subscriptionPlan.monthlyPriceId : subscriptionPlan.yearlyPriceId,
      });

      //Update the user's subscription status to active
      await User.findByIdAndUpdate(userToAssignNewSubscription._id, { subscription_status: "active", subscription_id: newSubscription._id });

      //Send email to the user
      const { subject, body } = await emailTemplates.getSubscriptionActivatedEmail(userToAssignNewSubscription.fullName, subscriptionPlan.name, type, type === "Monthly" ? subscriptionPlan.monthlyPrice : subscriptionPlan.yearlyPrice, subscriptionPlan.maxEditors, subscriptionPlan.maxViewers, subscriptionPlan.maxRFPProposalGenerations, subscriptionPlan.maxGrantProposalGenerations, note);
      queueEmail(userToAssignNewSubscription.email, subject, body, 'subscriptionActivated');
      res.status(200).json({ message: "New subscription assigned to user successfully" });
    }
    catch (error) {
      console.error('Error in assignNewSubscriptionToUser:', error);
      res.status(500).json({ message: "Error assigning new subscription to user", error: error.message });
    }
  }
};

// Update user subscription
exports.updateUserSubscription = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  } else {
    try {
      const { userEmail, planName, type, note } = req.body;
      const userToUpdateSubscription = await User.findOne({ email: userEmail });
      if (!userToUpdateSubscription) {
        return res.status(404).json({ message: "User not found" });
      }

      const subscriptionPlan = await SubscriptionPlan.findOne({ name: planName });

      if (!subscriptionPlan) {
        return res.status(404).json({ message: "Subscription plan not found" });
      }

      let start_date = new Date();
      let end_date = new Date();

      if (type === "Monthly") {
        end_date.setMonth(start_date.getMonth() + 1);
      } else if (type === "Yearly") {
        end_date.setFullYear(start_date.getFullYear() + 1);
      }

      //Update the existing subscription for the user if it exists
      await Subscription.findOneAndUpdate({ user_id: userToUpdateSubscription._id }, { plan_name: subscriptionPlan.name, plan_price: type === "Monthly" ? subscriptionPlan.monthlyPrice : subscriptionPlan.yearlyPrice, start_date: start_date, end_date: end_date, renewal_date: end_date, max_editors: subscriptionPlan.maxEditors, max_viewers: subscriptionPlan.maxViewers, max_rfp_proposal_generations: subscriptionPlan.maxRFPProposalGenerations, max_grant_proposal_generations: subscriptionPlan.maxGrantProposalGenerations, auto_renewal: false, stripeSubscriptionId: null, stripePriceId: type === "Monthly" ? subscriptionPlan.monthlyPriceId : subscriptionPlan.yearlyPriceId });

      //Update the user's subscription status to active
      await User.findByIdAndUpdate(userToUpdateSubscription._id, { subscription_status: "active" });

      await CompanyProfile.findOneAndUpdate({ userId: userToUpdateSubscription._id }, { status: "Active" });

      //Send email to the user
      const { subject, body } = await emailTemplates.getSubscriptionUpdatedEmail(userToUpdateSubscription.fullName, subscriptionPlan.name, type, type === "Monthly" ? subscriptionPlan.monthlyPrice : subscriptionPlan.yearlyPrice, subscriptionPlan.maxEditors, subscriptionPlan.maxViewers, subscriptionPlan.maxRFPProposalGenerations, subscriptionPlan.maxGrantProposalGenerations, note);
      queueEmail(userToUpdateSubscription.email, subject, body, 'subscriptionUpdated');

      res.status(200).json({ message: "User subscription updated successfully" });
    }
    catch (error) {
      console.error('Error in updateUserSubscription:', error);
      res.status(500).json({ message: "Error updating user subscription", error: error.message });
    }
  }
};


//Bulk deactivate user subscriptions
exports.bulkDeactivateSubscriptions = async (req, res) => {
  const user = req.user;
  if (user.role !== "SuperAdmin") {
    return res.status(403).json({ message: "Forbidden: You are not authorized to access this resource" });
  } else {
    try {
      const { userEmails, note } = req.body;

      await Promise.all(userEmails.map(async (userEmail) => {
        const userToDeactivateSubscription = await User.findOne({ email: userEmail });
        if (!userToDeactivateSubscription) {
          return res.status(404).json({ message: "User not found" });
        }

        await Subscription.deleteMany({ user_id: userToDeactivateSubscription._id });

        await User.findByIdAndUpdate(userToDeactivateSubscription._id, { subscription_status: "inactive" });

        await CompanyProfile.findOneAndUpdate({ userId: userToDeactivateSubscription._id }, { status: "Inactive" });

        const { subject, body } = await emailTemplates.getSubscriptionDeactivatedEmail(userToDeactivateSubscription.fullName, userToDeactivateSubscription.email, note);
        queueEmail(userToDeactivateSubscription.email, subject, body, 'subscriptionDeactivated');
      }));

      res.status(200).json({ message: "Subscriptions deactivated successfully" });
    }
    catch (error) {
      console.error('Error in bulkDeactivateUserSubscriptions:', error);
      res.status(500).json({ message: "Error deactivating user subscriptions", error: error.message });
    }
  }
};

// Create a new add-on plan (SuperAdmin only)
exports.createAddOnPlan = async (req, res) => {
  try {
    const { name, description, price, type, quantity, popular } = req.body;

    // Validation
    if (!name || !price || !type || !quantity) {
      return res.status(400).json({
        message: "Validation error",
        errors: {
          name: name ? undefined : "Name is required",
          price: price ? undefined : "Price is required",
          type: type ? undefined : "Type is required",
          quantity: quantity ? undefined : "Quantity is required"
        }
      });
    }

    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({
        message: "Validation error",
        errors: {
          price: "Price must be a positive number"
        }
      });
    }

    if (typeof quantity !== 'number' || quantity < 1) {
      return res.status(400).json({
        message: "Validation error",
        errors: {
          quantity: "Quantity must be a positive number"
        }
      });
    }

    // Check if add-on with same name already exists
    const existingAddOn = await AddOnPlan.findOne({ name: name.trim() });
    if (existingAddOn) {
      return res.status(400).json({
        message: "Validation error",
        errors: {
          name: "Add-on with this name already exists"
        }
      });
    }

    const addOn = await AddOnPlan.create({
      name: name.trim(),
      description: description || '',
      price: price,
      type: "RFP Proposal Generation",
      quantity: quantity,
      popular: popular || false,
      isActive: true,
    });

    res.status(201).json({ message: "Add-on plan created successfully", addOn: addOn });
  } catch (error) {
    console.error('Error in createAddOnPlan:', error);
    res.status(500).json({ message: "Error creating add-on plan", error: error.message, addOn: null });
  }
};

// Update an existing add-on plan (SuperAdmin only)
exports.updateAddOnPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, quantity, popular, isActive } = req.body;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid add-on ID format" });
    }

    const addOn = await AddOnPlan.findById(id);
    if (!addOn) {
      return res.status(404).json({ message: "Add-on not found" });
    }

    // Validation
    if (price !== undefined && (typeof price !== 'number' || price < 0)) {
      return res.status(400).json({
        message: "Validation error",
        errors: {
          price: "Price must be a positive number"
        }
      });
    }

    // Check if name is being changed and if it conflicts with another add-on
    if (name && name.trim() !== addOn.name) {
      const existingAddOn = await AddOnPlan.findOne({ name: name.trim(), _id: { $ne: id } });
      if (existingAddOn) {
        return res.status(400).json({
          message: "Validation error",
          errors: {
            name: "Add-on with this name already exists"
          }
        });
      }
    }

    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description || '';
    if (price !== undefined) updateData.price = price;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (popular !== undefined) updateData.popular = popular;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedAddOn = await AddOnPlan.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({ message: "Add-on plan updated successfully", updatedAddOn: updatedAddOn });
  } catch (error) {
    console.error('Error in updateAddOnPlan:', error);
    res.status(500).json({ message: "Error updating add-on plan", error: error.message, updatedAddOn: null });
  }
};

// Delete an add-on plan (SuperAdmin only)
exports.deleteAddOnPlan = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid add-on ID format" });
    }

    const addOn = await AddOnPlan.findById(id);
    if (!addOn) {
      return res.status(404).json({ message: "Add-on not found" });
    }

    const deletedAddOn = await AddOnPlan.findByIdAndDelete(id);

    res.status(200).json({
      message: "Add-on deleted successfully",
      deletedId: id,
      deletedAddOn: deletedAddOn
    });
  } catch (error) {
    console.error('Error in deleteAddOnPlan:', error);
    res.status(500).json({ message: "Error deleting add-on plan", error: error.message, deletedAddOn: null });
  }
};

exports.sendCustomEmail = async (req, res) => {
  try {
    const { subject, body, sendTo } = req.body;
    let emails = [];
    if (sendTo === "All") {
      emails = await User.find({ role: "company" }).select("email");
    } else if (sendTo === "Active Users") {
      emails = await User.find({ role: "company", subscription_status: "active" }).select("email");
    } else if (sendTo === "Inactive Users") {
      emails = await User.find({ role: "company", subscription_status: "inactive" }).select("email");
    } else {
      const { customEmails } = req.body;
      emails = customEmails;
    }
    await Promise.all(emails.map(async (email) => {
      queueEmail(email, subject, body, 3); // General notification, priority 3
    }));
    res.status(200).json({ message: emails.length > 0 ? emails.length === 1 ? "Email sent successfully" : "Emails sent successfully" : "No members found to send email" });
  } catch (error) {
    console.error('Error in sendCustomEmail:', error);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
};