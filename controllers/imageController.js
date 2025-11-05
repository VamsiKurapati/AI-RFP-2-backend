require('dotenv').config();

const multer = require("multer");
const mongoose = require("mongoose");
const { GridFsStorage } = require("multer-gridfs-storage");
const crypto = require("crypto");

const storage = new GridFsStorage({
    url: process.env.MONGO_URI,
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, buf) => {
                if (err) return reject(err);
                // Generate unique filename to prevent duplicates
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const fileExtension = file.originalname.split('.').pop();
                const fileNameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.'));
                const uniqueFilename = `${fileNameWithoutExt}_${uniqueSuffix}.${fileExtension}`;

                resolve({
                    filename: uniqueFilename,
                    bucketName: "template_images",
                    metadata: {
                        originalname: file.originalname,
                        uploadedAt: new Date(),
                        uniqueId: buf.toString('hex')
                    },
                });
            });
        });
    },
});

const upload = multer({ storage });

const storage2 = new GridFsStorage({
    url: process.env.MONGO_URI,
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(16, (err, buf) => {
                if (err) {
                    return reject(err);
                }
                // Generate unique filename to prevent duplicates
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const fileExtension = file.originalname.split('.').pop();
                const fileNameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.'));
                const uniqueFilename = `${fileNameWithoutExt}_${uniqueSuffix}.${fileExtension}`;

                const fileConfig = {
                    filename: uniqueFilename,
                    // bucketName: "cloud_images",
                    bucketName: "uploads",
                    metadata: {
                        originalname: file.originalname,
                        uploadedAt: new Date(),
                        uniqueId: buf.toString('hex')
                    },
                };

                resolve(fileConfig);
            });
        });
    },
});

const upload2 = multer({
    storage: storage2,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
});

const singleImageUpload = upload2.single('image');
const singleTemplateImageUpload = upload.single('image');

exports.uploadTemplateImage = [
    singleTemplateImageUpload,
    async (req, res) => {
        try {
            // Use id instead of _id for GridFS files (multer-gridfs-storage provides 'id')
            const fileId = req.file.id;
            const filename = req.file.filename;
            const originalName = req.file.originalname;

            res.status(200).json({
                message: "Image uploaded successfully",
                fileId,
                filename,
                originalName
            });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
];

exports.uploadImage = [
    singleImageUpload,
    async (req, res) => {
        try {
            // Use id instead of _id for GridFS files (multer-gridfs-storage provides 'id')
            const fileId = req.file?.id;
            const filename = req.file?.filename;
            const originalName = req.file?.originalname;

            const response = {
                message: "Image uploaded successfully",
                fileId,
                filename,
                originalName
            };

            res.status(201).json(response);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
];

exports.serveTemplateImage = async (req, res) => {
    try {
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "template_images",
        });

        const filename = req.params.filename;

        // Input validation
        if (!filename) {
            return res.status(400).json({ message: "Filename is required" });
        }

        // Sanitize filename to prevent path traversal
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
        if (sanitizedFilename !== filename) {
            return res.status(400).json({ message: "Invalid filename format" });
        }

        // Find file by filename (should be unique now)
        const file = await bucket.find({ filename: filename }).toArray();

        if (!file || file.length === 0) {
            return res.status(404).json({ message: "File not found" });
        }

        // If multiple files found (shouldn't happen with unique filenames), log warning
        if (file.length > 1) {
            console.warn(`Multiple files found with filename: ${filename}. Using first match.`);
        }

        const fileDoc = file[0];
        const fileId = fileDoc._id;

        // Check if file chunks are intact
        const chunksCollection = mongoose.connection.db.collection('template_images.chunks');
        const chunks = await chunksCollection.find({ files_id: fileId }).sort({ n: 1 }).toArray();

        if (chunks.length === 0) {
            return res.status(500).json({ message: "File chunks are missing or corrupted" });
        }

        // Verify chunk sequence
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].n !== i) {
                return res.status(500).json({ message: "File chunks are corrupted" });
            }
        }

        // Set appropriate headers for image serving
        res.set({
            'Content-Type': fileDoc.contentType || 'application/octet-stream',
            'Content-Length': fileDoc.length,
            'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
        });

        const downloadStream = bucket.openDownloadStream(fileId);

        downloadStream.on("error", (error) => {
            if (!res.headersSent) {
                // If it's a chunk error, suggest cleaning up the corrupted file
                if (error.message.includes('ChunkIsMissing') || error.message.includes('ChunkIsCorrupted')) {
                    res.status(500).json({
                        message: "File is corrupted. Please re-upload the image.",
                        error: error.message,
                        suggestion: "The file chunks are corrupted. Consider deleting and re-uploading this file."
                    });
                } else {
                    res.status(500).json({ message: "Error streaming file", error: error.message });
                }
            }
        });

        downloadStream.pipe(res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: error.message });
        }
    }
};

exports.serveCloudImage = async (req, res) => {
    try {
        const filename = req.params.filename;

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "cloud_images",
        });

        // Find file by filename (should be unique now)
        const file = await bucket.find({ filename: filename }).toArray();

        if (!file || file.length === 0) {
            return res.status(404).json({ message: "File not found" });
        }

        // If multiple files found (shouldn't happen with unique filenames), log warning
        if (file.length > 1) {
            console.warn(`Multiple files found with filename: ${filename}. Using first match.`);
        }

        const fileDoc = file[0];
        const fileId = fileDoc._id;

        // Check if file chunks are intact
        const chunksCollection = mongoose.connection.db.collection('cloud_images.chunks');
        const chunks = await chunksCollection.find({ files_id: fileId }).sort({ n: 1 }).toArray();

        if (chunks.length === 0) {
            return res.status(500).json({ message: "File chunks are missing or corrupted" });
        }

        // Verify chunk sequence
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].n !== i) {
                return res.status(500).json({ message: "File chunks are corrupted" });
            }
        }

        const downloadStream = bucket.openDownloadStream(fileId);

        downloadStream.on("error", (error) => {
            if (!res.headersSent) {
                if (error.message.includes('ChunkIsMissing') || error.message.includes('ChunkIsCorrupted')) {
                    res.status(500).json({
                        message: "File is corrupted. Please re-upload the image.",
                        error: error.message
                    });
                } else {
                    res.status(500).json({ message: "Error streaming file", error: error.message });
                }
            }
        });

        downloadStream.pipe(res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: error.message });
        }
    }
};

exports.deleteImage = async (req, res) => {
    try {
        const filename = req.params.filename;

        // Input validation
        if (!filename) {
            return res.status(400).json({ message: "Filename is required" });
        }

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            // bucketName: "cloud_images",
            bucketName: "uploads",
        });

        let file = null;

        // Find file by filename (should be unique now)
        file = await bucket.find({ filename: filename }).toArray();

        if (!file || file.length === 0) {
            // Try finding by fileId - validate ObjectId format first
            if (mongoose.Types.ObjectId.isValid(filename)) {
                file = await bucket.find({ _id: new mongoose.Types.ObjectId(filename) }).toArray();
            }
            if (!file || file.length === 0) {
                return res.status(404).json({ message: "File not found" });
            }
        }

        // If multiple files found (shouldn't happen with unique filenames), log warning
        if (file.length > 1) {
            console.warn(`Multiple files found with filename: ${filename}. Deleting first match.`);
        }

        const fileId = file[0]._id;
        await bucket.delete(fileId);
        res.status(200).json({ message: "Image deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// New function to get image by ID (more reliable than filename)
exports.serveImageById = async (req, res) => {
    try {
        const fileId = req.params.fileId;

        // Input validation
        if (!fileId) {
            return res.status(400).json({ message: "File ID is required" });
        }

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ message: "Invalid file ID format" });
        }

        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            // bucketName: "cloud_images",
            bucketName: "uploads",
        });

        const file = await bucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();

        if (!file || file.length === 0) {
            return res.status(404).json({ message: "File not found" });
        }

        const fileDoc = file[0];

        // Set appropriate headers
        // res.set({
        //     'Content-Type': fileDoc.contentType || 'application/octet-stream',
        //     'Content-Length': fileDoc.length,
        //     'Cache-Control': 'public, max-age=31536000'
        // });

        const downloadStream = bucket.openDownloadStream(fileDoc._id);
        downloadStream.pipe(res);

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: error.message });
        }
    }
};