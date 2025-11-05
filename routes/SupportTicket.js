const express = require('express');
const router = express.Router();
const supportController = require('../controllers/SupportController');
const upload = require('../middleware/multerConfig'); // the above multer setup


router.post('/tickets', upload.array('attachments'), supportController.createTicket);
router.get('/tickets', supportController.getUserTickets);
router.put('/tickets/:id/reopen', supportController.reopenSupportTicket);
router.put('/tickets/:id/withdrawn', supportController.withdrawnSupportTicket);

router.post('/tickets/:id/userMessages', supportController.addUserMessage);

router.get('/tickets/:id/userMessages', supportController.getUserMessages);
router.get('/tickets/:id/adminMessages', supportController.getAdminMessages);





module.exports = router;