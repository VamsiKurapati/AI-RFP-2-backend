/**
 * Response Time Logger Middleware
 * Logs response times for all requests to responseTime.log file
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/responseTime.log');

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
 * Response time logger middleware
 */
const responseTimeLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  
  res.end = function (chunk, encoding) {
    const responseTime = Date.now() - startTime;
    const timestamp = new Date().toISOString();
    
    // Extract request information
    const method = req.method;
    const url = req.originalUrl || req.url;
    const statusCode = res.statusCode;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user ? req.user._id || req.user.id : 'anonymous';
    
    // Log response time
    const logEntry = `${method} ${url} | Status: ${statusCode} | Response Time: ${responseTime}ms | IP: ${ip} | User: ${userId}`;
    writeLog(logEntry);
    
    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

module.exports = responseTimeLogger;

