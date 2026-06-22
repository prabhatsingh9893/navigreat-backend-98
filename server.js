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
const { cacheMiddleware, clearCache } = require('./middleware/cache'); // ⚡ Caching Middleware

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('mongo-sanitize');
const xss = require('xss-clean');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:5173",
            "https://navigreat.vercel.app",
            "https://prabhatsingh9893.github.io",
            "https://navigreat98.vercel.app",
            "https://navigreat98.me",       // ✅ Custom Domain
            "https://www.navigreat98.me"    // ✅ WWW Version
        ],
        methods: ["GET", "POST"],
        credentials: true
    }
});
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("❌ CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing!");
    process.exit(1);
}

console.log("---------------------------------------------------");
console.log("🚀 Server Starting... v2");
console.log("---------------------------------------------------");

// ================= IMPORTS =================
const Session = require('./models/Session');
const sessionRoutes = require('./routes/sessions'); // 👈 Sessions Route Import
const paymentRoutes = require('./routes/payment'); // 💳 Paytm Payment Route Import

// ================= SECURITY & MIDDLEWARE =================
app.use(helmet()); // 🛡️ Secure HTTP Headers

// 🛡️ Rate Limiting (Prevent DDoS/Brute Force)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again after 15 minutes."
});
app.use(limiter);

app.use(express.json({ limit: '50mb' })); // Increased limit for images
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🛡️ Data Sanitization
app.use((req, res, next) => {
    req.body = mongoSanitize(req.body); // Prevent NoSQL Injection in Body
    req.query = mongoSanitize(req.query); // Prevent NoSQL Injection in URL Queries
    req.params = mongoSanitize(req.params); // Prevent NoSQL Injection in Path Parameters
    next();
});
app.use(xss()); // Prevent XSS Attacks

app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://navigreat.vercel.app",
        "https://prabhatsingh9893.github.io",
        "https://navigreat98.vercel.app",
        "https://navigreat98.me",       // ✅ New Custom Domain
        "https://www.navigreat98.me"    // ✅ WWW Version
    ],
    credentials: true
}));

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

// ================= FIREBASE ADMIN SETUP =================
let firebaseAdminEnabled = false;
try {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');
    const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        firebaseAdminEnabled = true;
        console.log("✅ Firebase Admin SDK Initialized (Push Notifications Enabled)");
    } else {
        console.warn("⚠️ firebase-service-account.json missing. Push Notifications are disabled.");
    }
} catch (fbError) {
    console.error("❌ Firebase Admin Initialization Failed:", fbError);
}

async function sendPushNotification(receiverId, senderName, messageText, messageType) {
    if (!firebaseAdminEnabled) return;
    try {
        const admin = require('firebase-admin');
        const receiver = await User.findById(receiverId);
        if (!receiver || !receiver.fcmToken) return;

        let notificationBody = messageText;
        if (messageType === 'audio') {
            notificationBody = "🎙️ Sent you a voice note";
        } else if (messageType === 'file') {
            notificationBody = "📄 Sent you a file";
        }

        const message = {
            notification: {
                title: `New message from ${senderName}`,
                body: notificationBody || "Sent you a message"
            },
            data: {
                senderId: String(receiverId)
            },
            token: receiver.fcmToken
        };

        await admin.messaging().send(message);
        console.log(`✉️ Push notification sent to User ${receiverId}`);
    } catch (error) {
        console.error("❌ Error sending push notification:", error);
    }
}

// ================= INLINE MODELS (Existing) =================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'student', enum: ['student', 'mentor', 'admin'] },
    college: { type: String, default: '' },
    branch: { type: String, default: '' },
    image: { type: String, default: '' },
    about: { type: String, default: '' },
    meetingId: { type: String, default: '' }, // ✅ Added for Zoom
    passcode: { type: String, default: '' },   // ✅ Added for Zoom
    isVerified: { type: Boolean, default: false }, // ✅ Verification Status
    verificationStatus: { type: String, default: 'pending', enum: ['pending', 'verified', 'rejected'] },
    sessionFee: { type: Number, default: 500 }, // 💳 Added for Paytm Session Fee
    fcmToken: { type: String, default: '' } // 📲 Firebase Cloud Messaging Push Token
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
    date: { type: Date, default: Date.now },
    status: { type: String, default: 'confirmed', enum: ['pending', 'confirmed', 'failed'] }, // 💳 Booking Status
    amount: { type: Number, default: 0 },
    paymentId: { type: String, default: '' } // Paytm txn ID
}, { timestamps: true });
BookingSchema.index({ studentId: 1 });
BookingSchema.index({ mentorId: 1 });
const Booking = mongoose.models.Booking || mongoose.model('Booking', BookingSchema);

const LectureSchema = new mongoose.Schema({
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
LectureSchema.index({ mentorId: 1 });
const Lecture = mongoose.models.Lecture || mongoose.model('Lecture', LectureSchema);


// ================= ROUTES CONFIGURATION =================
// 👇 Isse /api/sessions activate ho jayega (routes/sessions.js file use hogi)
app.use('/api/sessions', sessionRoutes);
app.use('/api/payment', paymentRoutes); // 💳 Paytm Payment Route Activation


// ================= API ROUTES =================

app.get('/', (req, res) => {
    const dbStatus = ['Disconnected', 'Connected', 'Connecting', 'Disconnecting'][mongoose.connection.readyState];
    res.send(`NaviGreat Backend is Running! 🚀 | MongoDB Status: ${dbStatus}`);
});

// 14. CLOUDINARY UPLOAD API
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer (Memory Storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/api/upload', verifyToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        // Convert buffer to base64
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            resource_type: "auto", // Auto-detect (image/video)
            folder: "navigreat_uploads"
        });

        res.json({
            success: true,
            message: "Upload Successful!",
            url: result.secure_url,
            type: result.resource_type
        });
    } catch (error) {
        console.error("Cloudinary Upload Error:", error);
        res.status(500).json({ success: false, message: "Upload Failed" });
    }
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

        const iat = Math.round(new Date().getTime() / 1000) - 120; // 2 minutes drift allowance
        const exp = iat + 86400; // 24 Hours validity (Fix for 3705)

        const oHeader = { alg: 'HS256', typ: 'JWT' };
        const oPayload = {
            sdkKey: process.env.ZOOM_CLIENT_ID,
            mn: parseInt(req.body.meetingNumber, 10), // ✅ Force Integer
            role: parseInt(req.body.role, 10),
            iat: iat,
            exp: exp,
            appKey: process.env.ZOOM_CLIENT_ID,
            tokenExp: exp
        };

        console.log(`Generating Signature: IAT=${iat} (${new Date(iat * 1000).toISOString()}), EXP=${exp}`);
        console.log("Payload:", JSON.stringify(oPayload, null, 2));

        const sHeader = JSON.stringify(oHeader);
        const sPayload = JSON.stringify(oPayload);
        const signature = KJUR.jws.JWS.sign('HS256', sHeader, sPayload, process.env.ZOOM_CLIENT_SECRET);

        res.json({ signature, sdkKey: process.env.ZOOM_CLIENT_ID });
    } catch (err) {
        console.error("Signature Gen Error:", err);
        res.status(500).json({ success: false, message: "Signature Generation Failed" });
    }
});

// 🎥 GET LIVE SESSION ZOOM CREDENTIALS (Secured 🔒)
app.get('/api/sessions/join/:mentorId', verifyToken, async (req, res) => {
    try {
        const { mentorId } = req.params;
        const requesterId = req.user.id;
        const requesterRole = req.user.role;

        // Find the mentor
        const mentor = await User.findById(mentorId);
        if (!mentor || mentor.role !== 'mentor') {
            return res.status(404).json({ success: false, message: "Mentor not found" });
        }

        // 1. If requester is the mentor themselves or an admin, allow immediately
        if (requesterId === mentorId || requesterRole === 'admin') {
            return res.json({
                success: true,
                meetingId: mentor.meetingId,
                passcode: mentor.passcode
            });
        }

        // 2. Otherwise, check if there is an active/live session scheduled right now
        const now = new Date();
        const startBuffer = 15 * 60 * 1000; // 15 minutes early allowance
        const endBuffer = 60 * 60 * 1000; // 60 minutes overrun allowance

        const activeSession = await Session.findOne({
            mentorId: mentorId,
            startTime: { $lte: new Date(now.getTime() + startBuffer) },
            endTime: { $gte: new Date(now.getTime() - endBuffer) }
        });

        if (!activeSession) {
            return res.status(403).json({ success: false, message: "No active live session found for this mentor at this time." });
        }

        // Return credentials
        res.json({
            success: true,
            meetingId: mentor.meetingId,
            passcode: mentor.passcode
        });

    } catch (err) {
        console.error("Join Credentials Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 1. REGISTER USER
// 1. REGISTER USER
app.post('/api/auth/register', upload.single('image'), [
    body('email').isEmail().withMessage("Invalid Email Format"),
    body('password').isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body('username').notEmpty().withMessage("Username is required")
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    try {
        const { username, email, password, role, college, branch, about } = req.body;
        let imageUrl = '';

        // ☁️ Cloudinary Upload Logic
        if (req.file) {
            try {
                const b64 = Buffer.from(req.file.buffer).toString('base64');
                const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
                const result = await cloudinary.uploader.upload(dataURI, {
                    folder: "navigreat_avatars"
                });
                imageUrl = result.secure_url;
            } catch (uploadError) {
                console.error("Profile Image Upload Failed:", uploadError);
                // Proceed without image or return error? Let's proceed but warn.
            }
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "❌ User already exists!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            role: role || 'student',
            college,
            branch,
            image: imageUrl || '',
            about,
            isVerified: role === 'mentor' ? false : true, // Mentors need verification
            verificationStatus: role === 'mentor' ? 'pending' : 'verified'
        });

        await newUser.save();
        const token = jwt.sign({ id: newUser._id, role: newUser.role }, JWT_SECRET);
        res.json({ success: true, message: "Registration Successful!", token, user: newUser });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
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
        const mentors = await User.find({ role: 'mentor' }).select('-password -email -meetingId -passcode');
        res.json({ success: true, mentors });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 5. GET SINGLE MENTOR
app.get('/api/mentors/:id', cacheMiddleware(180), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid ID" });
        
        let selectFields = '-password';
        
        // Decrypt token to check if user is the owner or admin
        const token = req.header('Authorization');
        let isOwner = false;
        if (token) {
            try {
                const verified = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
                if (verified && (verified.id === req.params.id || verified.role === 'admin')) {
                    isOwner = true;
                }
            } catch (err) {
                // Ignore token error, treat as guest
            }
        }
        
        if (!isOwner) {
            selectFields = '-password -email -meetingId -passcode';
        }

        const mentor = await User.findById(req.params.id).select(selectFields);
        if (!mentor) return res.status(404).json({ success: false, message: "Mentor not found" });
        res.json({ success: true, mentor });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 6. UPDATE PROFILE (Protected 🔒)
app.put('/api/mentors/:id', verifyToken, async (req, res) => {
    try {
        // 🔒 SECURITY CHECK: Ensure user is updating their OWN profile
        if (req.user.id !== req.params.id) {
            return res.status(403).json({ success: false, message: "Unauthorized: You can only update your own profile" });
        }

        // 🔒 SECURITY: Prevent Role/Password updates via this route
        const { username, about, college, branch, image, meetingId, passcode } = req.body;

        // Only allow these specific fields to be updated
        const updateData = { username, about, college, branch, image, meetingId, passcode };

        // Remove undefined fields (in case frontend didn't send them)
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');

        // 🧹 Clear Cache for this user and the global mentors list
        clearCache(`/api/mentors/${req.params.id}`);
        clearCache(`/api/mentors`);

        res.json({ success: true, message: "Profile Updated", mentor: updatedUser });
    } catch (error) { res.status(500).json({ success: false, message: "Update Failed" }); }
});

// 6.5 ADMIN VERIFY USER
app.put('/api/admin/verify/:id', verifyToken, async (req, res) => {
    try {
        // Check if requester is admin (or for now, strict check on specific email if no admin exists yet, but roles are better)
        // Since we just added 'admin' role, we assume the user will manually update their role to admin in DB to use this.
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Admin Access Required" });
        }

        const { status } = req.body; // 'verified' or 'rejected'
        const newStatus = status === 'verified';

        const updatedUser = await User.findByIdAndUpdate(req.params.id, {
            isVerified: newStatus,
            verificationStatus: status
        }, { new: true }).select('-password');

        // 🧹 Clear Cache for this user and the global mentors list
        clearCache(`/api/mentors/${req.params.id}`);
        clearCache(`/api/mentors`);

        res.json({ success: true, message: `User ${status} successfully`, user: updatedUser });
    } catch (error) { res.status(500).json({ success: false, message: "Verification Failed" }); }
});

// 6.6 ADMIN GET ALL USERS
app.get('/api/admin/users', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Admin Access Required" });
        }
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (error) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// 🚧 DEV: SELF VERIFY (For Testing Only)
app.put('/api/dev/verify-me', verifyToken, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.user.id, {
            isVerified: true,
            verificationStatus: 'verified'
        }, { new: true }).select('-password');

        // 🧹 Clear Cache for this user and the global mentors list
        clearCache(`/api/mentors/${req.user.id}`);
        clearCache(`/api/mentors`);

        res.json({ success: true, message: "✅ You are now Verified!", user });
    } catch (error) { res.status(500).json({ success: false, message: "Verification Failed" }); }
});

// 📲 SAVE FCM REGISTRATION TOKEN
app.post('/api/users/save-fcm-token', verifyToken, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) {
            return res.status(400).json({ success: false, message: "FCM token is required" });
        }
        await User.findByIdAndUpdate(req.user.id, { fcmToken });
        res.json({ success: true, message: "FCM token saved successfully" });
    } catch (err) {
        console.error("Save FCM Token Error:", err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
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

        const bookings = await Booking.find({ mentorId: req.params.mentorId, status: 'confirmed' }).sort({ date: -1 });
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
            query = { mentorId: userId, status: 'confirmed' };
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
        const myId = new mongoose.Types.ObjectId(userId);

        // Find all messages where I am sender OR receiver
        const messages = await Message.find({
            $or: [{ sender: userId }, { receiver: userId }]
        }).select('sender receiver');

        const contactIds = new Set();
        messages.forEach(m => {
            const s = m.sender.toString();
            const r = m.receiver.toString();
            if (s !== userId) contactIds.add(s);
            if (r !== userId) contactIds.add(r);
        });

        // Add Booking Contacts
        if (req.user.role === 'mentor') {
            const bookings = await Booking.find({ mentorId: userId }).select('studentId');
            bookings.forEach(b => {
                if (b.studentId) contactIds.add(b.studentId.toString());
            });
        } else {
            const bookings = await Booking.find({ studentId: userId }).select('mentorId');
            bookings.forEach(b => {
                if (b.mentorId) contactIds.add(b.mentorId.toString());
            });
        }

        if (contactIds.size === 0) {
            return res.json({ success: true, contacts: [] });
        }

        const contactObjectIdList = Array.from(contactIds).map(id => new mongoose.Types.ObjectId(id));

        // Aggregate User to get user details, lastMessage, and unreadCount
        const contactsData = await User.aggregate([
            {
                $match: {
                    _id: { $in: contactObjectIdList }
                }
            },
            {
                $lookup: {
                    from: 'messages',
                    let: { contactId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $or: [
                                        { $and: [{ $eq: ['$sender', myId] }, { $eq: ['$receiver', '$$contactId'] }] },
                                        { $and: [{ $eq: ['$sender', '$$contactId'] }, { $eq: ['$receiver', myId] }] }
                                    ]
                                }
                            }
                        },
                        { $sort: { timestamp: -1 } },
                        { $limit: 1 }
                    ],
                    as: 'lastMessageDoc'
                }
            },
            {
                $lookup: {
                    from: 'messages',
                    let: { contactId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$sender', '$$contactId'] },
                                        { $eq: ['$receiver', myId] },
                                        { $eq: ['$read', false] }
                                    ]
                                }
                            }
                        },
                        { $count: 'count' }
                    ],
                    as: 'unreadCountDoc'
                }
            },
            {
                $project: {
                    _id: 1,
                    username: 1,
                    image: 1,
                    role: 1,
                    college: 1,
                    branch: 1,
                    lastMessage: { $ifNull: [{ $arrayElemAt: ['$lastMessageDoc.content', 0] }, ""] },
                    lastMessageTime: { $ifNull: [{ $arrayElemAt: ['$lastMessageDoc.timestamp', 0] }, null] },
                    unreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadCountDoc.count', 0] }, 0] }
                }
            }
        ]);

        // Sort by last message time
        contactsData.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0));

        res.json({ success: true, contacts: contactsData });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Error fetching contacts" });
    }
});

// 13.5 GET TOTAL UNREAD MESSAGES COUNT
app.get('/api/messages/unread/count', verifyToken, async (req, res) => {
    try {
        const count = await Message.countDocuments({ receiver: req.user.id, read: false });
        res.json({ success: true, count });
    } catch (err) {
        console.error("Error fetching unread count:", err);
        res.status(500).json({ success: false, message: "Error fetching unread count" });
    }
});

// 13.6 MARK MESSAGES FROM SENDER AS READ
app.put('/api/messages/:senderId/read', verifyToken, async (req, res) => {
    try {
        const myId = req.user.id;
        const senderId = req.params.senderId;

        await Message.updateMany(
            { sender: senderId, receiver: myId, read: false },
            { $set: { read: true } }
        );

        res.json({ success: true, message: "Messages marked as read" });
    } catch (err) {
        console.error("Error marking messages as read:", err);
        res.status(500).json({ success: false, message: "Error marking messages as read" });
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
const onlineUsers = new Map(); // Track { userId: socketId }
const emailTimeouts = new Map(); // Track { userId: setTimeoutId }

// Function to send consolidated unread message alerts via email
async function sendOfflineEmailAlert(receiverId) {
    try {
        // Find unread messages for the receiver
        const unreadMessages = await Message.find({
            receiver: receiverId,
            read: false
        }).sort({ timestamp: 1 });

        if (unreadMessages.length === 0) return;

        // Fetch user info for receiver
        const receiverUser = await User.findById(receiverId);
        if (!receiverUser || !receiverUser.email) return;

        // Group messages by sender to build a clean email template
        const senderIds = Array.from(new Set(unreadMessages.map(m => m.sender.toString())));
        const senders = await User.find({ _id: { $in: senderIds } }).select('username');
        const senderMap = new Map(senders.map(s => [s._id.toString(), s.username]));

        const messageItemsHtml = unreadMessages.map(m => {
            const senderName = senderMap.get(m.sender.toString()) || "Unknown User";
            const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <li style="margin-bottom: 12px; padding: 10px; background-color: #f8fafc; border-left: 4px solid #2563eb; list-style: none; border-radius: 4px;">
                    <strong>${senderName}</strong> <span style="font-size: 11px; color: #64748b;">(${timeStr})</span>:
                    <p style="margin: 4px 0 0 0; color: #334155;">${m.content || "[Audio Message]"}</p>
                </li>
            `;
        }).join('');

        const emailHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1e3a8a; margin-top: 0;">You have unread messages on NaviGreat!</h2>
                <p>Hello <strong>${receiverUser.username}</strong>,</p>
                <p>While you were offline, you received the following message(s):</p>
                <ul style="padding: 0; margin: 20px 0;">
                    ${messageItemsHtml}
                </ul>
                <div style="margin-top: 30px; text-align: center;">
                    <a href="https://navigreat.vercel.app/#/chat" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Messages</a>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0 20px 0;" />
                <p style="font-size: 12px; color: #94a3b8; text-align: center;">This is an automated notification from NaviGreat. You can safely ignore this email if you've already read these messages elsewhere.</p>
            </div>
        `;

        await sendEmail({
            to: receiverUser.email,
            subject: `📧 You have ${unreadMessages.length} unread message(s) on NaviGreat`,
            html: emailHtml
        });
    } catch (error) {
        console.error("Error sending offline email alert:", error);
    }
}

io.on("connection", (socket) => {
    console.log(`⚡ Socket Connected: ${socket.id}`);

    // 1️⃣ User Comes Online
    socket.on("register_user", (userId) => {
        if (!userId) return;
        onlineUsers.set(userId, socket.id);
        socket.join(userId); // Personal Room

        console.log(`✅ User Online: ${userId} (${socket.id})`);

        // Cancel any pending offline email notification
        if (emailTimeouts.has(userId)) {
            clearTimeout(emailTimeouts.get(userId));
            emailTimeouts.delete(userId);
        }

        // Broadcast to everyone that this user is online
        io.emit("user_online", userId);

        // Send currently online users to THIS user
        socket.emit("get_online_users", Array.from(onlineUsers.keys()));
    });

    // 2️⃣ Sending Messages
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

            // Send to Receiver (Socket Room)
            io.to(receiver).emit("receive_message", newMessage);

            // Send back to Sender (for optimistic UI update confirmation)
            io.to(sender).emit("receive_message", newMessage);

            // Schedule offline email notification if receiver is offline
            if (!onlineUsers.has(receiver)) {
                // Send background push notification
                const senderUser = await User.findById(sender);
                const senderName = senderUser ? senderUser.username : "Someone";
                sendPushNotification(receiver, senderName, content, messageType);

                if (!emailTimeouts.has(receiver)) {
                    const timeoutId = setTimeout(() => {
                        emailTimeouts.delete(receiver);
                        sendOfflineEmailAlert(receiver);
                    }, 10 * 60 * 1000); // 10 minutes
                    emailTimeouts.set(receiver, timeoutId);
                }
            }
        } catch (err) {
            console.error("Message Error:", err);
        }
    });

    // ⌨️ Typing Indicators
    socket.on("typing", (room) => socket.in(room).emit("display_typing"));
    socket.on("stop_typing", (room) => socket.in(room).emit("hide_typing"));

    // 3️⃣ User Disconnects
    socket.on("disconnect", () => {
        let disconnectedUserId = null;

        // Find userId by socketId
        for (const [userId, socketId] of onlineUsers.entries()) {
            if (socketId === socket.id) {
                disconnectedUserId = userId;
                onlineUsers.delete(userId);
                break;
            }
        }

        if (disconnectedUserId) {
            console.log(`❌ User Offline: ${disconnectedUserId}`);
            io.emit("user_offline", disconnectedUserId);
        }
    });
});

// Server Start
server.listen(PORT, () => {
    console.log(`🚀 Server running on Port: ${PORT}`);
});