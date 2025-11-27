const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Payment = require('../models/Payments');
const CompanyProfile = require('../models/CompanyProfile');
const { queueEmail } = require('../utils/mailSender');
const emailTemplates = require('../utils/emailTemplates');
const CustomPlan = require('../models/CustomPlan');
const AddOnPlan = require('../models/AddOnPlan');

const STRIPE_CONFIG = {
    BILLING_CYCLES: {
        MONTHLY: 'monthly',
        YEARLY: 'yearly'
    }
};


const getPaymentIntentId = (maybeCheckoutSession = {}, maybeInvoiceOrObject = {}) => {
    const candidate = maybeCheckoutSession.payment_intent ?? maybeInvoiceOrObject.payment_intent ?? maybeCheckoutSession.id ?? maybeInvoiceOrObject.id;
    if (!candidate) return null;
    return typeof candidate === 'string' ? candidate : (candidate.id ? String(candidate.id) : String(candidate));
};

const safeCreateRefund = async (opts = {}) => {
    const { payment_intent, charge, reason = 'requested_by_customer', metadata = {} } = opts;
    try {
        const lookupId = payment_intent || charge;
        if (!lookupId) return null;

        if (payment_intent) {
            const existing = await stripe.refunds.list({ payment_intent });
            if (existing && existing.data && existing.data.length > 0) {
                return existing.data[0];
            }
        } else if (charge) {
            const existing = await stripe.refunds.list({ charge });
            if (existing && existing.data && existing.data.length > 0) {
                return existing.data[0];
            }
        }

        const refundParams = {
            reason,
            metadata
        };
        if (payment_intent) refundParams.payment_intent = payment_intent;
        if (charge) refundParams.charge = charge;

        const refund = await stripe.refunds.create(refundParams);
        return refund;
    } catch (err) {
        console.error('safeCreateRefund error:', err.message || err);
        return null;
    }
};

const ensureStripeCustomer = async (user) => {
    if (!user) throw new Error('User required for ensureStripeCustomer');
    let stripeCustomerId = user.stripeCustomerId;
    if (stripeCustomerId) {
        try {
            const customer = await stripe.customers.retrieve(stripeCustomerId);
            if (!customer || customer.deleted) stripeCustomerId = null;
        } catch (err) {
            stripeCustomerId = null;
        }
    }

    if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
            email: user.email,
            metadata: { userId: user._id.toString() }
        });
        stripeCustomerId = customer.id;
        user.stripeCustomerId = stripeCustomerId;
        await user.save();
    }

    return stripeCustomerId;
};

const notifyAddOnSuccess = async ({ user, companyProfile, addOn }) => {
    try {
        await Notification.create({
            type: "Add-On",
            title: "Add-on activated",
            description: `Add-on "${addOn.name}" has been activated for ${user.email}`,
            created_at: new Date(),
        });

        try {
            const { subject, body } = await emailTemplates.getAddOnActivatedEmail
                ? await emailTemplates.getAddOnActivatedEmail(user.fullName, addOn.name, addOn.price)
                : { subject: `Add-on "${addOn.name}" activated`, body: `Hello ${user.fullName},\n\nYour add-on "${addOn.name}" has been activated.` };

            queueEmail(user.email, subject, body, 'addOnActivated');
        } catch (emailErr) {
            console.error('Failed to queue add-on success email:', emailErr.message || emailErr);
        }
    } catch (err) {
        console.error('notifyAddOnSuccess error:', err.message || err);
    }
};

const createPaymentRecord = async ({
    session,
    user_id,
    subscription_id = null,
    price = 0,
    status = 'Success',
    paid_at = new Date(),
    transaction_id = null,
    planName = null,
    companyName = null,
    payment_method = 'stripe',
    refund_id = null,
    failure_reason = null,
}) => {
    const record = {
        user_id,
        subscription_id,
        price,
        status,
        paid_at,
        transaction_id,
        planName,
        companyName,
        payment_method,
    };
    if (refund_id) record.refund_id = refund_id;
    if (failure_reason) record.failure_reason = failure_reason;

    if (session) {
        return await Payment.create([record], { session });
    } else {
        return await Payment.create(record);
    }
};

const processManualRefund = async (req, res) => {
    try {
        const { paymentIntentId, reason, amount } = req.body;
        const userId = req.user._id;

        if (!paymentIntentId || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: paymentIntentId, reason'
            });
        }

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

        const refundData = {
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: {
                reason: reason,
                refundedBy: userId.toString(),
                refundedAt: new Date().toISOString()
            }
        };

        if (amount && amount > 0) {
            refundData.amount = Math.round(amount * 100);
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

            await User.findByIdAndUpdate(subscription.user_id, { subscription_status: 'inactive' });

            await CompanyProfile.findOneAndUpdate({ userId: subscription.user_id }, { status: 'Inactive' });
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

const getRefundStatus = async (req, res) => {
    try {
        const { paymentIntentId } = req.params;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                message: 'Payment intent ID is required'
            });
        }

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

const sendRefundNotification = async (user, plan, refundId, errorMessage) => {
    try {
        const { subject, body } = await emailTemplates.getRefundNotificationEmail(
            user.fullName,
            plan.name,
            refundId,
            errorMessage
        );

        queueEmail(user.email, subject, body, 'refundNotification');
    } catch (emailError) {
        console.error('Failed to queue refund notification email:', emailError);
    }
};

const syncPricesFromStripe = async (req, res) => {
    try {
        const plans = await SubscriptionPlan.find();
        if (!plans.length) {
            return res.status(404).json({
                success: false,
                message: "No subscription plans found"
            });
        }

        let updated = 0;
        let errors = [];

        for (const plan of plans) {
            try {
                const monthlyProduct = await stripe.products.retrieve(plan.stripeProductMonthlyId);
                const yearlyProduct = await stripe.products.retrieve(plan.stripeProductYearlyId);

                if (!monthlyProduct?.default_price || !yearlyProduct?.default_price) {
                    errors.push(`Product missing default price for plan: ${plan.name}`);
                    continue;
                }

                const monthlyPriceId = monthlyProduct.default_price;
                const yearlyPriceId = yearlyProduct.default_price;

                const monthlyPriceObj = await stripe.prices.retrieve(monthlyPriceId);
                const yearlyPriceObj = await stripe.prices.retrieve(yearlyPriceId);

                const monthlyAmount = (monthlyPriceObj.unit_amount || 0) / 100;
                const yearlyAmount = (yearlyPriceObj.unit_amount || 0) / 100;

                await SubscriptionPlan.findByIdAndUpdate(plan._id, {
                    monthlyPriceId,
                    yearlyPriceId,
                    monthlyPrice: monthlyAmount,
                    yearlyPrice: yearlyAmount
                });

                updated++;

            } catch (err) {
                errors.push(`Failed syncing plan ${plan.name}: ${err.message}`);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Synced ${updated} plan(s) successfully`,
            updated,
            errors
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed syncing prices from Stripe",
            error: err.message
        });
    }
};

const activateSubscription = async (req, res) => {
    try {
        const { paymentIntentId, planId, billingCycle } = req.body;
        const userId = req.user._id;

        if (!paymentIntentId || !planId || !billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: paymentIntentId, planId, billingCycle'
            });
        }

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

        if (paymentIntent.metadata.userId !== userId) {
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

        const plan = await SubscriptionPlan.findById(planId);

        if (!plan) {
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

        if (paymentIntent.metadata.planId !== planId || paymentIntent.metadata.billingCycle !== billingCycle) {
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

        const session = await mongoose.startSession();
        session.startTransaction();

        let refundId = null;
        let subscription = null;

        try {
            const subscriptionRes = await Subscription.findOneAndUpdate(
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
                        current_rfp_proposal_generations: 0,
                        current_grant_proposal_generations: 0,
                        max_rfp_proposal_generations: newMaxRfp,
                        max_grant_proposal_generations: newMaxGrant,
                        canceled_at: null,
                        auto_renewal: true,
                        stripeSubscriptionId: paymentIntent.id,
                        stripePriceId: paymentIntent.metadata.planPriceId || null
                    }
                },
                { upsert: true, new: true, session }
            );

            subscription = subscriptionRes;

            await User.findByIdAndUpdate(userId, {
                subscription_status: 'active',
                subscription_id: subscription._id
            }, { session });

            const companyProfile = await CompanyProfile.findOne({ userId: userId }).session(session);
            if (companyProfile) {
                await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Active' }, { session });
            }

            const companyNameForPayment = (companyProfile && companyProfile.companyName) ? companyProfile.companyName : req.user.fullName;

            await createPaymentRecord({
                session,
                user_id: userId,
                subscription_id: subscription._id,
                price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                status: 'Success',
                paid_at: new Date(),
                transaction_id: getPaymentIntentId(paymentIntent, paymentIntent),
                planName: plan.name,
                companyName: companyNameForPayment,
                payment_method: 'stripe'
            });

            await session.commitTransaction();
        } catch (error) {
            await session.abortTransaction();

            try {
                const piCandidate = typeof paymentIntent.id === 'string' ? paymentIntent.id : (paymentIntent.id || paymentIntent);
                const paymentIntentId = getPaymentIntentId(paymentIntent, paymentIntent);

                const refund = await safeCreateRefund({
                    payment_intent: paymentIntentId,
                    reason: 'requested_by_customer',
                    metadata: {
                        reason: 'database_transaction_failed',
                        userId: userId.toString(),
                        planId: planId,
                        error: error.message
                    }
                });

                refundId = refund ? refund.id : null;

                const companyProfile = await CompanyProfile.findOne({ userId: userId });
                const companyNameForPayment = (companyProfile && companyProfile.companyName) ? companyProfile.companyName : req.user.fullName;

                await createPaymentRecord({
                    session: null,
                    user_id: userId,
                    subscription_id: null,
                    price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                    status: refund ? 'Pending Refund' : 'Failed - Refund Required',
                    paid_at: new Date(),
                    transaction_id: getPaymentIntentId(paymentIntent, paymentIntent),
                    refund_id: refundId,
                    companyName: companyNameForPayment,
                    payment_method: 'stripe',
                    failure_reason: error.message
                });

                if (refund) {
                    await sendRefundNotification(req.user, plan, refundId, error.message);
                } else {
                    console.error('Refund failed to create for paymentIntent:', getPaymentIntentId(paymentIntent, paymentIntent));
                }
            } catch (refundError) {
                try {
                    const companyProfile = await CompanyProfile.findOne({ userId: userId });
                    const companyNameForPayment = (companyProfile && companyProfile.companyName) ? companyProfile.companyName : req.user.fullName;

                    await createPaymentRecord({
                        session: null,
                        user_id: userId,
                        subscription_id: null,
                        price: billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY ? plan.yearlyPrice : plan.monthlyPrice,
                        status: 'Failed - Refund Required',
                        paid_at: new Date(),
                        transaction_id: getPaymentIntentId(paymentIntent, paymentIntent),
                        companyName: companyNameForPayment,
                        payment_method: 'stripe',
                        failure_reason: `Database error: ${error.message}. Refund failed: ${refundError.message}`
                    });
                    await CompanyProfile.findOneAndUpdate({ userId: userId }, { status: 'Inactive' });
                } catch (innerErr) {
                    console.error('Failed to create fallback payment record after refund failure:', innerErr.message || innerErr);
                }
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

        queueEmail(req.user.email, subject, body, 'paymentSuccess');

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

const createPaymentIntent = async (req, res) => {
    try {
        const { planId, billingCycle } = req.body;
        const userId = req.user._id;

        if (req.user.role !== 'company') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to create payment intent'
            });
        }

        if (!planId || !billingCycle) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: planId, billingCycle'
            });
        }
        if (!Object.values(STRIPE_CONFIG.BILLING_CYCLES).includes(billingCycle)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid billing cycle. Must be "monthly" or "yearly"'
            });
        }
        const plan = await SubscriptionPlan.findById(planId);
        if (!plan) {
            return res.status(400).json({
                success: false,
                message: 'Plan not found'
            });
        }
        const stripePriceId = billingCycle === STRIPE_CONFIG.BILLING_CYCLES.YEARLY
            ? plan.yearlyPriceId
            : plan.monthlyPriceId;
        if (!stripePriceId) {
            return res.status(400).json({
                success: false,
                message: `Stripe price ID not configured for ${billingCycle} billing cycle`
            });
        }
        let user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let stripeCustomerId;
        try {
            stripeCustomerId = await ensureStripeCustomer(user);
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create customer account'
            });
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
        const product = await stripe.products.retrieve(stripeProductId);
        if (!product) {
            return res.status(400).json({
                success: false,
                message: 'Product not found'
            });
        }
        let checkoutSession;
        try {
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
            return res.status(500).json({
                success: false,
                message: `Failed to create checkout session: ${stripeError.message}`
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
                if (stripeObject?.mode === "payment") {
                    await activateAddOnSubscription(stripeObject);
                } else {
                    const invoice = stripeObject;
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
                }
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

                    let planName = null;
                    if (!stripeSub.metadata?.planName && stripeSub.metadata?.planId) {
                        const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.metadata?.planId }, { plan_name: 1 });
                        planName = subscription?.plan_name || null;
                    } else {
                        planName = stripeSub.metadata?.planName || null;
                    }

                    await Payment.create(
                        [
                            {
                                user_id: userId,
                                subscription_id: null,
                                price: invoice.amount_due / 100,
                                status: "Failed",
                                planName: planName || null,
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

        const existingSubscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
        });

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
                max_magic_brush_usage: plan.maxMagicBrushUsage,
                max_image_generation_usage: plan.maxImageGenerationUsage,
                current_rfp_proposal_generations: 0,
                current_grant_proposal_generations: 0,
                current_magic_brush_usage: 0,
                current_image_generation_usage: 0,
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
                { subscription_status: "active", subscription_id: dbSub._id, stripeSubscriptionId: stripeSub.id },
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
                        planName: planName || null,
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

        await Promise.all(
            existingSubscriptions.data.map(async (sub) => {
                if (sub.id !== stripeSub.id) {
                    try {
                        await stripe.subscriptions.cancel(sub.id);
                    } catch (err) {
                        console.error("Error cancelling old subscription:", err.message);
                    }
                }
            })
        );

        const { subject, body } = await emailTemplates.getPaymentSuccessEmail(
            user.fullName,
            plan.name,
            priceAmount,
            billingCycle,
            start,
            end
        );
        queueEmail(user.email, subject, body, 'paymentSuccess');
    } catch (err) {
        const refundSession = await mongoose.startSession();
        refundSession.startTransaction();
        let transactionId = null;

        try {
            const invoiceStatus = invoice.status || (await stripe.invoices.retrieve(invoice.id)).status;

            if (invoiceStatus !== "paid") {
                await refundSession.abortTransaction();
                return;
            }

            let refundParams = { reason: "requested_by_customer" };
            transactionId = invoice.id;

            if (invoice.payment_intent) {
                const pi = typeof invoice.payment_intent === "string"
                    ? invoice.payment_intent
                    : invoice.payment_intent.id;

                refundParams.payment_intent = pi;
                transactionId = pi;
            }

            else if (invoice.charge) {
                const charge = typeof invoice.charge === "string"
                    ? invoice.charge
                    : invoice.charge.id;

                refundParams.charge = charge;
                transactionId = charge;
            }

            else {
                const expandedInvoice = await stripe.invoices.retrieve(invoice.id, {
                    expand: ["payment_intent", "charge", "charge.payment_intent"],
                });

                if (expandedInvoice.payment_intent) {
                    const pi = typeof expandedInvoice.payment_intent === "string"
                        ? expandedInvoice.payment_intent
                        : expandedInvoice.payment_intent.id;

                    refundParams.payment_intent = pi;
                    transactionId = pi;
                } else if (expandedInvoice.charge) {
                    const chargeObj = expandedInvoice.charge;

                    if (chargeObj.payment_intent) {
                        const pi = typeof chargeObj.payment_intent === "string"
                            ? chargeObj.payment_intent
                            : chargeObj.payment_intent.id;

                        refundParams.payment_intent = pi;
                        transactionId = pi;
                    } else {
                        refundParams.charge = chargeObj.id;
                        transactionId = chargeObj.id;
                    }
                } else {
                    const customerId =
                        typeof stripeSub.customer === "string"
                            ? stripeSub.customer
                            : stripeSub.customer.id;

                    const charges = await stripe.charges.list({
                        customer: customerId,
                        limit: 10,
                    });

                    const invoiceDate = invoice.created || Math.floor(Date.now() / 1000);

                    const matchingCharge = charges.data.find((c) => {
                        const timeDiff = Math.abs(c.created - invoiceDate);
                        return c.amount === invoice.amount_due && timeDiff < 3600;
                    });

                    if (matchingCharge) {
                        if (matchingCharge.payment_intent) {
                            refundParams.payment_intent =
                                typeof matchingCharge.payment_intent === "string"
                                    ? matchingCharge.payment_intent
                                    : matchingCharge.payment_intent.id;

                            transactionId = refundParams.payment_intent;
                        } else {
                            refundParams.charge = matchingCharge.id;
                            transactionId = matchingCharge.id;
                        }
                    }
                }
            }

            if (!refundParams.payment_intent && !refundParams.charge) {
                let planName = null;
                if (!stripeSub.metadata?.planName && stripeSub.metadata?.planId) {
                    const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.metadata?.planId }, { plan_name: 1 });
                    planName = subscription?.plan_name || null;
                } else {
                    planName = stripeSub.metadata?.planName || null;
                }
                await Payment.create(
                    [
                        {
                            user_id: stripeSub.metadata?.userId,
                            subscription_id: null,
                            price: invoice.amount_due / 100,
                            planName: planName || null,
                            status: "Failed - Refund Required",
                            paid_at: new Date(),
                            transaction_id: invoice.id,
                            payment_method: "stripe",
                            failure_reason:
                                `Refund required but no payment_intent/charge found. Error: ${err.message}`,
                        },
                    ],
                    { session: refundSession }
                );

                await refundSession.commitTransaction();
                return;
            }

            const refund = await safeCreateRefund(refundParams);

            let planName = null;
            if (!stripeSub.metadata?.planName && stripeSub.metadata?.planId) {
                const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.metadata?.planId }, { plan_name: 1 });
                planName = subscription?.plan_name || null;
            } else {
                planName = stripeSub.metadata?.planName || null;
            }

            const paymentRecord = await Payment.create(
                [
                    {
                        user_id: stripeSub.metadata?.userId,
                        subscription_id: null,
                        price: invoice.amount_due / 100,
                        planName: planName || null,
                        status: "Pending Refund",
                        paid_at: new Date(),
                        transaction_id: transactionId,
                        payment_method: "stripe",
                        refund_id: refund?.id || null,
                        failure_reason: err.message,
                    },
                ],
                { session: refundSession }
            );

            await refundSession.commitTransaction();

            const userId = stripeSub.metadata?.userId;
            const planId = stripeSub.metadata?.planId;
            const user = await User.findById(userId);
            const plan = await SubscriptionPlan.findById(planId);
            if (!user || !plan || !transactionId) {
                return;
            }

            await sendRefundNotification(user, plan, transactionId, "Encountered an error while activating the subscription.");
        } catch (refundError) {
            await refundSession.abortTransaction();
        } finally {
            refundSession.endSession();
        }
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

        const existingSubscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
        });

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
                max_magic_brush_usage: customPlan.maxMagicBrushUsage,
                max_image_generation_usage: customPlan.maxImageGenerationUsage,
                auto_renewal: false,
                stripeSubscriptionId: sessionObj.payment_intent || null,
                stripePriceId: sessionObj.metadata.planPriceId || null,
                stripeProductId: sessionObj.metadata.planProductId || null,
            },
            { upsert: true, new: true, session: dbSession }
        );

        const companyProfile = await CompanyProfile.findOne({ userId: user._id });

        await Payment.create(
            [
                {
                    user_id: user._id,
                    subscription_id: subscription._id,
                    planName: "Custom Enterprise Plan",
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

        await Promise.all(
            existingSubscriptions.data.map(async (sub) => {
                if (sub.id !== sessionObj.payment_intent) {
                    try {
                        await stripe.subscriptions.cancel(sub.id);
                    } catch (err) {
                        console.error("Error cancelling old subscription:", err.message);
                    }
                }
            })
        );

        const { subject, body } = await emailTemplates.getEnterprisePaymentSuccessEmail(
            user.fullName,
            customPlan.planType || "Custom Enterprise Plan",
            sessionObj.amount_total / 100,
            customPlan.maxEditors,
            customPlan.maxViewers,
            customPlan.maxRFPProposalGenerations,
            customPlan.maxGrantProposalGenerations,
            customPlan.maxMagicBrushUsage,
            customPlan.maxImageGenerationUsage,
        );
        queueEmail(user.email, subject, body, 'enterprisePaymentSuccess');
    } catch (err) {
        await dbSession.abortTransaction();

        // Process refund if payment was Unsuccessful
        const refundSession = await mongoose.startSession();
        refundSession.startTransaction();

        try {
            let refundParams = { reason: "requested_by_customer" };
            let transactionId = sessionObj.id;

            if (sessionObj.payment_intent) {
                refundParams.payment_intent = typeof sessionObj.payment_intent === "string"
                    ? sessionObj.payment_intent
                    : sessionObj.payment_intent.id;
                transactionId = refundParams.payment_intent;
            } else {
                try {
                    const retrievedSession = await stripe.checkout.sessions.retrieve(sessionObj.id, {
                        expand: ["payment_intent"]
                    });

                    if (retrievedSession.payment_intent) {
                        const paymentIntentId = typeof retrievedSession.payment_intent === "string"
                            ? retrievedSession.payment_intent
                            : retrievedSession.payment_intent.id;
                        refundParams.payment_intent = paymentIntentId;
                        transactionId = paymentIntentId;
                    } else {
                        throw new Error("No payment_intent found on checkout session");
                    }
                } catch (retrieveError) {
                    throw new Error("Could not retrieve payment information for refund");
                }
            }

            const refund = await safeCreateRefund(refundParams);

            const customPlanId = sessionObj.success_url ? new URL(sessionObj.success_url).searchParams.get("customPlanId") : null;
            const user = sessionObj.customer_email ? await User.findOne({ email: sessionObj.customer_email }) : null;

            if (user) {
                await Payment.create(
                    [
                        {
                            user_id: user._id,
                            subscription_id: null,
                            price: (sessionObj.amount_total || 0) / 100,
                            planName: "Custom Enterprise Plan",
                            status: refund ? 'Pending Refund' : 'Failed - Refund Required',
                            paid_at: new Date(),
                            transaction_id: transactionId,
                            payment_method: "stripe",
                            refund_id: refund?.id || null,
                            failure_reason: `Enterprise plan activation failed: ${err.message}`,
                        },
                    ],
                    { session: refundSession }
                );
            }

            await refundSession.commitTransaction();

            const plan = await CustomPlan.findById(customPlanId);
            if (!customPlanId || !plan) {
                return;
            }
            if (user) {
                await sendRefundNotification(user, plan, sessionObj.payment_intent || sessionObj.id, `Encountered an error while activating the enterprise plan.`);
            }
        } catch (refundError) {
            try {
                const customPlanId = sessionObj.success_url ? new URL(sessionObj.success_url).searchParams.get("customPlanId") : null;
                const user = sessionObj.customer_email ? await User.findOne({ email: sessionObj.customer_email }) : null;

                if (user) {
                    await Payment.create(
                        [
                            {
                                user_id: user._id,
                                subscription_id: null,
                                price: (sessionObj.amount_total || 0) / 100,
                                planName: "Custom Enterprise Plan",
                                status: "Failed - Refund Required",
                                paid_at: new Date(),
                                transaction_id: sessionObj.payment_intent || sessionObj.id,
                                payment_method: "stripe",
                                failure_reason: `Enterprise plan activation failed. Refund required but could not process: ${refundError.message}. Original error: ${err.message}`,
                            },
                        ],
                        { session: refundSession }
                    );
                    await refundSession.commitTransaction();

                    const plan = await CustomPlan.findById(customPlanId);
                    await sendRefundNotification(user, plan, sessionObj.payment_intent || sessionObj.id, `Enterprise plan activation failed. Refund required but could not process. Manual refund required.`);
                } else {
                    await refundSession.abortTransaction();
                }
            } catch (paymentRecordError) {
                await refundSession.abortTransaction();
            }
        } finally {
            refundSession.endSession();
        }
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
                    //Do nothing
                } else if (object.mode === "payment") {
                    await activateAddOnSubscription(object);
                } else {
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

            case "product.updated":
                await handleProductUpdate(object);
                break;

            case "price.created":
            case "price.updated":
                await handlePriceUpdate(object);
                break;

            case "invoice.paid":
            case "invoice.payment_failed":
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
                await handleSubscriptionWebhook(event);
                break;

            default:
                console.log("Unhandled webhook: ", type);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        return res.status(500).json({ error: "Webhook processing failed", message: `Webhook processing failed: ${err.message}` });
    }
};

const handlePriceUpdate = async (price) => {
    try {
        const priceId = price.id;

        const product = await stripe.products.retrieve(price.product);
        if (!product.default_price) return;

        if (product.default_price !== priceId) return;

        const plan = await SubscriptionPlan.findOne({
            $or: [
                { stripeProductMonthlyId: product.id },
                { stripeProductYearlyId: product.id }
            ]
        });

        if (!plan) return;

        const amount = price.unit_amount / 100;

        if (plan.stripeProductMonthlyId === product.id) {
            await SubscriptionPlan.findByIdAndUpdate(plan._id, {
                monthlyPrice: amount,
                monthlyPriceId: priceId
            });
        }

        if (plan.stripeProductYearlyId === product.id) {
            await SubscriptionPlan.findByIdAndUpdate(plan._id, {
                yearlyPrice: amount,
                yearlyPriceId: priceId
            });
        }

        console.log(`Price synced for ${plan.name}`);

    } catch (err) {
        console.error("handlePriceUpdate error:", err.message);
    }
};

const updatePriceFromStripe = async (plan, priceAmountField, priceIdField, stripePriceId) => {
    try {
        const stripePrice = await stripe.prices.retrieve(stripePriceId);

        if (!stripePrice || !stripePrice.unit_amount) return;

        const amount = stripePrice.unit_amount / 100;

        await SubscriptionPlan.findByIdAndUpdate(plan._id, {
            [priceAmountField]: amount,
            [priceIdField]: stripePriceId
        });

        await Notification.create({
            type: "Price Update",
            title: `Default Price Updated`,
            description: `Plan '${plan.name}' → New ${priceAmountField} = $${amount}`,
            created_at: new Date()
        });

        console.log(`Updated ${priceAmountField} for ${plan.name} → $${amount}`);

    } catch (err) {
        console.error("updatePriceFromStripe error:", err.message);
    }
};

const migrateSubscribersToNewPrice = async (plan, newPriceId, priceAmountField, newAmount) => {
    try {
        const subscribers = await Subscription.find({
            plan_name: plan.name,
            auto_renewal: true,
            canceled_at: null,
            stripeSubscriptionId: { $ne: null },
            stripePriceId: { $ne: newPriceId }
        });

        for (const sub of subscribers) {
            try {
                const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

                if (!stripeSub.items.data.length) continue;

                const item = stripeSub.items.data[0];

                await stripe.subscriptions.update(stripeSub.id, {
                    items: [{ id: item.id, price: newPriceId }],
                    proration_behavior: "none"
                });

                await Subscription.findByIdAndUpdate(sub._id, {
                    stripePriceId: newPriceId,
                    plan_price: newAmount
                });

            } catch (err) {
                console.error("Migration failed:", err.message);
                continue;
            }
        }

        console.log(`Migrated ${subscribers.length} subscribers to new price.`);
    } catch (err) {
        console.error("migrateSubscribersToNewPrice error:", err.message);
    }
};

const handleProductUpdate = async (product) => {
    try {
        const productId = product.id;
        const defaultPriceId = product.default_price;

        if (!defaultPriceId) return;

        const plan = await SubscriptionPlan.findOne({
            $or: [
                { stripeProductMonthlyId: productId },
                { stripeProductYearlyId: productId }
            ],
        });
        if (!plan) return;

        // MONTHLY PRODUCT UPDATED
        if (plan.stripeProductMonthlyId === productId) {
            await updatePriceFromStripe(plan, "monthlyPrice", "monthlyPriceId", defaultPriceId);

            const priceData = await stripe.prices.retrieve(defaultPriceId);
            const newAmount = priceData?.unit_amount ? priceData.unit_amount / 100 : null;

            if (newAmount !== null) {
                await migrateSubscribersToNewPrice(
                    plan,
                    defaultPriceId,
                    "monthlyPrice",
                    newAmount
                );
            }
        }

        // YEARLY PRODUCT UPDATED
        if (plan.stripeProductYearlyId === productId) {
            await updatePriceFromStripe(plan, "yearlyPrice", "yearlyPriceId", defaultPriceId);

            const priceData = await stripe.prices.retrieve(defaultPriceId);
            const newAmount = priceData?.unit_amount ? priceData.unit_amount / 100 : null;

            if (newAmount !== null) {
                await migrateSubscribersToNewPrice(
                    plan,
                    defaultPriceId,
                    "yearlyPrice",
                    newAmount
                );
            }
        }

    } catch (err) {
        console.error("handleProductUpdate error:", err.message);
    }
};

const createAddOnCheckoutSession = async (req, res) => {
    try {
        const { addOnId, successUrl, cancelUrl } = req.body;
        const userId = req.user._id;

        if (req.user.role !== 'company') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to create checkout session'
            });
        }

        const subscription = await Subscription.findOne({ user_id: userId, canceled_at: null, end_date: { $gt: new Date() } });
        if (!subscription) {
            return res.status(400).json({
                success: false,
                message: 'No active subscription found or subscription has expired'
            });
        }

        if (!addOnId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: addOnId'
            });
        }

        const addOn = await AddOnPlan.findById(addOnId);
        if (!addOn) {
            return res.status(404).json({
                success: false,
                message: 'Add-on not found'
            });
        }

        if (!addOn.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Add-on is not available'
            });
        }

        let user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let stripeCustomerId;
        try {
            stripeCustomerId = await ensureStripeCustomer(user);
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create customer account'
            });
        }

        let stripeProductId;
        let stripePriceId;

        try {
            const productName = `Add-On: ${addOn.name}`;

            const existingProducts = await stripe.products.list({ limit: 100 });
            const existingProduct = existingProducts.data.find(p => p.name === productName);

            if (existingProduct) {
                stripeProductId = existingProduct.id;
                if (existingProduct.default_price) {
                    stripePriceId = existingProduct.default_price;
                } else {
                    const price = await stripe.prices.create({
                        product: stripeProductId,
                        unit_amount: Math.round(addOn.price * 100),
                        currency: 'usd',
                    });
                    stripePriceId = price.id;
                }
            } else {
                const product = await stripe.products.create({
                    name: productName,
                    description: addOn.description || '',
                });

                const price = await stripe.prices.create({
                    product: product.id,
                    unit_amount: Math.round(addOn.price * 100),
                    currency: 'usd',
                });

                stripeProductId = product.id;
                stripePriceId = price.id;
            }
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: `Failed to create Stripe product/price: ${stripeError.message}`
            });
        }

        const frontendUrl = process.env.FRONTEND_URL;
        const defaultSuccessUrl = successUrl || `${frontendUrl}/add-ons?success=true`;
        const defaultCancelUrl = cancelUrl || `${frontendUrl}/add-ons?canceled=true`;

        let checkoutSession;
        try {
            checkoutSession = await stripe.checkout.sessions.create({
                customer: stripeCustomerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: stripePriceId,
                        quantity: 1,
                    },
                ],
                mode: 'payment', // One-time payment, not subscription
                success_url: defaultSuccessUrl,
                cancel_url: defaultCancelUrl,
                metadata: {
                    userId: userId.toString(),
                    addOnId: addOnId.toString(),
                    addOnName: addOn.name,
                    type: 'addon'
                }
            });
        } catch (stripeError) {
            return res.status(500).json({
                success: false,
                message: `Failed to create checkout session: ${stripeError.message}`
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

const handleAddOnRefund = async (stripeObject, errorMessage) => {
    try {
        const paymentIntentId = getPaymentIntentId(stripeObject, stripeObject);
        if (!paymentIntentId) {
            console.error('handleAddOnRefund: no payment intent found');
            return null;
        }
        const refund = await safeCreateRefund({
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: { errorMessage }
        });
        return refund;
    } catch (error) {
        console.error("handleAddOnRefund error:", error.message || error);
        return null;
    }
};

const activateAddOnSubscription = async (stripeObject) => {
    try {
        const sessionId = stripeObject.id;
        const userId = stripeObject.metadata?.userId;

        if (!sessionId || !userId) {
            await handleAddOnRefund(stripeObject, "Missing session ID or user ID");
            return;
        }

        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

        if (checkoutSession.metadata?.userId !== userId.toString()) {
            await handleAddOnRefund(stripeObject, "Checkout session does not belong to user");
            return;
        }

        if (checkoutSession.metadata?.type !== 'addon') {
            await handleAddOnRefund(stripeObject, "Checkout session is not an add-on purchase");
            return;
        }

        if (checkoutSession.payment_status !== 'paid') {
            await handleAddOnRefund(stripeObject, "Checkout session payment was not successful");
            return;
        }

        const addOnId = checkoutSession.metadata?.addOnId;
        const addOn = await AddOnPlan.findById(addOnId);

        if (!addOn) {
            await handleAddOnRefund(stripeObject, "Add-on not found");
            return;
        }

        const paymentIntentId = getPaymentIntentId(checkoutSession, stripeObject) || checkoutSession.id;
        const existingPayment = await Payment.findOne({
            transaction_id: paymentIntentId,
            status: 'Success'
        });

        if (existingPayment) {
            return;
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const subscription = await Subscription.findOne({ user_id: userId }).session(session);

            if (!subscription) {
                await session.abortTransaction();
                await handleAddOnRefund(stripeObject, "User has no subscription");
                return;
            }

            const updateData = {};

            if (addOn.type === "RFP Proposals Generation") {
                updateData.max_rfp_proposal_generations = subscription.max_rfp_proposal_generations + addOn.quantity;
            } else if (addOn.type === "Grant Proposal Generations") {
                updateData.max_grant_proposal_generations = subscription.max_grant_proposal_generations + addOn.quantity;
            } else if (addOn.type === "RFP + Grant Proposal Generations") {
                updateData.max_rfp_proposal_generations = subscription.max_rfp_proposal_generations + addOn.quantity;
                updateData.max_grant_proposal_generations = subscription.max_grant_proposal_generations + addOn.quantity;
            } else {
                await session.abortTransaction();
                await handleAddOnRefund(stripeObject, "Add-on type not found");
                return;
            }

            if (Object.keys(updateData).length > 0) {
                await Subscription.findByIdAndUpdate(
                    subscription._id,
                    { $set: updateData },
                    { session }
                );
            }

            const user = await User.findById(userId).session(session);
            if (!user) {
                await session.abortTransaction();
                await handleAddOnRefund(stripeObject, "User not found for payment record");
                return;
            }

            const companyProfile = await CompanyProfile.findOne({ userId: userId }).session(session);
            if (!companyProfile) {
                await session.abortTransaction();
                await handleAddOnRefund(stripeObject, "Company profile not found for payment record");
                return;
            }

            const finalTransactionId = paymentIntentId;

            await createPaymentRecord({
                session,
                user_id: userId,
                subscription_id: subscription._id,
                price: addOn.price,
                status: 'Success',
                paid_at: new Date(),
                transaction_id: finalTransactionId,
                planName: addOn.name,
                companyName: companyProfile.companyName,
                payment_method: 'stripe',
            });

            await session.commitTransaction();

            await notifyAddOnSuccess({ user, companyProfile, addOn });

            return;

        } catch (error) {
            await session.abortTransaction();

            try {
                const pi = paymentIntentId;
                if (pi) {
                    const refund = await safeCreateRefund({
                        payment_intent: pi,
                        reason: 'requested_by_customer',
                        metadata: {
                            reason: 'database_transaction_failed',
                            userId: userId.toString(),
                            addOnId: addOnId,
                            error: error.message
                        }
                    });

                    const userObj = await User.findById(userId);
                    const companyProfile = await CompanyProfile.findOne({ userId: userId });

                    await createPaymentRecord({
                        session: null,
                        user_id: userId,
                        subscription_id: null,
                        price: addOn.price,
                        status: refund ? 'Pending Refund' : 'Failed - Refund Required',
                        paid_at: new Date(),
                        transaction_id: pi,
                        refund_id: refund?.id || null,
                        companyName: companyProfile ? companyProfile.companyName : (userObj ? userObj.fullName : null),
                        payment_method: 'stripe',
                        failure_reason: error.message
                    });

                    if (userObj) {
                        const plan = addOn;
                        if (refund) {
                            await sendRefundNotification(userObj, plan, refund.id, error.message);
                        } else {
                            try {
                                const { subject, body } = await emailTemplates.getRefundNotificationEmail(
                                    userObj.fullName,
                                    plan.name,
                                    pi,
                                    `Encountered an error and refund couldn't be processed automatically: ${error.message}`
                                );
                                queueEmail(userObj.email, subject, body, 'refundNotification');
                            } catch (e) {
                                console.error('Failed to queue refund required email', e.message || e);
                            }
                        }
                    }
                } else {
                    const userObj = await User.findById(userId);
                    const companyProfile = await CompanyProfile.findOne({ userId: userId });
                    await createPaymentRecord({
                        session: null,
                        user_id: userId,
                        subscription_id: null,
                        price: addOn.price,
                        status: 'Failed - Refund Required',
                        paid_at: new Date(),
                        transaction_id: sessionId,
                        companyName: companyProfile ? companyProfile.companyName : (userObj ? userObj.fullName : null),
                        payment_method: 'stripe',
                        failure_reason: error.message
                    });

                    if (userObj) {
                        try {
                            const { subject, body } = await emailTemplates.getRefundNotificationEmail(
                                userObj.fullName,
                                addOn.name,
                                sessionId,
                                `Encountered an error and no payment_intent found: ${error.message}`
                            );
                            queueEmail(userObj.email, subject, body, 'refundNotification');
                        } catch (e) {
                            console.error('Failed to queue refund required email', e.message || e);
                        }
                    }
                }
            } catch (refundError) {
                console.error('Error while trying to refund after add-on transaction failure:', refundError.message || refundError);
            }

            throw error;
        } finally {
            session.endSession();
        }

    } catch (error) {
        try {
            await handleAddOnRefund(stripeObject, "Add-on error in activateAddOnSubscription: " + (error.message || error));
        } catch (e) {
            console.error('Secondary add-on refund attempt failed:', e.message || e);
        }
        throw error;
    }
};

module.exports = {
    createPaymentIntent,
    handleWebhook,
    activateSubscription,
    syncPricesFromStripe,
    createAddOnCheckoutSession,
    activateAddOnSubscription,
};