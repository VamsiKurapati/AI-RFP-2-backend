/**
 * XSS Clean Middleware
 * Sanitizes request body, query, and params to prevent XSS attacks
 */

const xss = require('xss-clean');

/**
 * XSS Clean middleware
 * Uses xss-clean package to sanitize user input
 */
const xssClean = xss();

module.exports = xssClean;

