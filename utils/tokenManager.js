/**
 * JWT Token Management with Redis
 * Handles token blacklisting and single-device login control
 */

const { getCache, setCache, deleteCache, isRedisAvailable } = require('./cache');
const jwt = require('jsonwebtoken');

/**
 * Generate a unique token ID (jti - JWT ID)
 * This helps identify tokens for blacklisting
 */
const generateTokenId = () => {
    return `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Blacklist a token (add to blacklist until token expires)
 * @param {string} token - JWT token to blacklist
 * @param {number} expiresIn - Token expiration time in seconds
 */
const blacklistToken = async (token, expiresIn = 43200) => {
    if (!isRedisAvailable()) {
        console.warn('TokenManager: Redis not available, token blacklisting disabled');
        return false;
    }

    try {
        // Decode token to get expiration
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.exp) {
            return false;
        }

        // Calculate TTL (time until token expires)
        const now = Math.floor(Date.now() / 1000);
        const ttl = decoded.exp - now;

        if (ttl <= 0) {
            // Token already expired, no need to blacklist
            return true;
        }

        // Store token in blacklist with TTL matching token expiration
        const blacklistKey = `blacklist:token:${token}`;
        await setCache(blacklistKey, { blacklisted: true, blacklistedAt: new Date().toISOString() }, ttl);

        return true;
    } catch (error) {
        console.error('TokenManager: Error blacklisting token:', error.message);
        return false;
    }
};

/**
 * Check if a token is blacklisted
 * @param {string} token - JWT token to check
 * @returns {boolean} - True if token is blacklisted
 */
const isTokenBlacklisted = async (token) => {
    if (!isRedisAvailable()) {
        return false; // If Redis unavailable, assume not blacklisted
    }

    try {
        const blacklistKey = `blacklist:token:${token}`;
        const blacklisted = await getCache(blacklistKey);
        return blacklisted !== null;
    } catch (error) {
        console.error('TokenManager: Error checking token blacklist:', error.message);
        return false; // On error, allow token (fail open for availability)
    }
};

/**
 * Set the current active token for a user (single-device login)
 * @param {string} userId - User ID
 * @param {string} token - JWT token
 * @param {number} expiresIn - Token expiration time in seconds (default: 12 hours = 43200)
 */
const setActiveToken = async (userId, token, expiresIn = 43200) => {
    if (!isRedisAvailable()) {
        console.warn('TokenManager: Redis not available, single-device login disabled');
        return false;
    }

    try {
        const activeTokenKey = `user:active:token:${userId}`;
        await setCache(activeTokenKey, token, expiresIn);
        return true;
    } catch (error) {
        console.error('TokenManager: Error setting active token:', error.message);
        return false;
    }
};

/**
 * Get the current active token for a user
 * @param {string} userId - User ID
 * @returns {string|null} - Active token or null if not found
 */
const getActiveToken = async (userId) => {
    if (!isRedisAvailable()) {
        return null; // If Redis unavailable, allow any token
    }

    try {
        const activeTokenKey = `user:active:token:${userId}`;
        const activeToken = await getCache(activeTokenKey);
        return activeToken;
    } catch (error) {
        console.error('TokenManager: Error getting active token:', error.message);
        return null; // On error, allow token (fail open)
    }
};

/**
 * Check if a token is the active token for a user
 * @param {string} userId - User ID
 * @param {string} token - JWT token to check
 * @returns {boolean} - True if token is the active token
 */
const isActiveToken = async (userId, token) => {
    if (!isRedisAvailable()) {
        return true; // If Redis unavailable, allow any token
    }

    try {
        const activeToken = await getActiveToken(userId);
        if (!activeToken) {
            // No active token set, allow this token
            return true;
        }
        return activeToken === token;
    } catch (error) {
        console.error('TokenManager: Error checking active token:', error.message);
        return true; // On error, allow token (fail open)
    }
};

/**
 * Invalidate all tokens for a user (logout from all devices)
 * @param {string} userId - User ID
 */
const invalidateAllUserTokens = async (userId) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        // Delete active token
        const activeTokenKey = `user:active:token:${userId}`;
        await deleteCache(activeTokenKey);
        return true;
    } catch (error) {
        console.error('TokenManager: Error invalidating user tokens:', error.message);
        return false;
    }
};

/**
 * Invalidate previous token when user logs in (single-device login)
 * This blacklists the previous token if it exists
 * @param {string} userId - User ID
 */
const invalidatePreviousToken = async (userId) => {
    if (!isRedisAvailable()) {
        return false;
    }

    try {
        const activeTokenKey = `user:active:token:${userId}`;
        const previousToken = await getCache(activeTokenKey);

        if (previousToken) {
            // Blacklist the previous token
            await blacklistToken(previousToken);
        }

        return true;
    } catch (error) {
        console.error('TokenManager: Error invalidating previous token:', error.message);
        return false;
    }
};

/**
 * Extract user ID from token
 * @param {string} token - JWT token
 * @returns {string|null} - User ID or null
 */
const getUserIdFromToken = (token) => {
    try {
        const decoded = jwt.decode(token);
        return decoded?.user?._id || decoded?.user?.id || null;
    } catch (error) {
        return null;
    }
};

module.exports = {
    generateTokenId,
    blacklistToken,
    isTokenBlacklisted,
    setActiveToken,
    getActiveToken,
    isActiveToken,
    invalidateAllUserTokens,
    invalidatePreviousToken,
    getUserIdFromToken
};

