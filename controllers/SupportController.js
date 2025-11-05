const Support = require('../models/Support');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { deleteMultipleGridFSFiles } = require('../utils/fileCleanup');

// Create ticket API
exports.createTicket = async (req, res) => {
  let uploadedFileIds = [];

  try {
    const { userId, category, subCategory, description, plan_name } = req.body;

    // Input validation
    if (!userId || !description) {
      return res.status(400).json({ message: "userId and description are required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const attachments = [];

    if (req.files && req.files.length > 0) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads',
      });

      for (const file of req.files) {
        const uploadStream = bucket.openUploadStream(file.originalname, {
          metadata: { originalname: file.originalname }
        });

        uploadStream.end(file.buffer);

        // Store file ID for potential cleanup
        uploadedFileIds.push(uploadStream.id);

        attachments.push({
          fileName: file.originalname,
          fileUrl: uploadStream.id.toString(),
          uploadedAt: new Date()
        });
      }
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const ticket = new Support({
        userId: new mongoose.Types.ObjectId(userId),
        category,
        subCategory,
        description,
        attachments,
        plan_name
      });

      const savedTicket = await ticket.save({ session });

      const notification = new Notification({
        type: "Support",
        title: "New support ticket created",
        description: "A support ticket has been created",
        created_at: new Date(),
      });
      await notification.save({ session });

      await session.commitTransaction();

      res.status(201).json({ message: "Ticket created successfully", ticket: savedTicket });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (err) {
    // Clean up uploaded files if ticket creation fails
    if (uploadedFileIds.length > 0) {
      await deleteMultipleGridFSFiles(uploadedFileIds);
    }

    res.status(500).json({ message: "Error creating ticket", error: err.message });
  }
};

// Get tickets for a specific user API
exports.getUserTickets = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // Direct match since userId is stored as string
    const tickets = await Support.find({ userId })
      .sort({ createdAt: -1 });

    res.json({ tickets });
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ message: "Error fetching tickets", error: err.message });
  }
};

// Controller to update the status of a support ticket (e.g., from 'Completed' to 'Re-Opened')
exports.reopenSupportTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: "Support ticket ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid support ticket ID format" });
    }

    // Find the ticket by ID
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    // Only allow reopening if the current status is 'Completed'
    if (ticket.status !== 'Completed' && ticket.status !== 'Withdrawn') {
      return res.status(400).json({ message: "Only completed and withdrawn tickets can be re-opened" });
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      ticket.status = 'Created';
      ticket.isOpen = true;
      await ticket.save({ session });

      const notification = new Notification({
        type: "Support",
        title: "Support ticket re-opened",
        description: "A support ticket has been re-opened",
        created_at: new Date(),
      });
      await notification.save({ session });

      await session.commitTransaction();

      res.json({ message: "Ticket status updated to Re-Opened", ticket });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (err) {
    res.status(500).json({ message: "Error updating ticket status", error: err.message });
  }
};

exports.withdrawnSupportTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the ticket by ID
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    // Only allow reopening if the current status is 'Completed'
    // if (ticket.status !== 'Completed') {
    //   return res.status(400).json({ message: "Only completed tickets can be re-opened" });
    // }

    ticket.status = 'Withdrawn';
    // ticket.isOpen = true;
    await ticket.save();

    res.json({ message: "Ticket status updated to Re-Opened", ticket });
  } catch (err) {
    res.status(500).json({ message: "Error updating ticket status", error: err.message });
  }
};





exports.addUserMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    const updatedSupport = await Support.findByIdAndUpdate(
      id,
      { $push: { userMessages: { message } } },
      { new: true }
    );

    if (!updatedSupport) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    res.json(updatedSupport);
  } catch (err) {
    res.status(500).json({ message: "Error adding user message", error: err.message });
  }
};


exports.getUserMessages = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the ticket by ID
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    // Return the userMessages array
    res.json({ userMessages: ticket.userMessages });
  } catch (err) {
    res.status(500).json({ message: "Error retrieving user messages", error: err.message });
  }
};

exports.getAdminMessages = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the ticket by ID
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Support ticket not found" });
    }

    // Return the adminMessages array
    res.json({ adminMessages: ticket.adminMessages });
  } catch (err) {
    res.status(500).json({ message: "Error retrieving admin messages", error: err.message });
  }
};
