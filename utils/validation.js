const mongoose = require('mongoose');

// Email validation
const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};

// ObjectId validation
const validateObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

// Password validation
const validatePassword = (password) => {
    if (password.length < 8) return false;

    const uppercase = /[A-Z]/;
    const lowercase = /[a-z]/;
    const digits = /[0-9]/;
    const special = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/;

    return uppercase.test(password) &&
        lowercase.test(password) &&
        digits.test(password) &&
        special.test(password);
};

// Phone number validation
const validatePhone = (phone) => {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone);
};

// File validation
const validateFile = (file, options = {}) => {
    const errors = [];
    const {
        maxSize = 5 * 1024 * 1024, // 5MB default
        allowedTypes = ['application/pdf', 'text/plain', 'image/jpeg', 'image/png'],
        allowedExtensions = ['.pdf', '.txt', '.jpg', '.jpeg', '.png']
    } = options;

    if (!file) {
        errors.push({ type: 'NO_FILE', message: 'No file provided' });
        return { isValid: false, errors };
    }

    // File size validation
    if (file.size > maxSize) {
        errors.push({
            type: 'SIZE_LIMIT_EXCEEDED',
            message: `File size too large. Maximum size is ${Math.round(maxSize / (1024 * 1024))}MB.`,
            currentSize: file.size,
            maxSize: maxSize
        });
    }

    // File type validation
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (!allowedTypes.includes(file.mimetype) && !allowedExtensions.includes(fileExtension)) {
        errors.push({
            type: 'INVALID_FILE_TYPE',
            message: 'Invalid file type.',
            allowedTypes: allowedTypes,
            receivedType: file.mimetype,
            receivedExtension: fileExtension
        });
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

// Sanitize input
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;

    return input
        .trim()
        .replace(/[<>]/g, '') // Remove potential HTML tags
        .substring(0, 1000); // Limit length
};

// Validate required fields
const validateRequiredFields = (data, requiredFields) => {
    const missingFields = [];

    requiredFields.forEach(field => {
        if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
            missingFields.push(field);
        }
    });

    return {
        isValid: missingFields.length === 0,
        missingFields
    };
};

// Validate array of objects
const validateArrayOfObjects = (array, schema) => {
    if (!Array.isArray(array)) {
        return { isValid: false, error: 'Expected an array' };
    }

    const errors = [];

    array.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
            errors.push({ index, error: 'Expected an object' });
            return;
        }

        Object.keys(schema).forEach(key => {
            if (schema[key].required && !item[key]) {
                errors.push({ index, field: key, error: 'Required field missing' });
            }

            if (item[key] && schema[key].type && typeof item[key] !== schema[key].type) {
                errors.push({ index, field: key, error: `Expected ${schema[key].type}` });
            }
        });
    });

    return {
        isValid: errors.length === 0,
        errors
    };
};

module.exports = {
    validateEmail,
    validateObjectId,
    validatePassword,
    validatePhone,
    validateFile,
    sanitizeInput,
    validateRequiredFields,
    validateArrayOfObjects
};
