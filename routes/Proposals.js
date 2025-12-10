const express = require('express');
const router = express.Router();

const verifyUser = require('../utils/verifyUser');

const { basicComplianceCheckPdf, advancedComplianceCheckPdf, competitorAnalysis, deleteDraftProposal, deleteDraftGrant } = require('../controllers/proposalController');

// router.post('/basicComplianceCheck', verifyUser(["company", "Editor"]), basicComplianceCheck);
// router.post('/advancedComplianceCheck', verifyUser(["company", "Editor"]), advancedComplianceCheck);
// router.post('/generatePDF', verifyUser(["company", "Editor"]), generatePDF);
// router.post('/autoSave', verifyUser(["company", "Editor"]), autoSaveProposal);
router.post('/basicComplianceCheckPdf', verifyUser(["company", "Editor"]), basicComplianceCheckPdf);
router.post('/advancedComplianceCheckPdf', verifyUser(["company", "Editor"]), advancedComplianceCheckPdf);
router.post('/competitor-analysis', verifyUser(["company", "Editor"]), competitorAnalysis);

router.post('/deleteDraftProposal', verifyUser(["company", "Editor"]), deleteDraftProposal);
router.post('/deleteDraftGrant', verifyUser(["company", "Editor"]), deleteDraftGrant);

module.exports = router;