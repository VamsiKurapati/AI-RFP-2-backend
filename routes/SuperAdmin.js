const express = require('express');
const router = express.Router();
const verifyUser = require('../utils/verifyUser');

const { getCompanyStatsAndData,
     updateCompanyStatus,
     getNotificationData,
     getSupportStatsAndData,
     updateSupportTicket,
     addAdminMessage,
     getSubscriptionPlansData,
     updateSubscriptionPlanPrice,
     getPaymentsSummaryAndData,
     updateSubscriptionPlanIsContact,
     sendEmail,
     getCustomPlanData,
     deleteCustomPlan,
     createCustomPlan,
     getPaymentDetails,
     editPaymentDetails,
     editCustomPlan,
     getContactData,
     deleteContactData,
     updateContactData,
     updateEmailContentinDB,
     getEmailContentFromDB,
     getSubscriptionsOfAllUsers,
     deactivateSubscription,
     assignNewSubscriptionToUser,
     bulkDeactivateSubscriptions,
     updateUserSubscription,
     createAddOnPlan,
     updateAddOnPlan,
     deleteAddOnPlan,
     sendCustomEmail
} = require('../controllers/superAdminController');

const { syncPricesFromStripe } = require('../controllers/stripeController');

router.get('/getCompanyStatsAndData', verifyUser(["SuperAdmin"]), getCompanyStatsAndData);
router.put('/updateCompanyStatus/:id', verifyUser(["SuperAdmin"]), updateCompanyStatus);


router.get('/getnotificationsData', verifyUser(["SuperAdmin"]), getNotificationData);


router.get('/getsupportStatsAndData', verifyUser(["SuperAdmin"]), getSupportStatsAndData);
router.put('/updateSupportTicket/:id', verifyUser(["SuperAdmin"]), updateSupportTicket);
router.post('/addAdminMessage/:id', verifyUser(["SuperAdmin"]), addAdminMessage);


router.get('/getSubscriptionPlansData', verifyUser(["SuperAdmin"]), getSubscriptionPlansData);
router.put('/updateSubscriptionPlanPrice/:id', verifyUser(["SuperAdmin"]), updateSubscriptionPlanPrice);
router.put('/updateSubscriptionPlanIsContact/:id', verifyUser(["SuperAdmin"]), updateSubscriptionPlanIsContact);
router.post('/updateSubscriptionPlanCustom', verifyUser(["SuperAdmin"]), sendEmail);


//payment
router.get('/getPaymentStatsAndData', verifyUser(["SuperAdmin"]), getPaymentsSummaryAndData);

//custom plan
router.get('/getCustomPlanData', verifyUser(["SuperAdmin"]), getCustomPlanData);
router.delete('/deleteCustomPlan/:id', verifyUser(["SuperAdmin"]), deleteCustomPlan);
router.put('/editCustomPlan/:id', verifyUser(["SuperAdmin"]), editCustomPlan);

router.post('/createCustomPlan', verifyUser(["SuperAdmin"]), createCustomPlan);

//payment details
router.get('/getPaymentDetails', verifyUser(["SuperAdmin"]), getPaymentDetails);
router.put('/editPaymentDetails/:id', verifyUser(["SuperAdmin"]), editPaymentDetails);

//contact
router.get('/getContactData', verifyUser(["SuperAdmin"]), getContactData);
router.delete('/deleteContactData/:id', verifyUser(["SuperAdmin"]), deleteContactData);
router.put('/updateContactData/:id', verifyUser(["SuperAdmin"]), updateContactData);

//Price Sync Route (for Super Admin use - can add admin verification if needed)
router.post('/sync-prices', verifyUser(["SuperAdmin"]), syncPricesFromStripe);

//email content
router.put('/updateEmailContentinDB/:id', verifyUser(["SuperAdmin"]), updateEmailContentinDB);
router.get('/getEmailContentFromDB', verifyUser(["SuperAdmin"]), getEmailContentFromDB);

//subscriptions
router.get('/getSubscriptionsOfAllUsers', verifyUser(["SuperAdmin"]), getSubscriptionsOfAllUsers);
router.post('/deactivateSubscription', verifyUser(["SuperAdmin"]), deactivateSubscription);
router.post('/assignSubscription', verifyUser(["SuperAdmin"]), assignNewSubscriptionToUser);
router.post('/updateUserSubscription', verifyUser(["SuperAdmin"]), updateUserSubscription);
router.post('/bulkDeactivateSubscriptions', verifyUser(["SuperAdmin"]), bulkDeactivateSubscriptions);

// Add-on plans routes
router.post('/createAddOnPlan', verifyUser(["SuperAdmin"]), createAddOnPlan);
router.put('/updateAddOnPlan/:id', verifyUser(["SuperAdmin"]), updateAddOnPlan);
router.delete('/deleteAddOnPlan/:id', verifyUser(["SuperAdmin"]), deleteAddOnPlan);

//send custom email
router.post('/sendCustomEmail', verifyUser(["SuperAdmin"]), sendCustomEmail);

module.exports = router;