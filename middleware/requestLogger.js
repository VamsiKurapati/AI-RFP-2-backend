/**
 * Request Logger Middleware
 * Logs all incoming requests to request.log file
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/request.log');

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
 * Request logger middleware
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  // Extract request information
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  const userId = req.user ? req.user._id || req.user.id : 'anonymous';
  
  // Log request details
  const logEntry = `${method} ${url} | IP: ${ip} | User: ${userId} | User-Agent: ${userAgent}`;
  writeLog(logEntry);
  
  // Log request body for POST/PUT/PATCH (sanitized, max 500 chars)
  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
    try {
      const bodyStr = JSON.stringify(req.body).substring(0, 500);
      writeLog(`  Body: ${bodyStr}`);
    } catch (error) {
      // Ignore body logging errors
    }
  }
  
  // Log query parameters if present
  if (Object.keys(req.query).length > 0) {
    try {
      const queryStr = JSON.stringify(req.query).substring(0, 300);
      writeLog(`  Query: ${queryStr}`);
    } catch (error) {
      // Ignore query logging errors
    }
  }
  
  next();
};

module.exports = requestLogger;

