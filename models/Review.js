const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentName: { type: String, required: true }, // Cache for easier display
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
    timestamp: { type: Date, default: Date.now }
});

ReviewSchema.index({ mentorId: 1 });
ReviewSchema.index({ studentId: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
