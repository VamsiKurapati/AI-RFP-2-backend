const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();


const proposalRoute = require('./routes/Proposals.js');
const authRoute = require("./routes/Auth.js");
const rfpDiscovery = require('./routes/mlPipeline.js');
const profileRoute = require('./routes/Profile.js');
const dashboardRoute = require('./routes/Dashboard.js');
const superAdminRoute = require('./routes/SuperAdmin.js');
const supportRoute = require('./routes/SupportTicket.js');
const imageRoute = require('./routes/Image.js');
const stripeRoute = require('./routes/Stripe.js');
const SubscriptionPlan = require('./models/SubscriptionPlan.js');
const Subscription = require('./models/Subscription.js');
const AddOnPlan = require('./models/AddOnPlan.js');
const nodemailer = require('nodemailer');
const Contact = require('./models/Contact.js');
const { handleWebhook } = require('./controllers/stripeController');
const { validateEmail } = require('./utils/validation');
const { getContactFormEmail } = require('./utils/emailTemplates');

const dbConnect = require('./utils/dbConnect.js');
require('./utils/cronJob.js');

const getSubscriptionPlansData = async (req, res) => {
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

const sendEmail = async (req, res) => {
  try {
    const { name, company, email, description } = req.body;

    // Input validation
    if (!name || !email || !description) {
      return res.status(400).json({ message: "Name, email, and description are required" });
    }

    // Email format validation
    const emailValid = validateEmail(email);
    if (!emailValid) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    // Sanitize inputs to prevent XSS
    const escapeHtml = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    };

    const sanitizedName = escapeHtml(name);
    const sanitizedEmail = escapeHtml(email);
    const sanitizedCompany = escapeHtml(company);
    const sanitizedDescription = escapeHtml(description);

    const contact = await Contact.create({
      name: sanitizedName,
      company: sanitizedCompany,
      email: sanitizedEmail,
      description: sanitizedDescription,
      status: "Open"
    });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const { subject, body } = await getContactFormEmail(
      sanitizedName,
      sanitizedEmail,
      sanitizedCompany,
      sanitizedDescription
    );

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: process.env.SUPPORT_EMAIL,
      replyTo: sanitizedEmail,
      subject: subject,
      html: body,
    };

    const info = await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send email." });
  }
};

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// CORS Configuration
app.use(cors({
  origin: ["http://localhost:5173", "https://ai-rfp-2-frontend.vercel.app", "https://rfp2grants.ai"],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/getSubscriptionPlansData', getSubscriptionPlansData);

const getAddOnPlans = async (req, res) => {
  try {
    const addOns = await AddOnPlan.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(addOns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching add-on plans data",
      error: err.message
    });
  }
};

app.get('/getAddOnPlans', getAddOnPlans);
app.post('/contact', sendEmail);

// Register routes before starting server
app.use('/proposals', proposalRoute);

app.use('/auth', authRoute);

app.use('/rfp', rfpDiscovery);

app.use('/profile', profileRoute);

app.use('/dashboard', dashboardRoute);

app.use('/admin', superAdminRoute);

app.use('/support', supportRoute);

app.use('/image', imageRoute);

app.use('/stripe', stripeRoute);

app.get('/', (req, res) => {
  res.send('Welcome to the Proposal API');
});

// Connect to MongoDB and Start the server
async function startServer() {
  try {
    await dbConnect();
    app.listen(process.env.PORT, () => {
      console.log(`server is running on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.error(`Error Connecting To DB: ${error.message}`);
  }
}

startServer();