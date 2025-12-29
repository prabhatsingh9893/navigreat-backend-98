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
const Review = require('./models/Review');
const { body, validationResult } = require('express-validator'); // 🛡️ Validator
const { cacheMiddleware } = require('./middleware/cache'); // ⚡ Caching Middleware

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

// 2.5 FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const resetToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '15m' });
        const resetLink = `https://navigreat98.vercel.app/reset-password/${resetToken}`;

        await sendEmail({
            to: email,
            subject: "Reset Password | Navigreat",
            html: `<h3>Reset Password</h3><p>Click <a href="${resetLink}">here</a> to reset your password.</p><p>Or copy: ${resetLink}</p><p>Valid for 15 mins.</p>`
        });

        res.json({ success: true, message: "Reset link sent to email." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Error processing request" });
    }
});

// 2.6 RESET PASSWORD
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await User.findById(decoded.id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true, message: "Password updated! Please login." });
    } catch (e) {
        res.status(400).json({ success: false, message: "Invalid or Expired Link" });
    }
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
app.get('/api/mentors', cacheMiddleware(300), async (req, res) => {
    try {
        const mentors = await User.find({ role: 'mentor' }).select('-password');
        res.json({ success: true, mentors });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 5. GET SINGLE MENTOR
app.get('/api/mentors/:id', cacheMiddleware(180), async (req, res) => {
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
app.get('/api/lectures/:mentorId', cacheMiddleware(300), async (req, res) => {
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

// 11. GET BOOKINGS (Smart)
app.get('/api/my-bookings', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role || 'student';

        let query = {};
        if (role === 'mentor') {
            query = { mentorId: userId };
        } else {
            // For students
            query = { studentId: userId };
        }

        const bookings = await Booking.find(query).sort({ date: -1 });
        res.json({ success: true, bookings, role });
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
// 13. GET CONTACTS (Chat Sidebar with Metadata)
app.get('/api/contacts', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Find all messages where I am sender OR receiver
        const messages = await Message.find({
            $or: [{ sender: userId }, { receiver: userId }]
        }).sort({ timestamp: -1 });

        const contactIds = new Set();
        messages.forEach(m => {
            const s = m.sender.toString();
            const r = m.receiver.toString();
            if (s !== userId) contactIds.add(s);
            if (r !== userId) contactIds.add(r);
        });

        // Add Booking Contacts
        if (req.user.role === 'mentor') {
            const bookings = await Booking.find({ mentorId: userId });
            bookings.forEach(b => contactIds.add(b.studentId.toString()));
        } else {
            const bookings = await Booking.find({ studentId: userId });
            bookings.forEach(b => contactIds.add(b.mentorId.toString()));
        }

        const contactsData = [];
        for (const contactId of contactIds) {
            const user = await User.findById(contactId).select('username email image role college branch');
            if (!user) continue;

            const lastMsg = await Message.findOne({
                $or: [
                    { sender: userId, receiver: contactId },
                    { sender: contactId, receiver: userId }
                ]
            }).sort({ timestamp: -1 });

            // Count Unread (Where Sender = Contact, Receiver = Me, Read = False)
            const unreadCount = await Message.countDocuments({
                sender: contactId,
                receiver: userId,
                read: false
            });

            contactsData.push({
                _id: user._id,
                username: user.username,
                image: user.image,
                role: user.role,
                college: user.college,
                branch: user.branch,
                lastMessage: lastMsg ? lastMsg.content : "",
                lastMessageTime: lastMsg ? lastMsg.timestamp : null,
                unreadCount
            });
        }

        // Sort by last message time
        contactsData.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0));

        res.json({ success: true, contacts: contactsData });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Error fetching contacts" });
    }
});

// 14. GET MESSAGES (Chat History) & MARK READ
app.get('/api/messages/:otherUserId', verifyToken, async (req, res) => {
    try {
        const myId = req.user.id;
        const otherId = req.params.otherUserId;

        // Mark messages from otherId as READ
        await Message.updateMany(
            { sender: otherId, receiver: myId, read: false },
            { $set: { read: true } }
        );

        const messages = await Message.find({
            $or: [
                { sender: myId, receiver: otherId },
                { sender: otherId, receiver: myId }
            ]
        }).sort({ timestamp: 1 });

        res.json({ success: true, messages });
    } catch (err) { res.status(500).json({ success: false, message: "Error fetching messages" }); }
});

// --- REVIEWS ---
app.post('/api/reviews', verifyToken, async (req, res) => {
    try {
        const { mentorId, rating, comment } = req.body;
        const studentId = req.user.id;
        const studentName = req.user.username;

        const review = new Review({
            mentorId,
            studentId,
            studentName,
            rating,
            comment
        });

        await review.save();
        res.status(201).json({ success: true, message: "Thank you for your feedback!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.get('/api/reviews/:mentorId', async (req, res) => {
    try {
        const reviews = await Review.find({ mentorId: req.params.mentorId }).sort({ timestamp: -1 });
        res.json({ success: true, reviews });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
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
            const { sender, receiver, content, messageType, audioUrl } = data;
            const newMessage = new Message({
                sender,
                receiver,
                content: content || "",
                messageType: messageType || 'text',
                audioUrl: audioUrl || ""
            });
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