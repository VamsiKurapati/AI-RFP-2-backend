/**
 * XSS Clean Middleware
 * Sanitizes request body to prevent XSS attacks
 * Note: req.query and req.params are read-only in Express, so we only sanitize req.body
 * Query params and route params should be validated/sanitized at the route handler level if needed
 */

/**
 * Recursively sanitize strings in an object/array
 * @param {any} value - Value to sanitize
 * @returns {any} - Sanitized value
 */
const sanitizeValue = (value) => {
  if (typeof value === 'string') {
    // Remove potentially dangerous HTML/script tags
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const sanitized = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        sanitized[key] = sanitizeValue(value[key]);
      }
    }
    return sanitized;
  }
  return value;
};

/**
 * XSS Clean middleware
 * Only sanitizes request body (query and params are read-only in Express)
 */
const xssClean = (req, res, next) => {
  // Only sanitize request body (user-submitted data)
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
};

module.exports = xssClean;

