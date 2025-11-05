# Stripe Setup Guide for Auto-Renewal Subscriptions

This guide walks you through setting up Stripe products, prices, and webhooks for your auto-renewal subscription system.

## Prerequisites

- Stripe account (test mode or live mode)
- Access to your Stripe Dashboard
- Your application's webhook endpoint URL
- Your subscription plan names (e.g., "Basic", "Pro", "Enterprise")

---

## Part 1: Create Products and Prices in Stripe

### Step 1: Access Stripe Dashboard

1. Go to [https://dashboard.stripe.com](https://dashboard.stripe.com)
2. Log in to your Stripe account
3. Make sure you're in the correct mode (Test mode for testing, Live mode for production)

### Step 2: Create Products for Each Subscription Plan

For each subscription plan in your database (e.g., "Basic", "Pro", "Enterprise"):

1. **Navigate to Products**
   - Click on **"Products"** in the left sidebar
   - Click **"+ Add product"** button

2. **Create Product Details**
   - **Name**: Enter your plan name (e.g., "Basic Plan", "Pro Plan", "Enterprise Plan")
   - **Description**: Enter a description (optional but recommended)
   - **Images**: Upload product images (optional)
   - **Metadata** (optional): Add any custom metadata
   - Click **"Save product"**

3. **Repeat for Each Plan**
   - Create a product for each subscription plan in your database
   - **Note**: The product name in Stripe doesn't need to match your database plan name exactly, but it's helpful if they're similar

### Step 3: Create Prices for Each Product

For each product, you need to create **TWO prices** (one for monthly, one for yearly):

#### Creating Monthly Price:

1. **On the Product Page**, click **"+ Add another price"** or **"Add price"**
2. **Price Configuration**:
   - **Price**: Enter the amount (e.g., `29.99` for $29.99)
   - **Billing period**: Select **"Monthly"**
   - **Currency**: Select **"USD"** (or your preferred currency)
   - **Recurring**: Make sure this is enabled (it should be by default for monthly)
   - **Usage type**: Select **"Licensed"** (standard subscription)
   - Click **"Add price"**

3. **Copy the Price ID**:
   - After creating the price, you'll see a **Price ID** (starts with `price_`)
   - **Copy this Price ID** - you'll need it for your database

#### Creating Yearly Price:

1. **On the Same Product Page**, click **"+ Add another price"**
2. **Price Configuration**:
   - **Price**: Enter the yearly amount (e.g., `299.99` for $299.99/year)
   - **Billing period**: Select **"Yearly"**
   - **Currency**: Select **"USD"** (or your preferred currency)
   - **Recurring**: Make sure this is enabled
   - **Usage type**: Select **"Licensed"**
   - Click **"Add price"**

3. **Copy the Price ID**:
   - **Copy this Price ID** - you'll need it for your database

### Step 4: Document Your Price IDs

Create a table to track your Stripe Price IDs:

| Plan Name |          Monthly Price ID           |           Yearly Price ID          | Monthly Price |   Yearly Price  |
|-----------|-------------------------------------|------------------------------------|---------------|-----------------|
| Basic     | price_1SQ5nM2LVg51oNZRq8m5Qphh      | price_1SQ5nz2LVg51oNZRwju0FW6g     |     $25.00    |     $250.00     |
| Pro       | price_1SQ5pI2LVg51oNZR6BOWHhEk      | price_1SQ5q02LVg51oNZRDsUOk0Un     |     $75.00    |     $750.00     |
| Enterprise| price_1SQ5qT2LVg51oNZRkpDAUIQr      | price_1SQ5r42LVg51oNZRvbJhMJ90     |    $199.00    |     $1999.00    |

---

## Part 2: Update Your Database with Price IDs

### Step 1: Access Your Database

You can update the Price IDs using:
- MongoDB Compass
- Your admin panel
- Direct database query
- API endpoint (if you have one)

### Step 2: Update Each Subscription Plan

For each plan in your `SubscriptionPlan` collection, update:

```javascript
{
  monthlyPriceId: "price_xxxxx", // Your monthly price ID from Stripe
  yearlyPriceId: "price_yyyyy"   // Your yearly price ID from Stripe
}
```

**Example MongoDB Update Command:**

```javascript
// Update Basic Plan
db.subscriptionplans.updateOne(
  { name: "Basic" },
  { 
    $set: { 
      monthlyPriceId: "price_1ABC123...", 
      yearlyPriceId: "price_1XYZ789..." 
    } 
  }
);

// Update Pro Plan
db.subscriptionplans.updateOne(
  { name: "Pro" },
  { 
    $set: { 
      monthlyPriceId: "price_1DEF456...", 
      yearlyPriceId: "price_1UVW012..." 
    } 
  }
);

// Update Enterprise Plan
db.subscriptionplans.updateOne(
  { name: "Enterprise" },
  { 
    $set: { 
      monthlyPriceId: "price_1GHI789...", 
      yearlyPriceId: "price_1RST345..." 
    } 
  }
);
```

**Or use your admin API endpoint:**
```bash
PUT /admin/updateSubscriptionPlanPrice/:id
{
  "monthlyPriceId": "price_xxxxx",
  "yearlyPriceId": "price_yyyyy"
}
```

---

## Part 3: Sync Prices from Stripe to Database

### Step 1: Run the Price Sync Endpoint

After updating Price IDs, sync the actual prices from Stripe:

```bash
POST /stripe/sync-prices
Authorization: Bearer <your-token>
```

This will:
- Fetch current prices from Stripe using the Price IDs
- Update `monthlyPrice` and `yearlyPrice` in your database
- Ensure prices are always in sync with Stripe

**Note**: Run this whenever you update prices in Stripe.

---

## Part 4: Set Up Webhooks

### Step 1: Get Your Webhook Endpoint URL

Your webhook endpoint is:
```
https://your-domain.com/admin/webhook
```

Or for local development with Stripe CLI:
```
http://localhost:YOUR_PORT/admin/webhook
```

### Step 2: Create Webhook Endpoint in Stripe

1. **Navigate to Webhooks**
   - In Stripe Dashboard, click **"Developers"** in the left sidebar
   - Click **"Webhooks"**
   - Click **"+ Add endpoint"**

2. **Configure Endpoint**
   - **Endpoint URL**: Enter your webhook URL
     - Production: `https://your-domain.com/admin/webhook`
     - Test mode: `https://your-test-domain.com/admin/webhook`
   - **Description**: "Subscription and payment webhooks"
   - Click **"Add endpoint"**

3. **Select Events to Listen To**
   You need to select these events:

   **Checkout Events:**
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.async_payment_failed`
   - `checkout.session.async_payment_succeeded`

   **Subscription Events:**
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   **Invoice Events:**
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.payment_action_required`

   **Price Events (for automatic price synchronization):**
   - `price.created`
   - `price.updated`

   **How to select:**
   - Click **"Select events"**
   - Choose **"Select events to listen to"**
   - Search and check each event listed above
   - Click **"Add events"**

4. **Save the Webhook Secret**
   - After creating the endpoint, you'll see a **"Signing secret"**
   - **Copy this secret** - it starts with `whsec_`
   - **Add it to your `.env` file**:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_xxxxx
     ```

### Step 3: Test Your Webhook (Optional but Recommended)

1. **In Stripe Dashboard**, go to your webhook endpoint
2. Click **"Send test webhook"**
3. Select an event type (e.g., `checkout.session.completed`)
4. Click **"Send test webhook"**
5. Check your server logs to ensure the webhook was received and processed

---

## Part 5: Configure Environment Variables

Make sure your `.env` file has:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_xxxxx  # or sk_live_xxxxx for production
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # From webhook endpoint settings
FRONTEND_URL=https://your-frontend-domain.com  # For checkout redirect URLs
```

---

## Part 6: Testing the Complete Flow

### Test 1: Create a Subscription

1. **Call the create payment intent endpoint:**
   ```bash
   POST /stripe/create-payment-intent
   Authorization: Bearer <user-token>
   {
     "planId": "<plan-id-from-db>",
     "billingCycle": "monthly"
   }
   ```

2. **Response should include:**
   ```json
   {
     "success": true,
     "sessionId": "cs_test_xxxxx",
     "url": "https://checkout.stripe.com/..."
   }
   ```

3. **Redirect user to the `url`** to complete checkout

### Test 2: Verify Webhook Processing

1. After successful checkout, check your server logs
2. Verify the webhook was received and processed
3. Check your database:
   - Subscription should be created with `auto_renewal: true`
   - User should have `subscription_status: 'active'`
   - Payment record should be created

### Test 3: Test Price Sync

1. **Update a price in Stripe Dashboard**
2. **Run the sync endpoint:**
   ```bash
   POST /stripe/sync-prices
   Authorization: Bearer <token>
   ```
3. **Verify** prices are updated in your database

---

## Troubleshooting

### Issue: "Stripe price ID not configured"
**Solution**: Make sure you've added `monthlyPriceId` and `yearlyPriceId` to your SubscriptionPlan documents

### Issue: Webhook not receiving events
**Solution**: 
- Check webhook endpoint URL is correct
- Verify `STRIPE_WEBHOOK_SECRET` in `.env` matches Stripe dashboard
- Check webhook endpoint is accessible (not behind firewall)
- Use Stripe CLI for local testing: `stripe listen --forward-to localhost:PORT/admin/webhook`

### Issue: Subscription not activating
**Solution**:
- Check webhook events are being received
- Verify webhook secret is correct
- Check server logs for errors
- Ensure subscription metadata includes `userId`, `planId`, and `billingCycle`

### Issue: Prices not syncing
**Solution**:
- Verify Price IDs are correct in database
- Check Stripe API key has correct permissions
- Ensure Price IDs exist in Stripe (not deleted)

---

## Using Stripe CLI for Local Development

If you're developing locally, use Stripe CLI to forward webhooks:

1. **Install Stripe CLI**: https://stripe.com/docs/stripe-cli
2. **Login**: `stripe login`
3. **Forward webhooks**: 
   ```bash
   stripe listen --forward-to localhost:YOUR_PORT/admin/webhook
   ```
4. **Copy the webhook secret** from the CLI output and add to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

---

## Production Checklist

Before going live:

- [ ] All products and prices created in **Live mode**
- [ ] All Price IDs updated in production database
- [ ] Webhook endpoint configured for production URL
- [ ] `STRIPE_SECRET_KEY` set to live key (`sk_live_...`)
- [ ] `STRIPE_WEBHOOK_SECRET` set to live webhook secret
- [ ] `FRONTEND_URL` set to production frontend URL
- [ ] Webhook events tested in production
- [ ] Test subscription created and verified
- [ ] Prices synced from Stripe to database

---

## Additional Resources

- [Stripe Subscriptions Documentation](https://stripe.com/docs/billing/subscriptions/overview)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Stripe Checkout Sessions](https://stripe.com/docs/payments/checkout)
- [Stripe Testing Guide](https://stripe.com/docs/testing)

