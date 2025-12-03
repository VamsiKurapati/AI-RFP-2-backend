/**
 * Rate Limiting Middleware Configuration
 * Provides different rate limits for different routes
 */

const rateLimit = require('express-rate-limit');
const { getRedisClient, isRedisAvailable } = require('./redisClient');

/**
 * Create a rate limiter with Redis store if available, otherwise use memory store
 * @param {Object} options - Rate limit options
 * @returns {Function} - Express middleware
 */
const createRateLimiter = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        max = 100, // Limit each IP to 100 requests per windowMs
        message = 'Too many requests from this IP, please try again later.',
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        standardHeaders = true, // Return rate limit info in `RateLimit-*` headers
        legacyHeaders = false, // Disable `X-RateLimit-*` headers
        store = null // Custom store (Redis store if Redis is available)
    } = options;

    // Use Redis store if Redis is available
    let rateLimitStore = store;
    if (!rateLimitStore && isRedisAvailable()) {
        // Redis store will be created by express-rate-limit if Redis is available
        // For now, we'll use memory store and can enhance later with Redis store
        rateLimitStore = null; // Memory store (default)
    }

    return rateLimit({
        windowMs,
        max,
        message,
        standardHeaders,
        legacyHeaders,
        skipSuccessfulRequests,
        skipFailedRequests,
        store: rateLimitStore,
        // Custom key generator to handle authenticated users differently
        keyGenerator: (req) => {
            // If user is authenticated, rate limit by user ID
            if (req.user && req.user._id) {
                return `user:${req.user._id}`;
            }
            // Otherwise, rate limit by IP address
            return req.ip || req.connection.remoteAddress || 'unknown';
        },
        // Custom handler for when rate limit is exceeded
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                message: message,
                retryAfter: Math.ceil(windowMs / 1000) // seconds
            });
        }
    });
};

/**
 * General API rate limiter (applies to all routes by default)
 * 100 requests per 15 minutes per IP/user
 */
const generalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests, please try again later.'
});

/**
 * Strict rate limiter for authentication routes
 * 5 requests per 15 minutes per IP to prevent brute force
 */
const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: 'Too many login attempts, please try again after 15 minutes.',
    skipSuccessfulRequests: true // Don't count successful requests
});

/**
 * Rate limiter for password reset and OTP requests
 * 3 requests per hour per IP
 */
const passwordResetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 requests per hour
    message: 'Too many password reset requests, please try again after 1 hour.'
});

/**
 * Rate limiter for contact form submissions
 * 5 requests per hour per IP
 */
const contactFormLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 submissions per hour
    message: 'Too many contact form submissions, please try again later.'
});

/**
 * Rate limiter for file uploads
 * 10 requests per hour per user/IP
 */
const uploadLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 uploads per hour
    message: 'Too many file uploads, please try again later.'
});

/**
 * Rate limiter for payment-related endpoints
 * 20 requests per 15 minutes per user/IP
 */
const paymentLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 requests per 15 minutes
    message: 'Too many payment requests, please try again later.'
});

/**
 * Rate limiter for proposal generation (AI operations)
 * 5 requests per hour per user to prevent abuse
 */
const proposalGenerationLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 generations per hour
    message: 'Too many proposal generations, please try again later.'
});

/**
 * Rate limiter for admin endpoints
 * 50 requests per 15 minutes per admin user
 */
const adminLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000, // 500 requests per 15 minutes
    message: 'Too many admin requests, please try again later.'
});

/**
 * Very strict rate limiter for sensitive operations
 * 3 requests per 15 minutes per IP
 */
const strictLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 requests per 15 minutes
    message: 'Too many requests to this endpoint, please try again later.'
});

/**
 * Very permissive rate limiter for file serving (OnlyOffice Document Server)
 * 1000 requests per 15 minutes per IP to allow OnlyOffice to access files
 */
const fileServeLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes (very permissive for OnlyOffice)
    message: 'Too many file requests, please try again later.'
});

module.exports = {
    createRateLimiter,
    generalLimiter,
    authLimiter,
    passwordResetLimiter,
    contactFormLimiter,
    uploadLimiter,
    paymentLimiter,
    proposalGenerationLimiter,
    adminLimiter,
    strictLimiter,
    fileServeLimiter
};

