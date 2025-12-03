const express = require('express');
const router = express.Router();

const { generateDoc, openFile, checkFile, save, serveDoc, addCollaborator, removeCollaborator, getCollaborators } = require('../controllers/editorController');

const verifyUser = require('../utils/verifyUser');
const { fileServeLimiter } = require('../utils/rateLimiter');

router.post('/generate-doc', verifyUser(["company", "employee"]), generateDoc);

router.get('/open-file', openFile);
router.get('/check-file', checkFile);
router.post('/save', save);

// Handle OPTIONS for CORS preflight
router.options('/serve-doc/:fileId', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.sendStatus(200);
});

// Use permissive rate limiter for file serving (OnlyOffice needs frequent access)
router.get('/serve-doc/:fileId', fileServeLimiter, serveDoc);

// Collaborator management routes
router.post('/add-collaborator', verifyUser(["company"]), addCollaborator);
router.post('/remove-collaborator', verifyUser(["company"]), removeCollaborator);
router.get('/get-collaborators', verifyUser(["company", "employee"]), getCollaborators);

module.exports = router;

