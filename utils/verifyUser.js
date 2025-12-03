const { errorHandler } = require("./error");
const jwt = require('jsonwebtoken');
const EmployeeProfile = require('../models/EmployeeProfile');
const { isTokenBlacklisted, isActiveToken, getUserIdFromToken } = require('./tokenManager');

const verifyUser = (roles) => async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next(errorHandler(401, "Unauthorized: Missing or malformed token"));
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return next(errorHandler(401, "Unauthorized: Token is empty or incorrect"));
        }

        // Check if token is blacklisted
        const isBlacklisted = await isTokenBlacklisted(token);
        if (isBlacklisted) {
            return next(errorHandler(401, "Unauthorized: Token has been revoked"));
        }

        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return next(errorHandler(403, `Forbidden: ${err}`));
            }

            const user = decoded.user;
            if (!user || !user.role) {
                return next(errorHandler(401, "Unauthorized: Invalid user payload"));
            }

            // Check if this is the active token for the user (single-device login)
            const userId = user._id || user.id;
            const isActive = await isActiveToken(userId, token);
            if (!isActive) {
                return next(errorHandler(401, "Unauthorized: This session has been invalidated. Please login again."));
            }

            if (roles.length === 1 && roles[0] === "company") {
                if (user.role !== "company") {
                    return next(errorHandler(403, "Forbidden: User is not a company"));
                }
            }

            req.user = user;

            // If user's role is allowed directly
            if (roles.includes(req.user.role)) {
                return next();
            }

            // If user is employee, and accessLevel matches allowed roles
            if (req.user.role === "employee") {
                const employeeProfile = await EmployeeProfile.findOne({ userId: user._id });
                const accessLevel = employeeProfile.accessLevel || "Viewer";
                if (roles.includes(accessLevel)) {
                    return next();
                }
                return next(errorHandler(403, "Forbidden: Role or access level not permitted"));
            }

            return next(errorHandler(403, "Forbidden: Role or access level not permitted"));
        });
    } catch (err) {
        return next(errorHandler(500, `Internal Server Error: ${err}`));
    }
};

module.exports = verifyUser;
