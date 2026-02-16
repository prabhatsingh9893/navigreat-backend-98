const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: {
        type: String,
        default: "",
        validate: {
            validator: function (v) {
                // If messageType is text, content should not be empty (unless intended)
                if (this.messageType === 'text') return v && v.trim().length > 0;
                return true;
            },
            message: 'Message content is required for text messages.'
        }
    },
    messageType: { type: String, enum: ['text', 'audio'], default: 'text' },
    audioUrl: {
        type: String,
        default: "",
        validate: {
            validator: function (v) {
                // If messageType is audio, audioUrl is required
                if (this.messageType === 'audio') return v && v.trim().length > 0;
                return true;
            },
            message: 'Audio URL is required for audio messages.'
        }
    },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});

// 🚀 Performance Index
MessageSchema.index({ sender: 1, receiver: 1, timestamp: 1 });

module.exports = mongoose.model('Message', MessageSchema);
