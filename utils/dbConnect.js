const mongoose = require("mongoose");
require("dotenv").config();

const dbConnect = async () => {
    try {
        console.log("Attempting to connect to DB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Database connection successful!");
    } catch (error) {
        console.log("Error connecting to DB");
        console.error(error.message);
        process.exit(1); // Exit the process with failure code
    }
};

module.exports = dbConnect;