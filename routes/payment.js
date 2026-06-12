const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PaytmChecksum = require('paytmchecksum');
const verifyToken = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

// ================= TRANSACTION SCHEMA =================
const TransactionSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    paytmTxnId: { type: String },
    paytmResponse: { type: Object }
}, { timestamps: true });

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);

// ================= EMAIL HELPER =================
async function sendPaymentEmails(booking, amount) {
    try {
        const UserModel = mongoose.model('User');
        const student = await UserModel.findById(booking.studentId);
        const mentor = await UserModel.findById(booking.mentorId);

        if (mentor && mentor.email) {
            await sendEmail({
                to: mentor.email,
                subject: "✨ Priority Session Booking Confirmed (Paid) | Navigreat",
                html: `<h3>Hello ${mentor.username},</h3>
                <p>A student has booked a priority session with you after completing the payment.</p>
                <p><b>Student:</b> ${student.username} (${student.email})</p>
                <p><b>Amount Paid:</b> INR ${amount}</p>
                <p><b>Message:</b> ${booking.message || "Interested in mentorship."}</p>
                <p>Please check your dashboard to respond and set up the session.</p>`
            });
        }

        if (student && student.email) {
            await sendEmail({
                to: student.email,
                subject: "💳 Priority Booking Confirmed! | Navigreat",
                html: `<h3>Hello ${student.username},</h3>
                <p>Your booking request for mentor <b>${booking.mentorName}</b> has been paid and confirmed successfully.</p>
                <p><b>Amount Paid:</b> INR ${amount}</p>
                <p>We will notify you once they schedule a time.</p>`
            });
        }
    } catch (emailErr) {
        console.error("Error sending booking payment emails:", emailErr);
    }
}

// ================= API ENDPOINTS =================

// 1. INITIATE TRANSACTION
router.post('/initiate', verifyToken, async (req, res) => {
    try {
        const { mentorId, message } = req.body;
        const studentId = req.user.id;

        const UserModel = mongoose.model('User');
        const student = await UserModel.findById(studentId);
        const mentor = await UserModel.findById(mentorId);

        if (!mentor || mentor.role !== 'mentor') {
            return res.status(404).json({ success: false, message: "Mentor not found" });
        }

        const amount = mentor.sessionFee || 500;
        const orderId = `ORDER_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

        // Create pending booking
        const BookingModel = mongoose.model('Booking');
        const newBooking = new BookingModel({
            studentEmail: student.email,
            studentId,
            mentorId,
            mentorName: mentor.username,
            message: message || "I am interested in mentorship.",
            status: 'pending',
            amount,
            date: new Date()
        });
        await newBooking.save();

        // Create transaction record
        const transaction = new Transaction({
            orderId,
            bookingId: newBooking._id,
            studentId,
            mentorId,
            amount,
            status: 'PENDING'
        });
        await transaction.save();

        // Check for mock mode
        const mid = process.env.PAYTM_MID;
        const merchantKey = process.env.PAYTM_MERCHANT_KEY;
        const isMock = !mid || !merchantKey || mid === 'YOUR_MID' || merchantKey === 'YOUR_KEY' || process.env.MOCK_PAYTM === 'true';

        if (isMock) {
            console.log(`[PAYTM] Initiating transaction in MOCK MODE for order ${orderId}`);
            return res.json({
                success: true,
                isMock: true,
                orderId,
                amount,
                callbackUrl: `${req.protocol}://${req.get('host')}/api/payment/mock-callback`
            });
        }

        // Real Paytm Initiate Transaction Payload
        const paytmParams = {
            body: {
                requestType: "Payment",
                mid: mid,
                websiteName: process.env.PAYTM_WEBSITE || "WEBSTAGING",
                orderId: orderId,
                callbackUrl: process.env.PAYTM_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/payment/callback`,
                txnAmount: {
                    value: amount.toFixed(2),
                    currency: "INR",
                },
                userInfo: {
                    custId: studentId,
                    email: student.email,
                    firstName: student.username
                },
            }
        };

        // Generate checksum signature
        const checksum = await PaytmChecksum.generateSignature(JSON.stringify(paytmParams.body), merchantKey);
        paytmParams.head = {
            signature: checksum,
            version: "v1"
        };

        const postData = JSON.stringify(paytmParams);
        const paytmEnv = process.env.PAYTM_ENV || 'staging';
        const hostname = paytmEnv === 'production' ? 'securegw.paytm.in' : 'securegw-stage.paytm.in';
        const path = `/theia/api/v1/initiateTransaction?mid=${mid}&orderId=${orderId}`;

        // Call initiate transaction API
        const response = await fetch(`https://${hostname}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            body: postData
        });

        const data = await response.json();
        
        if (data.body && data.body.resultInfo && data.body.resultInfo.resultStatus === 'S') {
            res.json({
                success: true,
                isMock: false,
                txnToken: data.body.txnToken,
                orderId,
                amount,
                mid,
                paytmEnv,
                callbackUrl: paytmParams.body.callbackUrl
            });
        } else {
            console.error("Paytm API Error details:", data.body ? data.body.resultInfo : data);
            res.status(500).json({ success: false, message: "Paytm initialization failed" });
        }

    } catch (err) {
        console.error("Paytm Initiate Error:", err);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// 2. REAL WEBHOOK CALLBACK
router.post('/callback', async (req, res) => {
    try {
        console.log("[PAYTM CALLBACK] Received Callback body:", req.body);
        const paytmParams = {};
        for (let key in req.body) {
            if (key !== 'CHECKSUMHASH') {
                paytmParams[key] = req.body[key];
            }
        }

        const checksum = req.body.CHECKSUMHASH;
        const merchantKey = process.env.PAYTM_MERCHANT_KEY;
        
        const isSignatureValid = PaytmChecksum.verifySignature(paytmParams, merchantKey, checksum);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        if (!isSignatureValid) {
            console.error("[PAYTM CALLBACK] Signature Verification Failed!");
            return res.redirect(`${frontendUrl}/dashboard?payment=failed&reason=checksum_verification_failed`);
        }

        const orderId = req.body.ORDERID;
        const status = req.body.STATUS;
        const txnId = req.body.TXNID;

        const transaction = await Transaction.findOne({ orderId });
        if (!transaction) {
            console.error(`[PAYTM CALLBACK] Transaction not found for order ${orderId}`);
            return res.redirect(`${frontendUrl}/dashboard?payment=failed&reason=transaction_not_found`);
        }

        if (status === 'TXN_SUCCESS') {
            transaction.status = 'SUCCESS';
            transaction.paytmTxnId = txnId;
            transaction.paytmResponse = req.body;
            await transaction.save();

            const BookingModel = mongoose.model('Booking');
            const booking = await BookingModel.findById(transaction.bookingId);
            if (booking) {
                booking.status = 'confirmed';
                booking.paymentId = txnId;
                await booking.save();
                await sendPaymentEmails(booking, transaction.amount);
            }

            res.redirect(`${frontendUrl}/dashboard?payment=success&orderId=${orderId}`);
        } else {
            transaction.status = 'FAILED';
            transaction.paytmResponse = req.body;
            await transaction.save();

            const BookingModel = mongoose.model('Booking');
            const booking = await BookingModel.findById(transaction.bookingId);
            if (booking) {
                booking.status = 'failed';
                await booking.save();
            }

            res.redirect(`${frontendUrl}/dashboard?payment=failed&orderId=${orderId}`);
        }

    } catch (err) {
        console.error("[PAYTM CALLBACK] Error handling callback:", err);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/dashboard?payment=failed&reason=server_error`);
    }
});

// 3. MOCK CALLBACK (FRONTEND SIMULATOR)
router.post('/mock-callback', verifyToken, async (req, res) => {
    try {
        const { orderId, status } = req.body;
        console.log(`[MOCK PAYTM CALLBACK] Order ID: ${orderId}, Status: ${status}`);

        const transaction = await Transaction.findOne({ orderId });
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }

        if (transaction.studentId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: "Unauthorized transaction update" });
        }

        const BookingModel = mongoose.model('Booking');
        const booking = await BookingModel.findById(transaction.bookingId);

        if (status === 'SUCCESS') {
            transaction.status = 'SUCCESS';
            transaction.paytmTxnId = `MOCK_TXN_${Date.now()}`;
            transaction.paytmResponse = { mock: true, timestamp: new Date() };
            await transaction.save();

            if (booking) {
                booking.status = 'confirmed';
                booking.paymentId = transaction.paytmTxnId;
                await booking.save();
                await sendPaymentEmails(booking, transaction.amount);
            }

            res.json({ success: true, message: "Mock payment marked as SUCCESS" });
        } else {
            transaction.status = 'FAILED';
            transaction.paytmResponse = { mock: true, failed: true, timestamp: new Date() };
            await transaction.save();

            if (booking) {
                booking.status = 'failed';
                await booking.save();
            }

            res.json({ success: true, message: "Mock payment marked as FAILED" });
        }

    } catch (err) {
        console.error("[MOCK PAYTM CALLBACK] Error:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

module.exports = router;
