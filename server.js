const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 

const app = express();

// ✅ FIX 1: Dynamic Port (Render/Vercel ke liye zaroori hai)
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "supersecretkey123"; 

// ✅ FIX 2: CORS Allows All Origins (Taaki Vercel se request fail na ho)
app.use(cors({
    origin: '*', 
    credentials: true
}));

app.use(express.json());

// --- DATABASE CONNECTION ---
const MONGO_URI = "mongodb+srv://prabhatsingh9893:Niharika79@cluster0.zfnasif.mongodb.net/?appName=Cluster0"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 1. USER MODEL ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { 
        type: String, 
        default: 'student', 
        enum: ['student', 'mentor'] 
    },
    college: { type: String, default: '' },
    branch:  { type: String, default: '' },
    image:   { type: String, default: '' }, // Image field added
    about:   { type: String, default: '' }  // About field added
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
    res.send('EduMentor Backend is Running! 🚀');
});

// ✅ REGISTER API
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, college, branch, image, about } = req.body;

        // Check user
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save User
        const newUser = new User({ 
            username, 
            email, 
            password: hashedPassword,
            role: role || 'student',
            college: college || '',
            branch: branch || '',
            image: image || '',
            about: about || ''
        });
        
        await newUser.save();

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
                id: user._id, // ID bhejna zaroori hai frontend ke liye
                username: user.username, 
                email: user.email, 
                role: user.role, 
                college: user.college, 
                branch: user.branch,
                image: user.image
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
        const { username, email, image } = req.body;
        let user = await User.findOne({ email });

        if (!user) {
            const randomPassword = Math.random().toString(36).slice(-8);
            const hashedPassword = await bcrypt.hash(randomPassword, 10);

            user = new User({ 
                username, 
                email, 
                password: hashedPassword,
                role: 'student',
                image: image || ''
            });
            await user.save();
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user._id,
                username: user.username, 
                email: user.email, 
                role: user.role, 
                college: user.college, 
                branch: user.branch,
                image: user.image
            }, 
            message: "Google Login Successful!" 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ GET ALL MENTORS
app.get('/api/mentors', async (req, res) => {
  try {
    const mentors = await User.find({ role: 'mentor' }).select('-password'); 
    res.json({ success: true, mentors });
  } catch (error) {
    console.error("Error fetching mentors:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// ✅ GET SINGLE MENTOR (Profile Page ke liye)
app.get('/api/mentors/:id', async (req, res) => {
    try {
        const mentor = await User.findById(req.params.id).select('-password');
        if (!mentor) return res.status(404).json({ success: false, message: "Mentor not found" });
        res.json({ success: true, mentor });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ UPDATE PROFILE (Mentor Edit ke liye)
app.put('/api/mentors/:id', async (req, res) => {
    try {
        const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
        res.json({ success: true, message: "Profile Updated", mentor: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: "Update Failed" });
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
    console.log(`Server is running on Port: ${PORT}`);
});