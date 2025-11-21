const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Database connection with connection pooling configuration
 */
const dbConnect = async () => {
    try {
        console.log("Attempting to connect to DB...");

        // Connection pool options
        const connectionOptions = {
            // Maximum number of connections in the pool (default: 10)
            maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '200'),

            // Minimum number of connections in the pool (default: 5)
            minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '5'),

            // Maximum time to wait for a connection to become available (ms)
            maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME_MS || '30000'),

            // Connection timeout (ms)
            serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT_MS || '5000'),

            // Socket timeout (ms)
            socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS || '45000'),

            // // Family preference for IP addresses (4 = IPv4, 6 = IPv6)
            // family: 4,

            // Retry connection attempts
            retryWrites: true,
            retryReads: true
        };

        await mongoose.connect(process.env.MONGO_URI, connectionOptions);

        // Connection event handlers
        mongoose.connection.on('connected', () => {
            console.log('Database: Connected to MongoDB');
            console.log(`Database: Pool size - Min: ${connectionOptions.minPoolSize}, Max: ${connectionOptions.maxPoolSize}`);
        });

        mongoose.connection.on('error', (err) => {
            console.error('Database: Connection error:', err.message);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('Database: Disconnected from MongoDB');
        });

        console.log("Database connection successful!");
    } catch (error) {
        console.log("Error connecting to DB");
        console.error(error.message);
        process.exit(1); // Exit the process with failure code
    }
};

/**
 * Gracefully close database connection
 */
const dbDisconnect = async () => {
    try {
        await mongoose.connection.close();
        console.log('Database: Connection closed gracefully');
    } catch (error) {
        console.error('Database: Error closing connection:', error.message);
    }
};

// Handle process termination
process.on('SIGINT', async () => {
    await dbDisconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await dbDisconnect();
    process.exit(0);
});

module.exports = dbConnect;
module.exports.dbDisconnect = dbDisconnect;