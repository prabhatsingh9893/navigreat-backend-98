const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  meetingLink: { type: String } // Optional: Agar Zoom link future me save karna ho
}, { timestamps: true });

module.exports = mongoose.models.Session || mongoose.model('Session', SessionSchema);