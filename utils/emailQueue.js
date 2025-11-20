/**
 * Priority-based Email Queue System
 * 
 * Priority levels:
 * 1 = Highest (Payment-related emails)
 * 2 = High (Important notifications like OTP, password reset)
 * 3 = Normal (General notifications)
 */

class EmailQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.processingInterval = null;
        this.processingDelay = 2000; // Process emails every 2 seconds
    }

    /**
     * Add email to queue with priority
     * @param {Object} emailData - { email, subject, body, priority }
     * @param {number} priority - 1 (highest) to 3 (normal)
     */
    enqueue(emailData, priority = 3) {
        if (!emailData.email || !emailData.subject || !emailData.body) {
            console.error('EmailQueue: Invalid email data provided');
            return;
        }

        const queueItem = {
            ...emailData,
            priority: priority,
            timestamp: Date.now(),
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        // Insert based on priority (lower number = higher priority)
        // For same priority, maintain FIFO order
        let inserted = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority > priority) {
                this.queue.splice(i, 0, queueItem);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            this.queue.push(queueItem);
        }

        //console.log(`EmailQueue: Email queued (Priority ${priority}, Queue size: ${this.queue.length})`);
    }

    /**
     * Get next email from queue (highest priority first)
     */
    dequeue() {
        if (this.queue.length === 0) {
            return null;
        }
        return this.queue.shift();
    }

    /**
     * Get queue size
     */
    size() {
        return this.queue.length;
    }

    /**
     * Check if queue is empty
     */
    isEmpty() {
        return this.queue.length === 0;
    }

    /**
     * Clear the queue
     */
    clear() {
        this.queue = [];
    }

    /**
     * Start processing the queue
     */
    startProcessing(processEmailFn) {
        if (this.processing) {
            //console.log('EmailQueue: Already processing');
            return;
        }

        this.processing = true;
        //console.log('EmailQueue: Started processing emails');

        const processNext = async () => {
            if (this.isEmpty()) {
                // Queue is empty, check again after delay
                this.processingInterval = setTimeout(processNext, this.processingDelay);
                return;
            }

            const emailItem = this.dequeue();
            if (emailItem) {
                try {
                    //console.log(`EmailQueue: Processing email (Priority ${emailItem.priority}, Remaining: ${this.size()})`);
                    await processEmailFn(emailItem.email, emailItem.subject, emailItem.body);
                    //console.log(`EmailQueue: Email sent successfully to ${emailItem.email}`);
                } catch (error) {
                    console.error(`EmailQueue: Failed to send email to ${emailItem.email}:`, error.message);
                    // Optionally: re-queue with lower priority or log to error queue
                    // For now, we'll just log the error
                }
            }

            // Process next email after a short delay
            this.processingInterval = setTimeout(processNext, this.processingDelay);
        };

        // Start processing
        processNext();
    }

    /**
     * Stop processing the queue
     */
    stopProcessing() {
        if (this.processingInterval) {
            clearTimeout(this.processingInterval);
            this.processingInterval = null;
        }
        this.processing = false;
        //console.log('EmailQueue: Stopped processing emails');
    }
}

// Create singleton instance
const emailQueue = new EmailQueue();

/**
 * Helper function to determine email priority based on email type
 * @param {string} emailType - Type of email (e.g., 'payment', 'otp', 'welcome')
 */
function getEmailPriority(emailType) {
    // Payment-related emails = Priority 1 (Highest)
    const paymentTypes = [
        'payment',
        'paymentSuccess',
        'paymentFailed',
        'refund',
        'refundNotification',
        'subscription',
        'subscriptionActivated',
        'subscriptionDeactivated',
        'subscriptionUpdated',
        'enterprisePlan',
        'enterprisePaymentSuccess',
        'enterprisePaymentFailed',
        'addOnActivated'
    ];

    // Important notifications = Priority 2
    const importantTypes = [
        'otp',
        'emailVerification',
        'passwordReset',
        'passwordResetSuccess',
        'passwordChanged',
        'loginAlert'
    ];

    if (paymentTypes.some(type => emailType.toLowerCase().includes(type.toLowerCase()))) {
        return 1;
    }

    if (importantTypes.some(type => emailType.toLowerCase().includes(type.toLowerCase()))) {
        return 2;
    }

    // Default to Priority 3 (Normal)
    return 3;
}

/**
 * Queue an email for sending
 * @param {string} email - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (HTML)
 * @param {number|string} priorityOrType - Priority (1-3) or email type string for auto-priority
 */
function queueEmail(email, subject, body, priorityOrType = 3) {
    let priority = priorityOrType;

    // If priorityOrType is a string, determine priority from type
    if (typeof priorityOrType === 'string') {
        priority = getEmailPriority(priorityOrType);
    }

    // Ensure priority is between 1 and 3
    priority = Math.max(1, Math.min(3, parseInt(priority) || 3));

    emailQueue.enqueue({ email, subject, body }, priority);
}

module.exports = {
    emailQueue,
    queueEmail,
    getEmailPriority
};

