const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // <--- New Import

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
// 👇 PASTE YOUR MONGODB LINK INSIDE THE QUOTES BELOW 👇
const MONGO_URI = "mongodb+srv://prabhatsingh9893:Niharika79@cluster0.zfnasif.mongodb.net/?appName=Cluster0; "

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- DATA MODEL (Blueprint) ---
const ContactSchema = new mongoose.Schema({
    name: String,
    email: String,
    message: String,
    date: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- ROUTES ---
app.get('/', (req, res) => {
    res.send('Welcome to EduMentor Backend (Connected to DB)! 🚀');
});

// We still keep the Mentors list manually for now (Hybrid approach)
const MENTORS = [
    { id: 1, name: "Prabhat Singh", college: "IIT Bombay", role: "CS Graduate", image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=80" },
    { id: 2, name: "Priya Sharma", college: "NIT Trichy", role: "ECE Graduate", image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80" },
    { id: 3, name: "Amit Patel", college: "Stanford University", role: "MS CS", image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80" }
];

app.get('/api/mentors', (req, res) => {
    res.json(MENTORS);
});

// 👇 This route now saves to MongoDB instead of just console logging
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        
        // Save to Database
        const newMessage = new Contact({ name, email, message });
        await newMessage.save();

        console.log("Message Saved to DB:", name);
        res.json({ success: true, message: "Saved to Database!" });
    } catch (error) {
        console.error("Error saving:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// Database connection active