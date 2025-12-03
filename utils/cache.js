/**
 * Redis Cache Utility Functions
 * Provides high-level caching functions with automatic JSON serialization
 */

const { getRedisClient, isRedisAvailable } = require('./redisClient');

/**
 * Set cache with expiration (in seconds)
 * @param {string} key - Cache key
 * @param {any} value - Value to cache (will be JSON stringified)
 * @param {number} ttl - Time to live in seconds (default: 3600 = 1 hour)
 */
const setCache = async (key, value, ttl = 3600) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const client = getRedisClient();
        const stringValue = JSON.stringify(value);
        await client.setEx(key, ttl, stringValue);
        return true;
    } catch (error) {
        console.error(`Cache: Error setting key ${key}:`, error.message);
        return false;
    }
};

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {any|null} - Cached value (parsed from JSON) or null if not found
 */
const getCache = async (key) => {
    if (!isRedisAvailable()) {
        return null;
    }

    try {
        const client = getRedisClient();
        const cached = await client.get(key);

        if (cached === null) {
            return null;
        }

        return JSON.parse(cached);
    } catch (error) {
        console.error(`Cache: Error getting key ${key}:`, error.message);
        return null;
    }
};

/**
 * Delete cache key
 * @param {string} key - Cache key to delete
 */
const deleteCache = async (key) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const client = getRedisClient();
        await client.del(key);
        return true;
    } catch (error) {
        console.error(`Cache: Error deleting key ${key}:`, error.message);
        return false;
    }
};

/**
 * Delete multiple cache keys by pattern
 * @param {string} pattern - Pattern to match (e.g., 'user:*')
 */
const deleteCacheByPattern = async (pattern) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const client = getRedisClient();
        const keys = await client.keys(pattern);

        if (keys.length > 0) {
            await client.del(keys);
        }

        return true;
    } catch (error) {
        console.error(`Cache: Error deleting keys by pattern ${pattern}:`, error.message);
        return false;
    }
};

/**
 * Clear all cache (use with caution!)
 */
const clearAllCache = async () => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const client = getRedisClient();
        await client.flushDb();
        return true;
    } catch (error) {
        console.error('Cache: Error clearing all cache:', error.message);
        return false;
    }
};

/**
 * Check if key exists in cache
 * @param {string} key - Cache key
 */
const existsCache = async (key) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const client = getRedisClient();
        const exists = await client.exists(key);
        return exists === 1;
    } catch (error) {
        console.error(`Cache: Error checking key ${key}:`, error.message);
        return false;
    }
};

/**
 * Get remaining TTL for a key
 * @param {string} key - Cache key
 * @returns {number} - TTL in seconds, -1 if key exists but has no expiration, -2 if key doesn't exist
 */
const getTTL = async (key) => {
    if (!isRedisAvailable()) {
        return -2;
    }

    try {
        const client = getRedisClient();
        return await client.ttl(key);
    } catch (error) {
        console.error(`Cache: Error getting TTL for key ${key}:`, error.message);
        return -2;
    }
};

/**
 * Cache helper: Try to get from cache, if not found, execute function and cache result
 * @param {string} key - Cache key
 * @param {Function} fetchFunction - Function to execute if cache miss
 * @param {number} ttl - Time to live in seconds (default: 3600)
 * @returns {any} - Cached or freshly fetched value
 */
const getOrSetCache = async (key, fetchFunction, ttl = 3600) => {
    // Try to get from cache first
    const cached = await getCache(key);
    if (cached !== null) {
        return cached;
    }

    // Cache miss - execute fetch function
    try {
        const value = await fetchFunction();
        // Cache the result (don't await to not block response)
        setCache(key, value, ttl).catch(err => {
            console.error(`Cache: Error setting cache for key ${key}:`, err.message);
        });
        return value;
    } catch (error) {
        console.error(`Cache: Error in fetchFunction for key ${key}:`, error.message);
        throw error;
    }
};

module.exports = {
    setCache,
    getCache,
    deleteCache,
    deleteCacheByPattern,
    clearAllCache,
    existsCache,
    getTTL,
    getOrSetCache,
    isRedisAvailable // Export isRedisAvailable for use in other modules
};

