const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 

const app = express();
const PORT = 5000;
const JWT_SECRET = "supersecretkey123"; 

app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
const MONGO_URI = "mongodb+srv://prabhatsingh9893:Niharika79@cluster0.zfnasif.mongodb.net/?appName=Cluster0"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 1. USER MODEL (UPDATED for Role & College) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // 👇 Ye fields add ki gayi hain taaki Mentor data save ho sake
    role: { 
        type: String, 
        default: 'student', 
        enum: ['student', 'mentor'] 
    },
    college: { type: String, default: '' },
    branch:  { type: String, default: '' }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// --- 2. CONTACT MODEL ---
const ContactSchema = new mongoose.Schema({
    name: String,
    email: String,
    message: String,
    date: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- 3. BOOKING MODEL ---
const BookingSchema = new mongoose.Schema({
    studentEmail: String,
    mentorName: String,
    date: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', BookingSchema);


// ================= ROUTES =================

app.get('/', (req, res) => {
    res.send('EduMentor Backend with Auth is Running! 🚀');
});

// ✅ REGISTER API (UPDATED to save Role)
app.post('/api/register', async (req, res) => {
    try {
        // 👇 Role, College, Branch receive kar rahe hain
        const { username, email, password, role, college, branch } = req.body;

        // Check user
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save User (With Role)
        const newUser = new User({ 
            username, 
            email, 
            password: hashedPassword,
            role: role || 'student', // Default student
            college: college || '',
            branch: branch || ''
        });
        
        await newUser.save();

        // Auto-Login Token Generate (Optional but good)
        const token = jwt.sign({ id: newUser._id }, JWT_SECRET);

        res.json({ 
            success: true, 
            message: "Registration Successful!", 
            token, 
            user: newUser 
        });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ LOGIN API
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "User not found!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid Password!" });

        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({ 
            success: true, 
            token, 
            user: { 
                username: user.username, 
                email: user.email, 
                role: user.role, 
                college: user.college, 
                branch: user.branch 
            }, 
            message: "Login Successful!" 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ GOOGLE LOGIN API
app.post('/api/google-login', async (req, res) => {
    try {
        const { username, email } = req.body;
        let user = await User.findOne({ email });

        if (!user) {
            const randomPassword = Math.random().toString(36).slice(-8);
            const hashedPassword = await bcrypt.hash(randomPassword, 10);

            user = new User({ 
                username, 
                email, 
                password: hashedPassword,
                role: 'student' 
            });
            await user.save();
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({ 
            success: true, 
            token, 
            user: { 
                username: user.username, 
                email: user.email, 
                role: user.role,
                college: user.college,
                branch: user.branch
            }, 
            message: "Google Login Successful!" 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ GET ALL MENTORS (Real Database Route)
// Ye hardcoded list ko hata kar database se fetch karega
app.get('/api/mentors', async (req, res) => {
  try {
    const mentors = await User.find({ role: 'mentor' }).select('-password'); 
    res.json({ success: true, mentors });
  } catch (error) {
    console.error("Error fetching mentors:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// BOOKING API
app.post('/api/book', async (req, res) => {
    try {
        const { studentEmail, mentorName } = req.body;
        const newBooking = new Booking({ studentEmail, mentorName });
        await newBooking.save();
        res.json({ success: true, message: "Booking Confirmed!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// CONTACT API
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newMessage = new Contact({ name, email, message });
        await newMessage.save();
        res.json({ success: true, message: "Saved to Database!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});