require('dotenv').config({ override: true }); // 🔐 Secure Variables Load (Force File Override)
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('./utils/sendEmail');
const KJUR = require('jsrsasign');
const http = require('http');
const { Server } = require("socket.io");
const Message = require('./models/Message');
const { body, validationResult } = require('express-validator'); // 🛡️ Validator

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "https://navigreat.vercel.app", "https://prabhatsingh9893.github.io", "https://navigreat98.vercel.app"],
        methods: ["GET", "POST"],
        credentials: true
    }
});
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// ================= IMPORTS =================
// Note: Baki models inline hain, par Session humne alag file me rakha hai
const Session = require('./models/Session');
const sessionRoutes = require('./routes/sessions'); // 👈 Sessions Route Import

// ================= MIDDLEWARE =================
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://navigreat.vercel.app",
        "https://prabhatsingh9893.github.io",
        "https://navigreat98.vercel.app"
    ],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🛡️ AUTH MIDDLEWARE (Suraksha Kavach)
const verifyToken = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ success: false, message: "Access Denied" });

    try {
        const verified = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ success: false, message: "Invalid Token" });
    }
};

// ================= DATABASE CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ================= INLINE MODELS (Existing) =================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'student', enum: ['student', 'mentor'] },
    college: { type: String, default: '' },
    branch: { type: String, default: '' },
    image: { type: String, default: '' },
    about: { type: String, default: '' },
    meetingId: { type: String, default: '' }, // ✅ Added for Zoom
    passcode: { type: String, default: '' }   // ✅ Added for Zoom
}, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const ContactSchema = new mongoose.Schema({ name: String, email: String, message: String, date: { type: Date, default: Date.now } });
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);

const BookingSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    studentEmail: String,
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mentorName: String,
    message: { type: String, default: '' },
    date: { type: Date, default: Date.now }
});
const Booking = mongoose.models.Booking || mongoose.model('Booking', BookingSchema);

const LectureSchema = new mongoose.Schema({
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Lecture = mongoose.models.Lecture || mongoose.model('Lecture', LectureSchema);


// ================= ROUTES CONFIGURATION =================
// 👇 Isse /api/sessions activate ho jayega (routes/sessions.js file use hogi)
app.use('/api/sessions', sessionRoutes);


// ================= API ROUTES =================

app.get('/', (req, res) => {
    const dbStatus = ['Disconnected', 'Connected', 'Connecting', 'Disconnecting'][mongoose.connection.readyState];
    res.send(`NaviGreat Backend is Running! 🚀 | MongoDB Status: ${dbStatus}`);
});

// 🎥 ZOOM SIGNATURE API
// 🎥 ZOOM SIGNATURE API (Secured 🔒)
app.post('/api/generate-signature', verifyToken, (req, res) => {
    try {
        // 1. Check if user is a Mentor
        if (req.user.role !== 'mentor' && req.body.role === 1) {
            return res.status(403).json({ success: false, message: "Unauthorized to Start Meeting" });
        }

        if (!process.env.ZOOM_CLIENT_ID || !process.env.ZOOM_CLIENT_SECRET) {
            console.error("❌ Missing Zoom Env Vars");
            return res.status(500).json({ success: false, message: "Server Error: Zoom Keys Missing" });
        }

        const iat = Math.round(new Date().getTime() / 1000) - 30;
        const exp = iat + 60 * 60 * 2; // 2 Hours

        const oHeader = { alg: 'HS256', typ: 'JWT' };
        const oPayload = {
            sdkKey: process.env.ZOOM_CLIENT_ID,
            mn: req.body.meetingNumber,
            role: parseInt(req.body.role, 10),
            iat: iat,
            exp: exp,
            appKey: process.env.ZOOM_CLIENT_ID,
            tokenExp: exp
        };

        const sHeader = JSON.stringify(oHeader);
        const sPayload = JSON.stringify(oPayload);
        const signature = KJUR.jws.JWS.sign('HS256', sHeader, sPayload, process.env.ZOOM_CLIENT_SECRET);

        res.json({ signature, sdkKey: process.env.ZOOM_CLIENT_ID });
    } catch (err) {
        console.error("Signature Gen Error:", err);
        res.status(500).json({ success: false, message: "Signature Generation Failed" });
    }
});

// 1. REGISTER USER
app.post('/api/auth/register', [
    body('email').isEmail().withMessage("Invalid Email Format"),
    body('password').isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body('username').notEmpty().withMessage("Username is required")
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    try {
        const { username, email, password, role, college, branch, image, about } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "❌ User already exists!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, role: role || 'student', college, branch, image, about });

        await newUser.save();
        const token = jwt.sign({ id: newUser._id, role: newUser.role }, JWT_SECRET); // ✅ Added role to token
        res.json({ success: true, message: "Registration Successful!", token, user: newUser });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 2. LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "❌ User not found!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "❌ Invalid Password!" });

        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET); // ✅ Added role to token
        res.json({ success: true, token, user: { ...user._doc }, message: "Login Successful!" });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 3. GOOGLE LOGIN
app.post('/api/google-login', async (req, res) => {
    try {
        const { username, email, image } = req.body;
        let user = await User.findOne({ email });
        if (!user) {
            const hashedPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);
            user = new User({ username, email, password: hashedPassword, role: 'student', image: image || '' });
            await user.save();
        }
        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET); // ✅ Added role to token
        res.json({ success: true, token, user: { ...user._doc }, message: "Google Login Successful!" });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 4. GET ALL MENTORS
app.get('/api/mentors', async (req, res) => {
    try {
        const mentors = await User.find({ role: 'mentor' }).select('-password');
        res.json({ success: true, mentors });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 5. GET SINGLE MENTOR
app.get('/api/mentors/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid ID" });
        const mentor = await User.findById(req.params.id).select('-password');
        if (!mentor) return res.status(404).json({ success: false, message: "Mentor not found" });
        res.json({ success: true, mentor });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 6. UPDATE PROFILE (Protected 🔒)
app.put('/api/mentors/:id', verifyToken, async (req, res) => {
    try {
        const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
        res.json({ success: true, message: "Profile Updated", mentor: updatedUser });
    } catch (error) { res.status(500).json({ success: false, message: "Update Failed" }); }
});

// 7. ADD LECTURE (Protected 🔒)
app.post('/api/lectures', verifyToken, async (req, res) => {
    try {
        const { mentorId, title, url } = req.body;
        const newLecture = new Lecture({ mentorId, title, url });
        await newLecture.save();
        res.json({ success: true, message: "Lecture Added!", lecture: newLecture });
    } catch (error) { res.status(500).json({ success: false, message: "Error saving lecture" }); }
});

// 8. DELETE LECTURE (Protected 🔒)
app.delete('/api/lectures/:id', verifyToken, async (req, res) => {
    try {
        await Lecture.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Lecture Deleted Successfully" });
    } catch (error) { res.status(500).json({ success: false, message: "Error deleting lecture" }); }
});

// 9. GET LECTURES
app.get('/api/lectures/:mentorId', async (req, res) => {
    try {
        const lectures = await Lecture.find({ mentorId: req.params.mentorId });
        res.json({ success: true, lectures });
    } catch (error) { res.status(500).json({ success: false, message: "Error fetching lectures" }); }
});

// 10. BOOKING (Updated)
app.post('/api/book', verifyToken, async (req, res) => {
    try {
        const { mentorId, mentorName, date, message } = req.body;
        const studentId = req.user.id;

        // Find Student to get email/name if needed (optional)
        const student = await User.findById(studentId);

        const newBooking = new Booking({
            studentEmail: student.email, // keeping for backward compatibility if needed
            studentId,
            mentorId,
            mentorName,
            message,
            date: date || Date.now()
        });

        await newBooking.save();

        // --- SEND EMAILS ---
        const mentor = await User.findById(mentorId);

        // 1. To Mentor
        if (mentor && mentor.email) {
            await sendEmail({
                to: mentor.email,
                subject: "New Session Booking Request | Navigreat",
                html: `<h3>Hello ${mentor.username},</h3>
                <p>You have a new booking request from a student.</p>
                <p><b>Student:</b> ${student.username} (${student.email})</p>
                <p><b>Message:</b> ${message || "Interested in mentorship."}</p>
                <p>Please check your dashboard to respond.</p>`
            });
        }

        // 2. To Student
        if (student && student.email) {
            await sendEmail({
                to: student.email,
                subject: "Booking Request Sent! | Navigreat",
                html: `<h3>Hello ${student.username},</h3>
                <p>Your booking request for mentor <b>${mentorName}</b> has been sent successfully.</p>
                <p>We will notify you once they confirm.</p>`
            });
        }

        res.json({ success: true, message: "Booking Confirmed! Emails Sent." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 11. GET BOOKINGS FOR MENTOR
app.get('/api/bookings/:mentorId', verifyToken, async (req, res) => {
    try {
        // Ensure the person asking is the mentor themselves
        if (req.user.id !== req.params.mentorId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        const bookings = await Booking.find({ mentorId: req.params.mentorId }).sort({ date: -1 });
        res.json({ success: true, bookings });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 12. CONTACT
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newMessage = new Contact({ name, email, message });
        await newMessage.save();
        res.json({ success: true, message: "Saved to Database!" });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

app.get('/api/contact', verifyToken, async (req, res) => {
    try {
        // Optional: Check for admin role
        // if (req.user.role !== 'admin') return res.status(403).json({ message: "Access Denied" });

        const messages = await Contact.find().sort({ createdAt: -1 });
        res.json({ success: true, messages });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 404 Handler (Should be the last middleware)
app.get('/api/zoom/callback', (req, res) => {
    const { code } = req.query;
    console.log("Zoom Auth Code Received:", code);
    res.send(`
        <div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
            <div style="text-align:center; padding:40px; border-radius:10px; background:#f0fdf4; color:#166534;">
                <h1>✅ App Authorized!</h1>
                <p>Navigreat has been linked to Zoom successfully.</p>
                <p>You can close this tab now.</p>
            </div>
        </div>
    `);
});

// Server Start
// 13. GET MESSAGES (Chat History)
app.get('/api/messages/:otherUserId', verifyToken, async (req, res) => {
    try {
        const myId = req.user.id;
        const otherId = req.params.otherUserId;

        const messages = await Message.find({
            $or: [
                { sender: myId, receiver: otherId },
                { sender: otherId, receiver: myId }
            ]
        }).sort({ timestamp: 1 });

        res.json({ success: true, messages });
    } catch (err) { res.status(500).json({ success: false, message: "Error fetching messages" }); }
});

// 🚀 SOCKET.IO LOGIC
io.on("connection", (socket) => {
    console.log(`⚡ Socket Connected: ${socket.id}`);

    socket.on("join_room", (userId) => {
        socket.join(userId);
        console.log(`User joined room: ${userId}`);
    });

    socket.on("send_message", async (data) => {
        try {
            const { sender, receiver, content } = data;
            const newMessage = new Message({ sender, receiver, content });
            await newMessage.save();

            // Send to Receiver
            io.to(receiver).emit("receive_message", newMessage);
            // Send back to Sender (optional, useful for confirmation)
            io.to(sender).emit("receive_message", newMessage);
        } catch (err) {
            console.error("Message Error:", err);
        }
    });

    // ⌨️ Typing Indicators
    socket.on("typing", (room) => socket.in(room).emit("display_typing"));
    socket.on("stop_typing", (room) => socket.in(room).emit("hide_typing"));

    socket.on("disconnect", () => {
        // console.log("User Disconnected", socket.id);
    });
});

// Server Start
server.listen(PORT, () => {
    console.log(`🚀 Server running on Port: ${PORT}`);
});