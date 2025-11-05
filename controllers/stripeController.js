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

// Stripe Configuration
const STRIPE_CONFIG = {
    BILLING_CYCLES: {
        MONTHLY: 'monthly',
        YEARLY: 'yearly'
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
                    console.warn(`Plan ${plan.name} does not have Stripe price IDs configured`);
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
                        console.error(`Error fetching monthly price for ${plan.name}:`, error.message);
                        errors.push(`Failed to fetch monthly price for ${plan.name}: ${error.message}`);
                    }
                }

                // Fetch yearly price from Stripe if available
                if (plan.yearlyPriceId) {
                    try {
                        const stripePrice = await stripe.prices.retrieve(plan.yearlyPriceId);
                        yearlyPrice = stripePrice.unit_amount / 100; // Convert from cents to dollars
                    } catch (error) {
                        console.error(`Error fetching yearly price for ${plan.name}:`, error.message);
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
                console.error(`Error syncing plan ${plan.name}:`, error);
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
        console.error('Error syncing prices from Stripe:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to sync prices from Stripe',
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
                await stripe.customers.retrieve(stripeCustomerId);
            } catch (stripeError) {
                // If customer doesn't exist (404) or is deleted, create a new one
                if (stripeError.code === 'resource_missing' || stripeError.statusCode === 404) {
                    console.log(`Customer ${stripeCustomerId} not found in Stripe, creating new customer`);
                    stripeCustomerId = null; // Reset to create new customer
                } else {
                    // For other errors, log and continue to try creating a new customer
                    console.error('Error verifying Stripe customer:', stripeError.message);
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
                console.error('Stripe customer creation failed:', stripeError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create customer account'
                });
            }
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
                        billingCycle: billingCycle
                    }
                },
                success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${frontendUrl}/payment-cancel`,
                metadata: {
                    userId: userId.toString(),
                    planId: planId.toString(),
                    planName: plan.name,
                    billingCycle: billingCycle
                }
            });
        } catch (stripeError) {
            console.error('Stripe checkout session creation failed:', stripeError);
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
        console.error('Error creating checkout session:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create checkout session',
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
            console.error('Stripe payment intent retrieval failed:', stripeError);
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
                console.error('Failed to process refund:', refundError);

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
        console.error('Error activating subscription:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to activate subscription',
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
            console.error('Stripe payment intent retrieval failed:', stripeError);
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
            console.error('Stripe refund creation failed:', stripeError);
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
        console.error('Error processing manual refund:', error);
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
            console.error('Stripe refunds list failed:', stripeError);
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
        console.error('Error getting refund status:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get refund status',
            error: error
        });
    }
};

// Helper function to activate subscription from Stripe subscription object
const activateSubscriptionFromStripe = async (stripeSubscription, invoice = null) => {
    try {
        // Get subscription details from Stripe (handle both subscription object and ID string)
        const subscriptionId = typeof stripeSubscription === 'string' ? stripeSubscription : stripeSubscription.id;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['default_payment_method', 'items.data.price.product']
        });

        // Get metadata
        const userId = subscription.metadata.userId;
        const planId = subscription.metadata.planId;
        const billingCycle = subscription.metadata.billingCycle;

        if (!userId || !planId || !billingCycle) {
            throw new Error('Missing required metadata in subscription');
        }

        // Get plan from database
        const plan = await SubscriptionPlan.findById(planId);
        if (!plan) {
            throw new Error('Plan not found in database');
        }

        // Get user
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Determine price from subscription
        const priceId = subscription.items.data[0]?.price?.id;
        const priceAmount = subscription.items.data[0]?.price?.unit_amount || 0;
        const planPrice = priceAmount / 100; // Convert from cents

        // Calculate subscription dates from Stripe subscription
        const startDate = new Date(subscription.current_period_start * 1000);
        const endDate = new Date(subscription.current_period_end * 1000);
        const renewalDate = new Date(subscription.current_period_end * 1000);

        // Check for existing subscription
        const existingSubscription = await Subscription.findOne({ user_id: userId });

        let newMaxRfp = plan.maxRFPProposalGenerations;
        let newMaxGrant = plan.maxGrantProposalGenerations;

        // Carry over unused quotas if subscription exists
        if (existingSubscription && existingSubscription.stripeSubscriptionId !== subscription.id) {
            const unusedRfp =
                (existingSubscription.max_rfp_proposal_generations -
                    existingSubscription.current_rfp_proposal_generations) || 0;
            const unusedGrant =
                (existingSubscription.max_grant_proposal_generations -
                    existingSubscription.current_grant_proposal_generations) || 0;

            newMaxRfp += unusedRfp;
            newMaxGrant += unusedGrant;
        }

        // Use transaction for data consistency
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Update or create subscription
            const dbSubscription = await Subscription.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        plan_name: plan.name,
                        plan_price: planPrice,
                        start_date: startDate,
                        end_date: endDate,
                        renewal_date: renewalDate,
                        max_editors: plan.maxEditors,
                        max_viewers: plan.maxViewers,
                        current_rfp_proposal_generations: existingSubscription?.current_rfp_proposal_generations || 0,
                        current_grant_proposal_generations: existingSubscription?.current_grant_proposal_generations || 0,
                        max_rfp_proposal_generations: newMaxRfp,
                        max_grant_proposal_generations: newMaxGrant,
                        canceled_at: null,
                        auto_renewal: true, // Enable auto-renewal
                        stripeSubscriptionId: subscription.id,
                        stripePriceId: priceId
                    }
                },
                { upsert: true, new: true, session }
            );

            // Update user subscription status
            await User.findByIdAndUpdate(userId, {
                subscription_status: 'active',
                subscription_id: dbSubscription._id
            }, { session });

            // Update company profile subscription status
            await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Active' }, { session });

            // Create payment record if invoice is provided
            if (invoice) {
                await Payment.create([{
                    user_id: userId,
                    subscription_id: dbSubscription._id,
                    price: planPrice,
                    status: 'Success',
                    paid_at: new Date(invoice.status_transitions.paid_at * 1000),
                    transaction_id: invoice.payment_intent || invoice.id,
                    companyName: user.fullName,
                    payment_method: 'stripe',
                }], { session });
            }

            await session.commitTransaction();

            // Send notification
            const notification = new Notification({
                type: "Subscription",
                title: "Subscription activated",
                description: `A subscription has been activated for ${user.email} for the plan ${plan.name}`,
                created_at: new Date(),
            });
            await notification.save();

            // Send email if this is a new subscription (not a renewal)
            if (!existingSubscription || existingSubscription.stripeSubscriptionId !== subscription.id) {
                const { subject, body } = await emailTemplates.getPaymentSuccessEmail(
                    user.fullName,
                    plan.name,
                    planPrice,
                    billingCycle,
                    startDate,
                    endDate
                );

                await sendEmail(user.email, subject, body);
            }

            return { success: true, subscription: dbSubscription };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Error activating subscription from Stripe:', error);
        throw error;
    }
};

// Handle subscription webhook events
const handleSubscriptionWebhook = async (event) => {
    try {
        const subscription = event.data.object;

        switch (event.type) {
            case 'checkout.session.completed':
                // Handle checkout session completion
                const session = subscription;
                if (session.mode === 'subscription' && session.subscription) {
                    // Pass subscription ID string directly
                    await activateSubscriptionFromStripe(session.subscription);
                }
                break;

            case 'invoice.paid':
                // Handle successful subscription renewal payment
                const invoice = subscription;
                if (invoice.subscription) {
                    // Pass subscription ID string directly
                    await activateSubscriptionFromStripe(invoice.subscription, invoice);
                }
                break;

            case 'invoice.payment_failed':
                // Handle failed payment
                const failedInvoice = subscription;
                if (failedInvoice.subscription) {
                    const stripeSubscription = await stripe.subscriptions.retrieve(failedInvoice.subscription, {
                        expand: ['metadata']
                    });
                    const userId = stripeSubscription.metadata?.userId;

                    if (userId) {
                        // Update subscription status
                        await Subscription.findOneAndUpdate(
                            { stripeSubscriptionId: stripeSubscription.id },
                            { $set: { auto_renewal: false } }
                        );

                        // Update user and company profile status
                        await User.findByIdAndUpdate(userId, { subscription_status: 'past_due' });
                        await CompanyProfile.findOneAndUpdate({ userId }, { status: 'Past Due' });

                        // Create failed payment record
                        await Payment.create({
                            user_id: userId,
                            price: failedInvoice.amount_due / 100,
                            status: 'Failed',
                            paid_at: new Date(),
                            transaction_id: failedInvoice.payment_intent || failedInvoice.id,
                            payment_method: 'stripe',
                            failure_reason: 'Payment failed for subscription renewal'
                        });
                    }
                }
                break;

            case 'customer.subscription.updated':
                // Handle subscription updates (e.g., plan changes, cancellations)
                const updatedSubscription = subscription;
                const updatedUserId = updatedSubscription.metadata?.userId;

                if (updatedUserId) {
                    if (updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing') {
                        await activateSubscriptionFromStripe(updatedSubscription);
                    } else if (updatedSubscription.status === 'canceled' || updatedSubscription.status === 'unpaid') {
                        await Subscription.findOneAndUpdate(
                            { stripeSubscriptionId: updatedSubscription.id },
                            {
                                $set: {
                                    auto_renewal: false,
                                    canceled_at: new Date()
                                }
                            }
                        );

                        await User.findByIdAndUpdate(updatedUserId, { subscription_status: 'inactive' });
                        await CompanyProfile.findOneAndUpdate({ userId: updatedUserId }, { status: 'Inactive' });
                    }
                }
                break;

            case 'customer.subscription.deleted':
                // Handle subscription cancellation
                const deletedSubscription = subscription;
                const deletedUserId = deletedSubscription.metadata?.userId;

                if (deletedUserId) {
                    await Subscription.findOneAndUpdate(
                        { stripeSubscriptionId: deletedSubscription.id },
                        {
                            $set: {
                                auto_renewal: false,
                                canceled_at: new Date()
                            }
                        }
                    );

                    await User.findByIdAndUpdate(deletedUserId, { subscription_status: 'inactive' });
                    await CompanyProfile.findOneAndUpdate({ userId: deletedUserId }, { status: 'Inactive' });
                }
                break;

            default:
                console.log(`Unhandled subscription event type: ${event.type}`);
        }
    } catch (error) {
        console.error('Error handling subscription webhook:', error);
        throw error;
    }
};

// Handle price update/creation events from Stripe
// Note: In Stripe, you cannot change the amount of an existing price.
// When updating a price amount, you must create a new price and update the plan's price ID.
// This handler will sync price changes when prices are updated or newly created.
const handlePriceUpdate = async (price, eventType = 'updated') => {
    try {
        const priceId = price.id;
        const newPriceAmount = price.unit_amount ? price.unit_amount / 100 : null; // Convert from cents to dollars

        if (newPriceAmount === null) {
            console.log(`Price ${priceId} has no unit_amount, skipping sync`);
            return { success: false, message: 'Price has no unit_amount' };
        }

        console.log(`Processing price ${eventType} for price ID: ${priceId}, amount: $${newPriceAmount}`);

        // Find subscription plan that uses this price ID
        const plan = await SubscriptionPlan.findOne({
            $or: [
                { monthlyPriceId: priceId },
                { yearlyPriceId: priceId }
            ]
        });

        if (!plan) {
            console.log(`No subscription plan found for price ID: ${priceId}. This may be a new price that needs to be linked to a plan.`);
            return {
                success: false,
                message: 'No subscription plan found for this price ID. Please link the price ID to a subscription plan in the database.'
            };
        }

        // Determine if this is a monthly or yearly price
        const updateData = {};
        let priceType = '';
        let oldPriceId = null;
        let oldPrice = null;

        if (plan.monthlyPriceId === priceId) {
            updateData.monthlyPrice = newPriceAmount;
            priceType = 'monthly';
            oldPriceId = plan.monthlyPriceId;
            oldPrice = plan.monthlyPrice;
        } else if (plan.yearlyPriceId === priceId) {
            updateData.yearlyPrice = newPriceAmount;
            priceType = 'yearly';
            oldPriceId = plan.yearlyPriceId;
            oldPrice = plan.yearlyPrice;
        }

        // Only update if price has changed
        if (oldPrice === newPriceAmount) {
            console.log(`Price for plan "${plan.name}" (${priceType}) is already $${newPriceAmount}, no update needed`);
            return {
                success: true,
                message: 'Price already synchronized',
                planName: plan.name,
                priceType,
                price: newPriceAmount
            };
        }

        // Update all active Stripe subscriptions to use the new price BEFORE updating the plan
        // This ensures customers are charged the latest price on their next renewal
        let updatedSubscriptions = 0;
        let subscriptionErrors = [];

        // Only update subscriptions if the price ID actually changed (new price created)
        if (oldPriceId && oldPriceId !== priceId) {
            try {
                // Find all active subscriptions in our database that use this plan
                const activeSubscriptions = await Subscription.find({
                    plan_name: plan.name,
                    canceled_at: null,
                    stripeSubscriptionId: { $ne: null }
                });

                for (const dbSubscription of activeSubscriptions) {
                    try {
                        // Retrieve the Stripe subscription to check its current price
                        const stripeSubscription = await stripe.subscriptions.retrieve(dbSubscription.stripeSubscriptionId);

                        // Check if this subscription uses the old price ID
                        const currentPriceId = stripeSubscription.items.data[0]?.price?.id;

                        // Update subscription if it's using the old price
                        if (currentPriceId === oldPriceId) {
                            // Update the subscription to use the new price
                            await stripe.subscriptions.update(stripeSubscription.id, {
                                items: [{
                                    id: stripeSubscription.items.data[0].id,
                                    price: priceId, // Use the new price ID
                                }],
                                proration_behavior: 'none' // Don't prorate, charge new price on next renewal
                            });

                            // Update our database with the new price ID
                            await Subscription.findByIdAndUpdate(dbSubscription._id, {
                                stripePriceId: priceId,
                                plan_price: newPriceAmount
                            });

                            updatedSubscriptions++;
                            console.log(`Updated subscription ${stripeSubscription.id} to use new price ${priceId} ($${oldPrice} -> $${newPriceAmount})`);
                        }
                    } catch (subError) {
                        console.error(`Error updating subscription ${dbSubscription.stripeSubscriptionId}:`, subError.message);
                        subscriptionErrors.push(`Failed to update subscription ${dbSubscription.stripeSubscriptionId}: ${subError.message}`);
                    }
                }
            } catch (error) {
                console.error('Error updating subscriptions:', error);
                subscriptionErrors.push(`Error updating subscriptions: ${error.message}`);
            }
        }

        // Update the plan in database AFTER updating subscriptions
        await SubscriptionPlan.findByIdAndUpdate(plan._id, updateData);

        console.log(`Successfully ${eventType === 'created' ? 'synced' : 'updated'} ${priceType} price for plan "${plan.name}" from $${oldPrice} to $${newPriceAmount}. Updated ${updatedSubscriptions} active subscription(s).`);

        // Create notification
        const notification = new Notification({
            type: "Price Update",
            title: `Price ${eventType === 'created' ? 'synced' : 'updated'}`,
            description: `Price for plan "${plan.name}" (${priceType}) has been ${eventType === 'created' ? 'synced' : 'updated'} to $${newPriceAmount} in Stripe. ${updatedSubscriptions} active subscription(s) updated to use new price on next renewal.`,
            created_at: new Date(),
        });
        await notification.save();

        return {
            success: true,
            message: `Price ${eventType === 'created' ? 'synced' : 'updated'} for plan "${plan.name}"`,
            planName: plan.name,
            priceType,
            oldPrice,
            newPrice: newPriceAmount,
            updatedSubscriptions,
            subscriptionErrors: subscriptionErrors.length > 0 ? subscriptionErrors : undefined
        };
    } catch (error) {
        console.error('Error handling price update:', error);
        throw error;
    }
};

module.exports = {
    createPaymentIntent,
    activateSubscription,
    processManualRefund,
    getRefundStatus,
    syncPricesFromStripe,
    handleSubscriptionWebhook,
    activateSubscriptionFromStripe,
    handlePriceUpdate
};
