const nodemailer = require("nodemailer");

const sendEmail = async ({ to, subject, text, html }) => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn("⚠️ Email Skipping: EMAIL_USER or EMAIL_PASS not set in .env");
        return;
    }

    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail({
            from: `"NaviGreat" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text,
            html: html || text,
        });

        console.log("📧 Email sent successfully to:", to);
        return true;
    } catch (error) {
        console.error("❌ Email Sending Failed:", error);
        return false;
    }
};

module.exports = sendEmail;
