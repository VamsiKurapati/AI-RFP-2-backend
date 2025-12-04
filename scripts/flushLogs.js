/**
 * Log Flush Script
 * Command-line utility to flush log files
 * 
 * Usage:
 *   node scripts/flushLogs.js [log-type]
 * 
 * Examples:
 *   node scripts/flushLogs.js              - Flush all logs
 *   node scripts/flushLogs.js request     - Flush only request.log
 *   node scripts/flushLogs.js responseTime - Flush only responseTime.log
 *   node scripts/flushLogs.js error       - Flush only error.log
 *   node scripts/flushLogs.js xss         - Flush only xss.log (if exists)
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../logs');

// Define log files
const LOG_FILES = {
  request: 'request.log',
  responseTime: 'responseTime.log',
  error: 'error.log',
  xss: 'xss.log'
};

/**
 * Flush a specific log file
 * @param {string} logFileName - Name of the log file to flush
 */
const flushLogFile = (logFileName) => {
  const logPath = path.join(LOGS_DIR, logFileName);
  
  if (!fs.existsSync(logPath)) {
    console.log(`Log file ${logFileName} does not exist.`);
    return false;
  }
  
  try {
    fs.writeFileSync(logPath, '', { encoding: 'utf8' });
    console.log(`✓ Flushed ${logFileName}`);
    return true;
  } catch (error) {
    console.error(`✗ Error flushing ${logFileName}: ${error.message}`);
    return false;
  }
};

/**
 * Flush all log files
 */
const flushAllLogs = () => {
  console.log('Flushing all log files...\n');
  
  let flushedCount = 0;
  
  Object.values(LOG_FILES).forEach(logFileName => {
    if (flushLogFile(logFileName)) {
      flushedCount++;
    }
  });
  
  console.log(`\nFlushed ${flushedCount} log file(s).`);
};

// Main execution
const main = () => {
  // Ensure logs directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    console.log('Created logs directory.');
  }
  
  // Get command line argument
  const logType = process.argv[2];
  
  if (!logType) {
    // No argument provided - flush all logs
    flushAllLogs();
  } else {
    // Flush specific log type
    const logFileName = LOG_FILES[logType];
    
    if (!logFileName) {
      console.error(`Invalid log type: ${logType}`);
      console.log('\nAvailable log types:');
      Object.keys(LOG_FILES).forEach(key => {
        console.log(`  - ${key}`);
      });
      process.exit(1);
    }
    
    flushLogFile(logFileName);
  }
};

// Run the script
main();

