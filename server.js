const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // <--- New for Security
const jwt = require('jsonwebtoken'); // <--- New for Login Token

const app = express();
const PORT = 5000;
const JWT_SECRET = "supersecretkey123"; // (In real app, hide this)

app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
// 👇 PASTE YOUR MONGODB LINK HERE 👇
const MONGO_URI = "mongodb+srv://prabhatsingh9893:Niharika79@cluster0.zfnasif.mongodb.net/?appName=Cluster0"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 1. USER MODEL (For Login/Signup) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- 2. CONTACT MODEL ---
const ContactSchema = new mongoose.Schema({
    name: String,
    email: String,
    message: String,
    date: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- ROUTES ---

app.get('/', (req, res) => {
    res.send('EduMentor Backend with Auth is Running! 🚀');
});

// ✅ REGISTER API (Sign Up)
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        // Encrypt Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save User
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();

        res.json({ success: true, message: "Registration Successful! Please Login." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ✅ LOGIN API
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check user
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "User not found!" });

        // Check Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid Password!" });

        // Generate Token
        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({ success: true, token, username: user.username, message: "Login Successful!" });
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

// MENTORS API (Still hardcoded for now)
const MENTORS = [
    { id: 1, name: "Prabhat Singh", college: "IIT Bombay", role: "CS Graduate", image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=80" },
    { id: 2, name: "Priya Sharma", college: "NIT Trichy", role: "ECE Graduate", image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80" },
    { id: 3, name: "Amit Patel", college: "Stanford University", role: "MS CS", image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80" }
];
app.get('/api/mentors', (req, res) => { res.json(MENTORS); });

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});