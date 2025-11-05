//Profile.js
const express = require('express');
const router = express.Router();

const verifyUser = require('../utils/verifyUser');

const { getProfile, getEmployeeProfile, getCompanyProfile, updateCompanyProfile, updateEmployeeProfile, addEmployee, removeEmployee, addCaseStudy, addLicenseAndCertification, uploadLogo, getProfileImage, getCaseStudy, addDocument, getDocument, getProposals, changePassword, getPaymentById, deleteDocument, deleteCaseStudy, deleteLicenseAndCertification, deleteEmployee } = require('../controllers/profileController.js');

router.get('/getProfile', verifyUser(["company"]), getProfile);
router.get('/getCompanyProfile', verifyUser(["employee"]), getCompanyProfile);
router.get('/getEmployeeProfile', verifyUser(["employee"]), getEmployeeProfile);
router.put('/updateCompanyProfile', verifyUser(["company"]), updateCompanyProfile);
router.get('/getProposals', verifyUser(["company", "employee"]), getProposals);
router.put('/updateEmployeeProfile', verifyUser(["employee"]), updateEmployeeProfile);
router.post('/addEmployee', verifyUser(["company"]), addEmployee);
router.post('/removeEmployee', verifyUser(["company"]), removeEmployee);
router.post('/addCaseStudy', verifyUser(["company"]), addCaseStudy);
router.post('/addLicenseAndCertification', verifyUser(["company"]), addLicenseAndCertification);
router.post('/uploadLogo', verifyUser(["company", "employee"]), uploadLogo);
router.post('/addDocument', verifyUser(["company"]), addDocument);
router.get('/getProfileImage/file/:id', getProfileImage);
router.get('/getCaseStudy/:id', getCaseStudy);
router.get('/getDocument/:id', getDocument);
router.delete('/deleteDocument/:id', verifyUser(["company"]), deleteDocument);
router.delete('/deleteCaseStudy/:id', verifyUser(["company"]), deleteCaseStudy);
router.delete('/deleteCertification/:id', verifyUser(["company"]), deleteLicenseAndCertification);
router.delete('/deleteEmployee/:id', verifyUser(["company"]), deleteEmployee);
router.put('/changePassword', verifyUser(["company", "employee", "SuperAdmin"]), changePassword);
router.get('/getPaymentById/:id', verifyUser(["company", "employee"]), getPaymentById);

module.exports = router;
