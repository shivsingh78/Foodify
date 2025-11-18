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

export const sendDeliveryOtpMail = async (user,otp) => {
  await transporter.sendMail({
    from : process.env.EMAIL,
    to:user.email,
    subject:"Delivery OTP",
    html:`<p>Your Otp for delivery is <b> ${otp}</b>. It expires in 5 minutes. </p> `
  })

  
}