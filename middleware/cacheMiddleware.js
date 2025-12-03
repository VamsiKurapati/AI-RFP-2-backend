/**
 * Cache Middleware for Express Routes
 * Automatically caches GET request responses
 */

const { getCache, setCache, isRedisAvailable } = require('../utils/cache');

/**
 * Cache middleware factory
 * @param {Object} options - Cache options
 * @param {number} options.ttl - Time to live in seconds (default: 3600 = 1 hour)
 * @param {Function} options.keyGenerator - Custom function to generate cache key (optional)
 * @param {Function} options.shouldCache - Function to determine if response should be cached (optional)
 * @returns {Function} - Express middleware
 */
const cacheMiddleware = (options = {}) => {
    const {
        ttl = 3600, // Default: 1 hour
        keyGenerator = null,
        shouldCache = null
    } = options;

    return async (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Skip caching if Redis is not available
        if (!isRedisAvailable()) {
            return next();
        }

        // Generate cache key
        let cacheKey;
        if (keyGenerator && typeof keyGenerator === 'function') {
            cacheKey = keyGenerator(req);
        } else {
            // Default: Use URL with query params and user ID if authenticated
            const userPrefix = req.user ? `user:${req.user._id}:` : '';
            const queryString = req.url.split('?')[1] || '';
            cacheKey = `cache:${userPrefix}${req.originalUrl || req.url}`;
        }

        // Try to get from cache
        try {
            const cached = await getCache(cacheKey);
            if (cached !== null) {
                // Cache hit - return cached response
                return res.status(200).json(cached);
            }
        } catch (error) {
            console.error('Cache middleware: Error reading cache:', error.message);
            // Continue to next middleware on cache error
        }

        // Cache miss - intercept response to cache it
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            // Check if response should be cached
            if (shouldCache && typeof shouldCache === 'function') {
                if (!shouldCache(req, res, body)) {
                    return originalJson(body);
                }
            }

            // Don't cache error responses (4xx, 5xx)
            if (res.statusCode >= 400) {
                return originalJson(body);
            }

            // Cache the response (don't await to not block response)
            setCache(cacheKey, body, ttl).catch(err => {
                console.error('Cache middleware: Error setting cache:', err.message);
            });

            return originalJson(body);
        };

        next();
    };
};

/**
 * Helper function to generate cache key from request
 * @param {Object} req - Express request object
 * @param {string} prefix - Cache key prefix (default: 'cache')
 * @returns {string} - Cache key
 */
const generateCacheKey = (req, prefix = 'cache') => {
    const userPrefix = req.user ? `user:${req.user._id}:` : '';
    const queryString = req.url.split('?')[1] || '';
    return `${prefix}:${userPrefix}${req.originalUrl || req.url}`;
};

/**
 * Cache middleware for user-specific data
 * 30 minutes TTL
 */
const userCacheMiddleware = cacheMiddleware({
    ttl: 30 * 60, // 30 minutes
    keyGenerator: (req) => {
        if (!req.user) return null; // Don't cache if not authenticated
        return generateCacheKey(req, 'user-cache');
    }
});

/**
 * Cache middleware for public data (subscription plans, etc.)
 * 1 hour TTL
 */
const publicCacheMiddleware = cacheMiddleware({
    ttl: 60 * 60, // 1 hour
    keyGenerator: (req) => generateCacheKey(req, 'public-cache'),
    shouldCache: (req, res, body) => {
        // Only cache successful responses
        return res.statusCode === 200 && body && !body.error;
    }
});

/**
 * Cache middleware for frequently accessed data
 * 15 minutes TTL
 */
const frequentCacheMiddleware = cacheMiddleware({
    ttl: 15 * 60, // 15 minutes
    keyGenerator: (req) => generateCacheKey(req, 'frequent-cache')
});

module.exports = {
    cacheMiddleware,
    generateCacheKey,
    userCacheMiddleware,
    publicCacheMiddleware,
    frequentCacheMiddleware
};

