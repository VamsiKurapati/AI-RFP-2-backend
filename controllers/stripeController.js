const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Payment = require('../models/Payments');
const CompanyProfile = require('../models/CompanyProfile');
const { sendEmail } = require('../utils/mailSender');
const emailTemplates = require('../utils/emailTemplates');
const CustomPlan = require('../models/CustomPlan');

// Stripe Configuration
const STRIPE_CONFIG = {
    BILLING_CYCLES: {
        MONTHLY: 'monthly',
        YEARLY: 'yearly'
    }
};

// Manual refund function for admin use
const processManualRefund = async (req, res) => {
    try {
        const { paymentIntentId, reason, amount } = req.body;
        const userId = req.user._id;

        // Validate required fields
        if (!paymentIntentId || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: paymentIntentId, reason'
            });
        }

        // Verify payment intent exists and get details
        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to verify payment intent'
            });
        }

        if (!paymentIntent) {
            return res.status(404).json({
                success: false,
                message: 'Payment intent not found'
            });
        }

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({
                success: false,
                message: 'Payment intent was not successful, cannot refund'
            });
        }

        // Check if already refunded
        const existingRefunds = await stripe.refunds.list({
            payment_intent: paymentIntentId
        });

        if (existingRefunds.data.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Payment has already been refunded',
                existingRefunds: existingRefunds.data
            });
        }

        // Create refund
        const refundData = {
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: {
                reason: reason,
                refundedBy: userId.toString(),
                refundedAt: new Date().toISOString()
            }
        };

        // Add amount if partial refund
        if (amount && amount > 0) {
            refundData.amount = Math.round(amount * 100); // Convert to cents
        }

        let refund;
        try {
            refund = await stripe.refunds.create(refundData);
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create refund'
            });
        }

        // Update payment record
        await Payment.findOneAndUpdate(
            { transaction_id: paymentIntentId },
            {
                $set: {
                    status: 'Pending Refund',
                    refund_id: refund.id,
                    refunded_at: new Date(),
                    refund_reason: reason
                }
            }
        );

        // Cancel subscription if exists
        const subscription = await Subscription.findOne({
            stripeSubscriptionId: paymentIntentId
        });

        if (subscription) {
            await Subscription.findByIdAndUpdate(subscription._id, {
                $set: {
                    canceled_at: new Date(),
                    auto_renewal: false
                }
            });

            //Update user subscription status
            await User.findByIdAndUpdate(subscription.user_id, { subscription_status: 'Inactive' }, { session });

            // Update company profile subscription status
            await CompanyProfile.findOneAndUpdate({ userId: subscription.user_id }, { status: 'Inactive' }, { session });
        }

        res.status(200).json({
            success: true,
            message: 'Refund processed successfully',
            refund: {
                id: refund.id,
                amount: refund.amount,
                status: refund.status,
                reason: refund.reason
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process refund',
            error: error
        });
    }
};

// Get refund status
const getRefundStatus = async (req, res) => {
    try {
        const { paymentIntentId } = req.params;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                message: 'Payment intent ID is required'
            });
        }

        // Get refunds for this payment intent
        let refunds;
        try {
            refunds = await stripe.refunds.list({
                payment_intent: paymentIntentId
            });
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve refund information'
            });
        }

        // Get payment record
        const payment = await Payment.findOne({ transaction_id: paymentIntentId });

        res.status(200).json({
            success: true,
            paymentIntentId: paymentIntentId,
            refunds: refunds.data,
            paymentRecord: payment
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get refund status',
            error: error
        });
    }
};

// Helper function to send refund notification email
const sendRefundNotification = async (user, plan, refundId, errorMessage) => {
    try {
        const { subject, body } = await emailTemplates.getRefundNotificationEmail(
            user.fullName,
            plan.name,
            refundId,
            errorMessage
        );

        await sendEmail(user.email, subject, body);
    } catch (emailError) {
        console.error('Failed to send refund notification email:', emailError);
    }
};

// Sync prices from Stripe products to database
const syncPricesFromStripe = async (req, res) => {
    try {
        // Get all subscription plans from database
        const plans = await SubscriptionPlan.find();

        if (!plans || plans.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No subscription plans found in database'
            });
        }

        let updatedCount = 0;
        let errors = [];

        // For each plan, fetch prices from Stripe
        for (const plan of plans) {
            try {
                // Skip if price IDs are not set
                if (!plan.monthlyPriceId && !plan.yearlyPriceId) {
                    continue;
                }

                let monthlyPrice = plan.monthlyPrice;
                let yearlyPrice = plan.yearlyPrice;

                // Fetch monthly price from Stripe if available
                if (plan.monthlyPriceId) {
                    try {
                        const stripePrice = await stripe.prices.retrieve(plan.monthlyPriceId);
                        monthlyPrice = stripePrice.unit_amount / 100; // Convert from cents to dollars
                    } catch (error) {
                        errors.push(`Failed to fetch monthly price for ${plan.name}: ${error.message}`);
                    }
                }

                // Fetch yearly price from Stripe if available
                if (plan.yearlyPriceId) {
                    try {
                        const stripePrice = await stripe.prices.retrieve(plan.yearlyPriceId);
                        yearlyPrice = stripePrice.unit_amount / 100; // Convert from cents to dollars
                    } catch (error) {
                        errors.push(`Failed to fetch yearly price for ${plan.name}: ${error.message}`);
                    }
                }

                // Update plan in database
                await SubscriptionPlan.findByIdAndUpdate(plan._id, {
                    monthlyPrice,
                    yearlyPrice
                });

                updatedCount++;
            } catch (error) {
                errors.push(`Error syncing ${plan.name}: ${error.message}`);
            }
        }

        res.status(200).json({
            success: true,
            message: `Successfully synced ${updatedCount} plan(s)`,
            updatedCount,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to sync prices from Stripe',
            error: error
        });
    }
};

// Activate Subscription
const activateSubscription = async (req, res) => {
    try {
        const { paymentIntentId, planId, billingCycle } = req.body;
        const userId = req.user._id;

        // Validate required fields
        if (!paymentIntentId || !planId || !billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: paymentIntentId, planId, billingCycle'
            });
        }

        // Verify payment intent
        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
                expand: ['latest_charge']
            });
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to verify payment'
            });
        }

        if (paymentIntent.status !== 'succeeded') {

            //Create payment record
            await Payment.create({
                user_id: userId,
                subscription_id: null,
                price: 0,
                status: 'Failed',
                paid_at: new Date()
            });
            return res.status(400).json({
                success: false,
                message: `Payment not completed. Status: ${paymentIntent.status}`,
                error: paymentIntent.last_payment_error?.message || 'Unknown error'
            });
        }

        // Verify the payment intent belongs to this user
        if (paymentIntent.metadata.userId !== userId) {
            //Create payment record
            await Payment.create({
                user_id: userId,
                subscription_id: null,
                price: 0,
                status: 'Failed',
                paid_at: new Date()
            });
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access to payment intent'
            });
        }

        // Validate plan and pricing again by _id
        const plan = await SubscriptionPlan.findById(planId);

        if (!plan) {
            //Create payment record
            await Payment.create({
                user_id: userId,
                subscription_id: null,
                price: 0,
                status: 'Failed',
                paid_at: new Date()
            });
            return res.status(400).json({
                success: false,
                message: 'Plan not found'
            });
        }

        // Validate metadata and amount against DB pricing
        if (paymentIntent.metadata.planId !== planId || paymentIntent.metadata.billingCycle !== billingCycle) {
            //Create payment record
            await Payment.create({
                user_id: userId,
                subscription_id: null,
                price: 0,
                status: 'Failed',
                paid_at: new Date()
            });
            return res.status(400).json({
                success: false,
                message: 'Payment intent metadata mismatch'
            });
        }

        const expectedAmount = billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice;
        const expectedAmountCents = Math.round(expectedAmount * 100);

        if (paymentIntent.amount !== expectedAmountCents) {
            //Create payment record
            await Payment.create({
                user_id: userId,
                subscription_id: null,
                price: 0,
                status: 'Failed',
                paid_at: new Date()
            });
            return res.status(400).json({
                success: false,
                message: `Payment amount does not match plan pricing. Expected: ${expectedAmountCents}, Got: ${paymentIntent.amount}`
            });
        }

        // Calculate subscription dates
        const startDate = new Date();
        const endDate = new Date();

        if (billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY) {
            endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }

        const existingSubscription = await Subscription.findOne({ user_id: userId });

        let newMaxRfp = plan.maxRFPProposalGenerations;
        let newMaxGrant = plan.maxGrantProposalGenerations;

        if (existingSubscription) {
            const unusedRfp =
                (existingSubscription.max_rfp_proposal_generations -
                    existingSubscription.current_rfp_proposal_generations) || 0;
            const unusedGrant =
                (existingSubscription.max_grant_proposal_generations -
                    existingSubscription.current_grant_proposal_generations) || 0;

            newMaxRfp += unusedRfp;
            newMaxGrant += unusedGrant;
        }

        // Use transaction for data consistency with automatic refund on failure
        const session = await mongoose.startSession();
        session.startTransaction();

        let refundId = null;
        let subscription = null;

        try {
            const subscription = await Subscription.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        plan_name: plan.name,
                        plan_price:
                            billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY
                                ? plan.yearlyPrice
                                : plan.monthlyPrice,
                        start_date: startDate,
                        end_date: endDate,
                        renewal_date: endDate,
                        max_editors: plan.maxEditors,
                        max_viewers: plan.maxViewers,
                        current_rfp_proposal_generations: 0, // reset usage
                        current_grant_proposal_generations: 0, // reset usage
                        max_rfp_proposal_generations: newMaxRfp, // ✅ directly set new total
                        max_grant_proposal_generations: newMaxGrant, // ✅ directly set new total
                        canceled_at: null,
                        auto_renewal: true,
                        stripeSubscriptionId: paymentIntent.id,
                        stripePriceId: paymentIntent.metadata.planPriceId || null
                    }
                },
                { upsert: true, new: true, session }
            );

            // //Check the no.of edtors and viewers from subscription and delete the extra editors and viewers from the company profile, Employee profile, amd Users Database and update the company profile
            // const companyProfile = await CompanyProfile.findById(userId);
            // const employees = companyProfile.employees;
            // let toBeDeletedEmployees = [];
            // let toBeDeletedUsers = [];
            // //Delete the extra editors and viewers from the employees
            // for (const employee of employees) {
            //     if (employee.accessLevel === "Editor" && subscription.max_editors < employees.length) {
            //         toBeDeletedEmployees.push(employee.employeeId);
            //         const employeeProfile = await EmployeeProfile.findById(employee.employeeId);
            //         toBeDeletedEmployees.push(employeeProfile.userId);
            //         toBeDeletedUsers.push(employeeProfile.userId);
            //     }
            //     if (employee.accessLevel === "Viewer" && subscription.max_viewers < employees.length) {
            //         toBeDeletedEmployees.push(employee.employeeId);
            //         const employeeProfile = await EmployeeProfile.findById(employee.employeeId);
            //         toBeDeletedEmployees.push(employeeProfile.userId);
            //         toBeDeletedUsers.push(employeeProfile.userId);
            //     }
            // }

            // //Delete the extra editors and viewers from the employee PROFILES
            // for (const employeeId of toBeDeletedEmployees) {
            //     await EmployeeProfile.findByIdAndDelete(employeeId);
            // }

            // //Delete the extra editors and viewers from the users DATABASE
            // for (const userId of toBeDeletedUsers) {
            //     await User.findByIdAndDelete(userId);
            // }

            // //Update the company profile
            // companyProfile.employees = companyProfile.employees.filter(employee => !toBeDeletedEmployees.includes(employee.employeeId));
            // await companyProfile.save({ session });

            // Update user subscription status
            await User.findByIdAndUpdate(userId, {
                subscription_status: 'active',
                subscription_id: subscription._id
            }, { session });

            // Update company profile subscription status
            await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Active' }, { session });

            // Create payment record
            await Payment.create([{
                user_id: userId,
                subscription_id: subscription._id,
                price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                status: 'Success',
                paid_at: new Date(),
                transaction_id: paymentIntentId,
                companyName: req.user.fullName,
                payment_method: 'stripe',
            }], { session });

            await session.commitTransaction();
        } catch (error) {
            // Abort database transaction
            await session.abortTransaction();

            // Initiate automatic refund
            try {
                const refund = await stripe.refunds.create({
                    payment_intent: paymentIntentId,
                    reason: 'requested_by_customer',
                    metadata: {
                        reason: 'database_transaction_failed',
                        userId: userId,
                        planId: planId,
                        error: error.message
                    }
                });

                refundId = refund.id;
                // Create failed payment record with refund info
                await Payment.create({
                    user_id: userId,
                    subscription_id: null,
                    price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                    status: 'Pending Refund',
                    paid_at: new Date(),
                    transaction_id: paymentIntentId,
                    refund_id: refundId,
                    companyName: req.user.fullName,
                    payment_method: 'stripe',
                    failure_reason: error.message
                });

                // Send refund notification email
                await sendRefundNotification(req.user, plan, refundId, error.message);

            } catch (refundError) {

                // Create payment record indicating refund failure
                await Payment.create({
                    user_id: userId,
                    subscription_id: null,
                    price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                    status: 'Failed - Refund Required',
                    paid_at: new Date(),
                    transaction_id: paymentIntentId,
                    companyName: req.user.fullName,
                    payment_method: 'stripe',
                    failure_reason: `Database error: ${error.message}. Refund failed: ${refundError.message}`
                });

                // Update company profile subscription status
                await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Inactive' }, { session });
            }

            throw error;
        } finally {
            session.endSession();
        }

        const notification = new Notification({
            type: "Subscription",
            title: "Subscription activated",
            description: "A subscription has been activated for " + req.user.email + " for the plan " + plan.name,
            created_at: new Date(),
        });
        await notification.save();

        const amount = billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice;
        const { subject, body } = await emailTemplates.getPaymentSuccessEmail(
            req.user.fullName,
            plan.name,
            amount,
            billingCycle,
            startDate,
            endDate
        );

        await sendEmail(req.user.email, subject, body);

        // Update company profile subscription status
        await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Active' }, { session });

        res.status(200).json({
            success: true,
            message: 'Subscription activated successfully',
            subscription: subscription
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to activate subscription',
            error: error
        });
    }
};

// Create Subscription Checkout Session (for auto-renewal)
const createPaymentIntent = async (req, res) => {
    try {
        const { planId, billingCycle } = req.body;
        const userId = req.user._id;

        //Enable only companies to create payment intent
        if (req.user.role !== 'company') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to create payment intent'
            });
        }

        // Validate required fields
        if (!planId || !billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: planId, billingCycle'
            });
        }
        // Validate billing cycle
        if (!Object.values(STRIPE_CONFIG.BILLING_CYCLES).includes(billingCycle)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid billing cycle. Must be "monthly" or "yearly"'
            });
        }
        // Get plan details from database by _id and verify pricing
        const plan = await SubscriptionPlan.findById(planId);
        if (!plan) {
            return res.status(400).json({
                success: false,
                message: 'Plan not found'
            });
        }
        // Get Stripe Price ID based on billing cycle
        const stripePriceId = billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY
            ? plan.yearlyPriceId
            : plan.monthlyPriceId;
        if (!stripePriceId) {
            return res.status(400).json({
                success: false,
                message: `Stripe price ID not configured for ${billingCycle} billing cycle`
            });
        }
        // Get or create Stripe customer
        let user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        let stripeCustomerId = user.stripeCustomerId;
        // Verify customer exists in Stripe if we have a customer ID
        if (stripeCustomerId) {
            try {
                // Verify the customer exists in Stripe
                const customer = await stripe.customers.retrieve(stripeCustomerId);
                if (!customer || customer.deleted) {
                    stripeCustomerId = null; // Reset to create new customer
                }
            } catch (stripeError) {
                // If customer doesn't exist (404) or is deleted, create a new one
                if (stripeError.code === 'resource_missing' || stripeError.statusCode === 404) {
                    stripeCustomerId = null; // Reset to create new customer
                } else {
                    // For other errors, log and continue to try creating a new customer
                    stripeCustomerId = null;
                }
            }
        }
        // Create new customer if we don't have a valid one
        if (!stripeCustomerId) {
            try {
                // Create Stripe customer
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: {
                        userId: userId.toString()
                    }
                });

                stripeCustomerId = customer.id;
                user.stripeCustomerId = stripeCustomerId;
                await user.save();
            } catch (stripeError) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create customer account'
                });
            }
        }
        const stripeProductId = billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY
            ? plan.stripeProductYearlyId
            : plan.stripeProductMonthlyId;
        if (!stripeProductId) {
            return res.status(400).json({
                success: false,
                message: 'Stripe product ID not configured for this plan'
            });
        }
        //Retrieve the product details from the plan
        const product = await stripe.products.retrieve(stripeProductId);
        if (!product) {
            return res.status(400).json({
                success: false,
                message: 'Product not found'
            });
        }
        // Create subscription checkout session for auto-renewal
        let checkoutSession;
        try {
            // Get the frontend URL from environment or use a default
            const frontendUrl = process.env.FRONTEND_URL;

            checkoutSession = await stripe.checkout.sessions.create({
                customer: stripeCustomerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: stripePriceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                subscription_data: {
                    metadata: {
                        userId: userId.toString(),
                        planId: planId.toString(),
                        planName: plan.name,
                        billingCycle: billingCycle,
                        productId: stripeProductId
                    }
                },
                success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${frontendUrl}/payment-cancel`,
                metadata: {
                    userId: userId.toString(),
                    planId: planId.toString(),
                    planName: plan.name,
                    billingCycle: billingCycle,
                    productId: stripeProductId
                }
            });
        } catch (stripeError) {
            console.error('Failed to create checkout session:', stripeError);
            return res.status(500).json({
                success: false,
                message: 'Failed to create checkout session'
            });
        }

        res.status(200).json({
            success: true,
            sessionId: checkoutSession.id,
            url: checkoutSession.url
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create checkout session',
            error: error
        });
    }
};

const handleSubscriptionWebhook = async (event) => {
    const { type, data } = event;
    const stripeObject = data.object;

    try {
        switch (type) {
            case "invoice.paid": {
                const invoice = stripeObject;
                // Avoid duplicates
                const exists = await Payment.findOne({
                    transaction_id: invoice.payment_intent || invoice.id,
                    status: "Success",
                });
                if (exists) {
                    return;
                }

                const subscriptionId =
                    invoice.subscription ||
                    invoice.lines?.data?.[0]?.subscription ||
                    invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ||
                    invoice.parent?.subscription_details?.subscription ||
                    invoice.metadata?.subscriptionId;
                if (!subscriptionId) {
                    return;
                }

                const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
                    expand: ["items.data.price.product"],
                });
                await activateSubscriptionFromStripe(stripeSubscription, invoice);
                break;
            }

            case "invoice.payment_failed": {
                const invoice = stripeObject;
                const stripeSub = await stripe.subscriptions.retrieve(invoice.subscription);
                const userId = stripeSub.metadata?.userId;
                if (!userId) {
                    return;
                }

                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    await Subscription.findOneAndUpdate(
                        { stripeSubscriptionId: stripeSub.id },
                        { auto_renewal: false },
                        { session }
                    );
                    await User.findByIdAndUpdate(userId, { subscription_status: "inactive" }, { session });
                    await CompanyProfile.findOneAndUpdate({ userId }, { status: "Past Due" }, { session });

                    await Payment.create(
                        [
                            {
                                user_id: userId,
                                subscription_id: null,
                                price: invoice.amount_due / 100,
                                status: "Failed",
                                paid_at: new Date(),
                                transaction_id: invoice.payment_intent || invoice.id,
                                payment_method: "stripe",
                                failure_reason: "Payment failed for subscription renewal",
                            },
                        ],
                        { session }
                    );

                    await session.commitTransaction();
                } catch (err) {
                    await session.abortTransaction();
                } finally {
                    session.endSession();
                }
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated": {
                break;
            }

            case "customer.subscription.deleted": {
                const sub = stripeObject;
                const userId = sub.metadata?.userId;
                if (!userId) {
                    return;
                }

                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    await Subscription.findOneAndUpdate(
                        { stripeSubscriptionId: sub.id },
                        { canceled_at: new Date(), auto_renewal: false },
                        { session }
                    );
                    await User.findByIdAndUpdate(userId, { subscription_status: "inactive" }, { session });
                    await CompanyProfile.findOneAndUpdate({ userId }, { status: "Inactive" }, { session });

                    await session.commitTransaction();
                } catch (err) {
                    await session.abortTransaction();
                } finally {
                    session.endSession();
                }
                break;
            }

            default:
        }
    } catch (err) {
        throw err;
    }
};

const activateSubscriptionFromStripe = async (stripeSub, invoice) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = stripeSub.metadata?.userId;
        const planId = stripeSub.metadata?.planId;
        const billingCycle = stripeSub.metadata?.billingCycle;
        const productId = stripeSub.metadata?.productId;
        const planName = stripeSub.metadata?.planName;

        if (!userId || !planId || !productId || !planName || !billingCycle) {
            throw new Error("Missing metadata for subscription activation");
        }
        const [plan, user] = await Promise.all([
            SubscriptionPlan.findById(planId),
            User.findById(userId),
        ]);
        if (!plan || !user) throw new Error("User or plan not found");
        const priceAmount = stripeSub.items.data[0]?.price?.unit_amount / 100 || 0;
        const priceId = stripeSub.items.data[0]?.price?.id;
        const startUnix = stripeSub.items.data[0].current_period_start;
        const endUnix = stripeSub.items.data[0].current_period_end;
        const start = startUnix ? new Date(startUnix * 1000) : new Date();
        const intervalCount = stripeSub.items.data[0].price.recurring.interval_count;
        const interval = stripeSub.items.data[0].price.recurring.interval;
        const new_end = interval === 'month' ? new Date(start.getTime() + intervalCount * 30 * 24 * 60 * 60 * 1000) : new Date(start.getTime() + intervalCount * 365 * 24 * 60 * 60 * 1000);
        const end = endUnix ? new Date(endUnix * 1000) : new_end;

        const dbSub = await Subscription.findOneAndUpdate(
            { user_id: userId },
            {
                plan_name: planName,
                plan_price: priceAmount,
                start_date: start,
                end_date: end,
                renewal_date: end,
                max_editors: plan.maxEditors,
                max_viewers: plan.maxViewers,
                max_rfp_proposal_generations: plan.maxRFPProposalGenerations,
                max_grant_proposal_generations: plan.maxGrantProposalGenerations,
                current_rfp_proposal_generations: 0,
                current_grant_proposal_generations: 0,
                auto_renewal: true,
                stripeSubscriptionId: stripeSub.id,
                stripePriceId: priceId,
                stripeProductId: productId,
            },
            { upsert: true, new: true, session }
        );

        const companyProfile = await CompanyProfile.findOne({ userId: userId });
        await Promise.all([
            User.findByIdAndUpdate(
                userId,
                { subscription_status: "active", subscription_id: dbSub._id },
                { session }
            ),
            CompanyProfile.findOneAndUpdate(
                { userId: userId },
                { status: "Active" },
                { session }
            ),
            Payment.create(
                [
                    {
                        user_id: userId,
                        subscription_id: dbSub._id,
                        price: priceAmount,
                        status: "Success",
                        paid_at: invoice.status_transitions?.paid_at
                            ? new Date(invoice.status_transitions.paid_at * 1000)
                            : new Date(),
                        transaction_id: invoice.payment_intent || invoice.id,
                        payment_method: "stripe",
                        companyName: companyProfile.companyName,
                    },
                ],
                { session }
            ),
            Notification.create(
                [
                    {
                        type: "Subscription",
                        title: "Subscription Activated",
                        description: `Plan ${plan.name} activated for ${user.email}`,
                        created_at: new Date(),
                    },
                ],
                { session }
            ),
        ]);

        await session.commitTransaction();
        // Send payment confirmation email
        const { subject, body } = await emailTemplates.getPaymentSuccessEmail(
            user.fullName,
            plan.name,
            priceAmount,
            billingCycle,
            start,
            end
        );
        await sendEmail(user.email, subject, body);
    } catch (err) {
        console.error("Error in activateSubscriptionFromStripe: ", err);
        // Start a transaction to process the refund
        const refundSession = await mongoose.startSession();
        refundSession.startTransaction();
        try {
            // Process the refund
            const refund = await stripe.refunds.create({
                payment_intent: invoice.payment_intent || invoice.id,
                reason: "requested_by_customer",
            });
            await Payment.create({
                user_id: stripeSub.metadata?.userId,
                subscription_id: null,
                price: invoice.amount_due / 100,
                status: "Pending Refund",
                paid_at: new Date(),
                transaction_id: invoice.payment_intent || invoice.id,
                payment_method: "stripe",
                refund_id: refund.id,
                failure_reason: "Payment failed for subscription renewal",
            }, { session: refundSession });
            await refundSession.commitTransaction();
        }
        catch (refundError) {
            console.error("Error in process refund: ", refundError);
            await refundSession.abortTransaction();
        }
        finally {
            refundSession.endSession();
        }

        await session.abortTransaction();
    } finally {
        session.endSession();
    }
};

const handleEnterpriseCheckoutSessionCompleted = async (sessionObj) => {
    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
        const customPlanId = new URL(sessionObj.success_url).searchParams.get("customPlanId");
        const user = await User.findOne({ email: sessionObj.customer_email });
        const customPlan = await CustomPlan.findById(customPlanId);
        if (!user || !customPlan) throw new Error("Custom plan or user not found");

        await CustomPlan.findByIdAndUpdate(
            customPlanId,
            { status: "paid", paymentIntentId: sessionObj.payment_intent, paidAt: new Date() },
            { session: dbSession }
        );

        const subscription = await Subscription.findOneAndUpdate(
            { user_id: user._id },
            {
                plan_name: "Custom Enterprise Plan",
                plan_price: sessionObj.amount_total / 100,
                start_date: new Date(),
                end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                renewal_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                max_editors: customPlan.maxEditors,
                max_viewers: customPlan.maxViewers,
                max_rfp_proposal_generations: customPlan.maxRFPProposalGenerations,
                max_grant_proposal_generations: customPlan.maxGrantProposalGenerations,
                auto_renewal: false,
                stripeSubscriptionId: sessionObj.payment_intent || null,
                stripePriceId: sessionObj.metadata.planPriceId || null,
                stripeProductId: sessionObj.metadata.planProductId || null,
            },
            { upsert: true, new: true, session: dbSession }
        );

        await Payment.create(
            [
                {
                    user_id: user._id,
                    subscription_id: subscription._id,
                    companyName: user.fullName,
                    price: sessionObj.amount_total / 100,
                    status: "Success",
                    paid_at: new Date(),
                    transaction_id: sessionObj.payment_intent,
                    payment_method: "stripe",
                },
            ],
            { session: dbSession }
        );

        await dbSession.commitTransaction();

        await sendEmail(
            user.email,
            "Enterprise Plan Activated",
            `<p>Your custom enterprise plan has been successfully activated.</p>`
        );
    } catch (err) {
        await dbSession.abortTransaction();
    } finally {
        dbSession.endSession();
    }
};

const handleEnterpriseCheckoutSessionFailed = async (session) => {
    try {
        const customPlanId = new URL(session.cancel_url).searchParams.get("customPlanId");
        if (customPlanId) {
            await CustomPlan.findByIdAndUpdate(customPlanId, { status: "failed" });
        }
    } catch (err) {
        console.error("Error in handleEnterpriseCheckoutSessionFailed: ", err);
    } finally {
        return;
    }
};

const handleWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const { type, data } = event;
    const object = data.object;

    try {
        switch (type) {
            case "checkout.session.completed":
                if (object.mode === "subscription") {
                    //We will handle the subscription activation in invoice.paid event
                } else {
                    //if the event custom plan checkout session completed
                    await handleEnterpriseCheckoutSessionCompleted(object);
                }
                break;

            case "checkout.session.async_payment_failed":
            case "checkout.session.expired":
                await handleEnterpriseCheckoutSessionFailed(object);
                break;

            case "checkout.session.async_payment_succeeded":
                if (object.mode !== "subscription") {
                    await handleEnterpriseCheckoutSessionCompleted(object);
                }
                break;

            case "invoice.paid":
            case "invoice.payment_failed":
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
                await handleSubscriptionWebhook(event);
                break;

            case "price.created":
            case "price.updated":
            case "price.deleted":
                await handlePriceUpdate(object, type.replace("price.", ""));
                break;

            case "product.updated":
                await handleProductUpdate(object);
                break;

            default:
                console.log("Rejected webhook: ", type);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error("Error in handleWebhook: ", err);
        return res.status(500).json({ error: "Webhook processing failed", message: err.message });
    }
};

const handlePriceUpdate = async (price, eventType = "updated") => {
    try {
        const amount = price.unit_amount / 100;
        const priceId = price.id;

        const plan = await SubscriptionPlan.findOne({
            $or: [{ monthlyPriceId: priceId }, { yearlyPriceId: priceId }],
        });
        if (!plan) return;

        const updateField = plan.monthlyPriceId === priceId ? "monthlyPrice" : "yearlyPrice";
        if (plan[updateField] === amount) return;

        await SubscriptionPlan.findByIdAndUpdate(plan._id, { [updateField]: amount });
        await Notification.create({
            type: "Price Update",
            title: `Stripe Price ${eventType}`,
            description: `Plan ${plan.name} (${updateField}) updated to $${amount}`,
            created_at: new Date(),
        });
    } catch (err) {
        console.error("handlePriceUpdate error:", err.message);
    }
};

const handleProductUpdate = async (product) => {
    console.log("Product updated: ", product);
};

module.exports = {
    createPaymentIntent,
    handleWebhook,
    activateSubscription,
    syncPricesFromStripe,
};
