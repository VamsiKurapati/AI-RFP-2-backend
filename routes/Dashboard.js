const express = require("express");
const router = express.Router();

const verifyUser = require("../utils/verifyUser");

const { getDashboardData, restoreProposal, deleteProposals, deletePermanently, updateProposal, restoreGrantProposal, deleteGrantProposals, deletePermanentlyGrant, updateGrantProposal, getRFPData, getGrantData, setCollaborators, setGrantCollaborators } = require("../controllers/dashboardController");

router.get("/getDashboardData", verifyUser(["company", "employee"]), getDashboardData);

router.get("/getRFPDetails/:rfpOrMatchedRFPId", verifyUser(["company", "employee"]), getRFPData);
router.get("/getGrantDetails/:grantId", verifyUser(["company", "employee"]), getGrantData);

// router.post("/addCalendarEvent", verifyUser(["company", "Editor"]), addCalendarEvent);

router.put("/restoreProposal", verifyUser(["company", "Editor"]), restoreProposal);
router.put("/deleteProposals", verifyUser(["company", "Editor"]), deleteProposals);
router.put("/deletePermanently", verifyUser(["company", "Editor"]), deletePermanently);
router.put("/updateProposal", verifyUser(["company", "Editor"]), updateProposal);
router.put("/restoreGrantProposal", verifyUser(["company", "Editor"]), restoreGrantProposal);
router.put("/deleteGrantProposals", verifyUser(["company", "Editor"]), deleteGrantProposals);
router.put("/deleteGrantPermanently", verifyUser(["company", "Editor"]), deletePermanentlyGrant);
router.put("/updateGrantProposal", verifyUser(["company", "Editor"]), updateGrantProposal);
router.put("/setCollaborators", verifyUser(["company"]), setCollaborators);
router.put("/setGrantCollaborators", verifyUser(["company"]), setGrantCollaborators);


module.exports = router;