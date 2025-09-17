import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "Gmail",
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS,
  },
});

export const sendOtpMail = async (to,otp)=> {
  await transporter.sendMail({
    from:process.env.EMAIL,
    to,
    subject:"Reset Your Password",
    html:`<P>Your OTP for Password reset is <b>${otp}</b>. It expires in 5 minutes.</P>`
  })
}