# NaviGreat — Backend

REST + WebSocket API for **NaviGreat**, a mentorship platform that connects engineering students with verified seniors from IITs and NITs for 1-on-1 guidance, real-time chat and live sessions.

**🔗 Live API:** [navigreat-backend-98.onrender.com](https://navigreat-backend-98.onrender.com) · **Frontend:** [navigreat-frontend-98](https://github.com/prabhatsingh9893/navigreat-frontend-98) · **Live app:** [navigreat98.vercel.app](https://navigreat98.vercel.app)

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white)

---

## ✨ Features

- **Authentication** — email/password (bcrypt + JWT), Google Sign-In, forgot/reset password via email.
- **Roles** — student, mentor and admin; admins verify mentor profiles.
- **Mentors** — public listing and profiles with caching, profile editing (owner only), lecture uploads.
- **Bookings & payments** — session booking with Paytm checkout (mock mode for local testing).
- **Live sessions** — server-side Zoom Meeting SDK signature generation (JWT).
- **Real-time chat** — Socket.IO messaging with delivery/read receipts, typing indicators and unread counts.
- **Reviews** — students rate and review mentors.
- **Notifications** — email (Nodemailer) and push notifications (Firebase Cloud Messaging).
- **Security** — Helmet headers, rate limiting, input validation, XSS and NoSQL-injection sanitising, CORS allow-list.

## 🧱 Tech stack

Node.js · Express · MongoDB (Mongoose) · Socket.IO · JWT · bcrypt · Cloudinary + Multer · Nodemailer · Firebase Admin · Paytm · Zoom Meeting SDK

## 🏗️ Project structure

```
server.js            # App setup, models (User, Booking, Lecture, Contact), REST routes, Socket.IO
routes/
  payment.js         # Paytm initiate / callback / mock-callback
  sessions.js        # Live session scheduling
middleware/
  auth.js            # JWT verification
  cache.js           # In-memory response cache (node-cache)
models/              # Message, Review, Session
utils/sendEmail.js   # Nodemailer helper
```

## 🔌 Main API endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Sign up (student or mentor) |
| POST | `/api/login` · `/api/google-login` | Log in |
| POST | `/api/auth/forgot-password` · `/api/auth/reset-password` | Password reset |
| GET | `/api/mentors` · `/api/mentors/:id` | List / view mentors |
| PUT | `/api/mentors/:id` | Update own profile |
| POST | `/api/book` | Book a session |
| GET | `/api/my-bookings` · `/api/bookings/:mentorId` | Student / mentor bookings |
| POST | `/api/payment/initiate` | Start Paytm payment |
| POST | `/api/generate-signature` | Zoom SDK signature |
| GET | `/api/contacts` · `/api/messages/:otherUserId` | Chat inbox and history |
| POST | `/api/reviews` · GET `/api/reviews/:mentorId` | Reviews |
| PUT | `/api/admin/verify/:id` | Admin: verify a mentor |

Socket.IO events: `register_user`, `send_message`, `message_delivered`, `mark_read`, `typing`, `stop_typing`.

## 🚀 Getting started

```bash
git clone https://github.com/prabhatsingh9893/navigreat-backend-98.git
cd navigreat-backend-98
npm install
cp .env.example .env     # fill in your own values
npm run dev              # http://localhost:5000
```

Optional: place a Firebase Admin `firebase-service-account.json` in the root to enable push notifications (it is git-ignored).

> **Never commit `.env` or service-account files.** All secrets are read from environment variables.

## ☁️ Deployment

Deployed on **Render** as a Node web service (`npm start`). Set the variables from `.env.example` in the Render dashboard.
