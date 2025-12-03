const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const app = express();


const proposalRoute = require('./routes/Proposals.js');
const authRoute = require("./routes/Auth.js");
const rfpDiscovery = require('./routes/mlPipeline.js');
const profileRoute = require('./routes/Profile.js');
const dashboardRoute = require('./routes/Dashboard.js');
const superAdminRoute = require('./routes/SuperAdmin.js');
const supportRoute = require('./routes/SupportTicket.js');
const stripeRoute = require('./routes/Stripe.js');
const editorRoute = require('./routes/Editor.js');
const SubscriptionPlan = require('./models/SubscriptionPlan.js');
const Subscription = require('./models/Subscription.js');
const AddOnPlan = require('./models/AddOnPlan.js');
const Contact = require('./models/Contact.js');
const { handleWebhook } = require('./controllers/stripeController');
const { validateEmail } = require('./utils/validation');
const { getContactFormEmail } = require('./utils/emailTemplates');
const { queueEmail } = require('./utils/mailSender');

const dbConnect = require('./utils/dbConnect.js');
require('./utils/cronJob.js');

// Initialize email queue processor
const { emailQueue } = require('./utils/emailQueue');
const { sendEmail } = require('./utils/mailSender');

// Initialize Redis
const { initRedis } = require('./utils/redisClient');

// Import rate limiting middleware
const {
  generalLimiter,
  authLimiter,
  passwordResetLimiter,
  contactFormLimiter,
  paymentLimiter,
  adminLimiter
} = require('./utils/rateLimiter');

// Import cache middleware
const {
  publicCacheMiddleware,
  userCacheMiddleware
} = require('./middleware/cacheMiddleware');

// Start processing email queue in background
emailQueue.startProcessing(sendEmail);
console.log('Email queue processor started');

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

const sendEmail_contactForm = async (req, res) => {
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

    const { subject, body } = await getContactFormEmail(
      sanitizedName,
      sanitizedEmail,
      sanitizedCompany,
      sanitizedDescription
    );

    // Queue contact form email (general notification, priority 3)
    queueEmail(process.env.SUPPORT_EMAIL, subject, body, 'contactForm');
    res.status(200).json({ message: "Email queued successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send email." });
  }
};

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(helmet());
app.use(express.json());

// CORS Configuration - Allow all origins for file serving (OnlyOffice needs this)
app.use((req, res, next) => {
  // For file serving endpoints, allow all origins (OnlyOffice Document Server)
  if (req.path && req.path.includes('/serve-doc/')) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
  }
  next();
});

// Standard CORS for other routes
app.use(cors({
  origin: ["http://localhost:5173", "https://ai-rfp-2-frontend.vercel.app", "https://rfp2grants.ai"],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Public endpoints with caching (GET requests)
app.get('/getSubscriptionPlansData', publicCacheMiddleware, getSubscriptionPlansData);

app.get('/getAddOnPlans', publicCacheMiddleware, getAddOnPlans);

// Contact form with specific rate limiting
app.post('/contact', contactFormLimiter, sendEmail_contactForm);

// Register routes with rate limiting
// Authentication routes - strict rate limiting
app.use('/auth', authLimiter, authRoute);

// Payment/Stripe routes - payment-specific rate limiting
app.use('/stripe', paymentLimiter, stripeRoute);

// Admin routes - admin-specific rate limiting
app.use('/admin', adminLimiter, superAdminRoute);

// Editor routes - editor-specific rate limiting
app.use('/editor', editorRoute);

// Other routes - general rate limiting already applied globally
app.use('/proposals', proposalRoute);
app.use('/rfp', rfpDiscovery);
app.use('/profile', profileRoute);
app.use('/dashboard', dashboardRoute);
app.use('/support', supportRoute);

app.get('/', (req, res) => {
  res.send('Welcome to the Proposal API');
});

// Connect to MongoDB, Redis and Start the server
async function startServer() {
  try {
    // Initialize Redis (non-blocking - app will continue if Redis is unavailable)
    await initRedis();

    // Connect to MongoDB
    await dbConnect();

    // Start server
    app.listen(process.env.PORT, () => {
      console.log(`server is running on port ${process.env.PORT}`);
      console.log(`Rate limiting: Enabled`);
      console.log(`Caching: ${require('./utils/redisClient').isRedisAvailable() ? 'Enabled (Redis)' : 'Disabled (Redis not available)'}`);
    });
  } catch (error) {
    console.error(`Error Starting Server: ${error.message}`);
    process.exit(1);
  }
}

startServer();