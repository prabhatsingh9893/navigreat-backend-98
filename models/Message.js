const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: "" }, // Made optional for audio-only messages if needed, or stick to required string (base64)
    messageType: { type: String, enum: ['text', 'audio'], default: 'text' },
    audioUrl: { type: String, default: "" }, // Can store Base64 here or URL
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});

// 🚀 Performance Index
MessageSchema.index({ sender: 1, receiver: 1, timestamp: 1 });

module.exports = mongoose.model('Message', MessageSchema);
