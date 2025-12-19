const express = require('express');
const router = express.Router();
const Session = require('../models/Session');

// ✅ 1. CREATE SESSION (Data dalne ke liye)
router.post('/', async (req, res) => {
    try {
        const { mentorId, title, startTime, endTime } = req.body;

        const newSession = new Session({
            mentorId,
            title,
            startTime,
            endTime
        });

        await newSession.save();
        res.json({ success: true, session: newSession });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ 2. GET SESSIONS BY MENTOR ID
router.get('/:mentorId', async (req, res) => {
    try {
        const { mentorId } = req.params;

        // Database se sessions dhundo aur Time ke hisab se sort karo
        const sessions = await Session.find({ mentorId: mentorId }).sort({ startTime: 1 });

        if (!sessions) {
            return res.json({ success: true, sessions: [] });
        }

        res.json({ success: true, sessions });

    } catch (err) {
        console.error("Error fetching sessions:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

module.exports = router;
