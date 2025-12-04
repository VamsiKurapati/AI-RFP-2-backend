/**
 * Centralized Error Logger Middleware
 * Logs all errors to error.log file
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/error.log');

// Ensure logs directory exists
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Write log entry to file
 * @param {string} logEntry - Log entry to write
 */
const writeLog = (logEntry) => {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${logEntry}\n`;
    fs.appendFileSync(LOG_FILE, logLine, { encoding: 'utf8' });
  } catch (error) {
    // Silently fail - don't log to console as per requirements
  }
};

/**
 * Format error stack trace
 * @param {Error} error - Error object
 * @returns {string} - Formatted stack trace
 */
const formatError = (error) => {
  if (!error) return 'Unknown error';
  
  let errorStr = '';
  
  if (error.message) {
    errorStr += `Message: ${error.message}`;
  }
  
  if (error.stack) {
    errorStr += `\nStack: ${error.stack}`;
  }
  
  if (error.statusCode) {
    errorStr += `\nStatus Code: ${error.statusCode}`;
  }
  
  return errorStr;
};

/**
 * Centralized error logger middleware
 * Should be used as the last error handling middleware
 */
const errorLogger = (err, req, res, next) => {
  const timestamp = new Date().toISOString();
  
  // Extract request information
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  const userId = req.user ? req.user._id || req.user.id : 'anonymous';
  const statusCode = err.statusCode || 500;
  
  // Format error details
  const errorDetails = formatError(err);
  
  // Log error
  const logEntry = `ERROR | ${method} ${url} | Status: ${statusCode} | IP: ${ip} | User: ${userId} | User-Agent: ${userAgent}\n${errorDetails}`;
  writeLog(logEntry);
  
  // Log request body if available (for debugging)
  if (req.body && Object.keys(req.body).length > 0) {
    try {
      const bodyStr = JSON.stringify(req.body).substring(0, 500);
      writeLog(`  Request Body: ${bodyStr}`);
    } catch (error) {
      // Ignore body logging errors
    }
  }
  
  // Pass error to next error handler
  next(err);
};

module.exports = errorLogger;

