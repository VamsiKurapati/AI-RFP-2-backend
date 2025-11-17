const mongoose = require("mongoose");

const addOnPlanSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Add-on name is required'],
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
    },
    description: {
        type: String,
        trim: true,
        default: '',
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    type: {
        type: String,
        required: [true, 'Add-on type is required'],
        enum: {
            values: ['RFP Proposals Generation', 'Grant Proposal Generations', 'RFP + Grant Proposal Generations'],
            message: 'Type must be one of: RFP Proposals Generation, Grant Proposal Generations, RFP + Grant Proposal Generations'
        }
    },
    quantity: {
        type: Number,
        required: [true, 'Quantity is required'],
        min: [1, 'Quantity must be at least 1'],
        validate: {
            validator: Number.isInteger,
            message: 'Quantity must be an integer'
        }
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price must be positive'],
        validate: {
            validator: function (value) {
                return value >= 0;
            },
            message: 'Price must be a positive number'
        }
    },
    popular: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true // Automatically adds createdAt and updatedAt
});

// Database indexes for performance optimization
addOnPlanSchema.index({ isActive: 1 });
addOnPlanSchema.index({ name: 1 });
addOnPlanSchema.index({ type: 1 }); // Index for filtering by type

module.exports = mongoose.model("AddOnPlan", addOnPlanSchema);

