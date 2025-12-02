const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000; // React runs on 5173, Backend runs on 5000

// Middleware (Security Check & Data Parsing)
app.use(cors());
app.use(express.json());

// --- FAKE DATABASE (Temporary Data) ---
const MENTORS = [
    {
        id: 1,
        name: "Prabhat Singh",
        college: "IIT Bombay",
        role: "CS Graduate",
        image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=80"
    },
    {
        id: 2,
        name: "Priya Sharma",
        college: "NIT Trichy",
        role: "ECE Graduate",
        image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80"
    },
    {
        id: 3,
        name: "Amit Patel",
        college: "Stanford University",
        role: "MS CS",
        image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80"
    }
];

// --- ROUTES (API Endpoints) ---

// 1. Home Route (To check if server is working)
app.get('/', (req, res) => {
    res.send('Welcome to EduMentor Backend! 🚀');
});

// 2. Mentors Route (Frontend will ask for this)
app.get('/api/mentors', (req, res) => {
    res.json(MENTORS);
});

// 3. Contact Route (Frontend will send data here)
app.post('/api/contact', (req, res) => {
    const data = req.body;
    console.log("New Message Received:", data);
    res.json({ message: "Message received successfully!", success: true });
});

// Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});