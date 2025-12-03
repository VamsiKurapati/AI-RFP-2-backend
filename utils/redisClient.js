/**
 * Redis Client Configuration and Connection
 * Handles Redis connection for caching
 */

const redis = require('redis');
require('dotenv').config();

let redisClient = null;

/**
 * Initialize Redis client
 * Supports:
 * - REDIS_URL
 * - or REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_DB
 */
const initRedis = async () => {
    try {
        // Reuse existing client if already connected/connecting
        if (redisClient && redisClient.isOpen) {
            return redisClient;
        }

        const redisUrl = process.env.REDIS_URL && process.env.REDIS_URL.trim();

        const defaultHost = (process.env.REDIS_HOST || '127.0.0.1').trim();
        const defaultPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const defaultPassword = process.env.REDIS_PASSWORD
            ? process.env.REDIS_PASSWORD.trim()
            : undefined;
        const defaultDatabase = parseInt(process.env.REDIS_DB || '0', 10);

        const socketOptions = {
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.error('Redis: Too many reconnection attempts, giving up');
                    return new Error('Too many retries');
                }
                const delay = Math.min(retries * 200, 3000);
                return delay;
            },
            connectTimeout: 5000 // 5 second connection timeout
        };

        if (redisUrl) {
            // Preferred: use full URL from provider
            console.log('Redis: Initializing with REDIS_URL');
            redisClient = redis.createClient({
                url: redisUrl,
                socket: socketOptions
            });
        } else {
            console.log('Redis: Initializing with host/port/password');
            console.log('Redis: Config ->', {
                host: defaultHost,
                port: defaultPort,
                hasPassword: !!defaultPassword,
                database: defaultDatabase
            });

            redisClient = redis.createClient({
                socket: {
                    host: defaultHost,
                    port: defaultPort,
                    ...socketOptions
                },
                password: defaultPassword,                 // will send AUTH if present
                database: isNaN(defaultDatabase) ? 0 : defaultDatabase
            });
        }

        // Event listeners
        redisClient.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        redisClient.on('connect', () => {
            console.log('Redis: Connecting...');
        });

        redisClient.on('ready', () => {
            console.log('Redis: Connected and ready');
        });

        redisClient.on('reconnecting', () => {
            console.log('Redis: Reconnecting...');
        });

        await redisClient.connect();

        const connectionInfo =
            redisUrl || `${defaultHost}:${defaultPort}/${defaultDatabase}`;
        console.log(`Redis: Successfully connected to ${connectionInfo}`);

        return redisClient;
    } catch (error) {
        console.error('Redis: Connection error:', error.message);
        console.log('Redis: Continuing without cache. Make sure Redis is installed and running.');
        return null;
    }
};

/**
 * Get Redis client instance
 */
const getRedisClient = () => {
    return redisClient;
};

/**
 * Check if Redis is available
 */
const isRedisAvailable = () => {
    return redisClient !== null && redisClient.isReady;
};

/**
 * Close Redis connection gracefully
 */
const closeRedis = async () => {
    if (redisClient && redisClient.isReady) {
        try {
            await redisClient.quit();
            console.log('Redis: Connection closed');
        } catch (error) {
            console.error('Redis: Error closing connection:', error.message);
        }
    }
};

// Handle process termination
process.on('SIGINT', async () => {
    await closeRedis();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeRedis();
    process.exit(0);
});

module.exports = {
    initRedis,
    getRedisClient,
    isRedisAvailable,
    closeRedis
};
