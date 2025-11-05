const mongoose = require('mongoose');

/**
 * Utility function to delete a file from GridFS
 * @param {ObjectId} fileId - The GridFS file ID to delete
 * @param {string} bucketName - The bucket name (default: 'uploads')
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
const deleteGridFSFile = async (fileId, bucketName = 'uploads') => {
    try {
        if (!fileId) {
            console.warn('No file ID provided for deletion');
            return false;
        }

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: bucketName
        });

        await bucket.delete(fileId);
        return true;
    } catch (error) {
        console.error(`Failed to delete file ${fileId} from bucket ${bucketName}:`, error);
        return false;
    }
};

/**
 * Utility function to delete multiple files from GridFS
 * @param {Array<ObjectId>} fileIds - Array of GridFS file IDs to delete
 * @param {string} bucketName - The bucket name (default: 'uploads')
 * @returns {Promise<Array>} - Returns array of deletion results
 */
const deleteMultipleGridFSFiles = async (fileIds, bucketName = 'uploads') => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return [];
    }

    const deletionPromises = fileIds.map(fileId => deleteGridFSFile(fileId, bucketName));
    return await Promise.all(deletionPromises);
};

/**
 * Utility function to clean up files when an operation fails
 * @param {Object} req - Express request object
 * @param {string} bucketName - The bucket name (default: 'uploads')
 * @returns {Promise<void>}
 */
const cleanupUploadedFiles = async (req, bucketName = 'uploads') => {
    try {
        // Handle single file upload
        if (req.file && req.file.id) {
            await deleteGridFSFile(req.file.id, bucketName);
        }

        // Handle multiple file uploads
        if (req.files) {
            const fileIds = [];

            // Handle multer fields format
            if (req.files.documents) {
                fileIds.push(...req.files.documents.map(file => file.id));
            }
            if (req.files.proposals) {
                fileIds.push(...req.files.proposals.map(file => file.id));
            }
            if (req.files.image) {
                fileIds.push(req.files.image.id);
            }

            // Handle array format
            if (Array.isArray(req.files)) {
                fileIds.push(...req.files.map(file => file.id));
            }

            if (fileIds.length > 0) {
                await deleteMultipleGridFSFiles(fileIds, bucketName);
            }
        }
    } catch (error) {
        console.error('Error during file cleanup:', error);
    }
};

module.exports = {
    deleteGridFSFile,
    deleteMultipleGridFSFiles,
    cleanupUploadedFiles
};
