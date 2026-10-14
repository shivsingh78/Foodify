import { googleSignInInput, googleSignUpInput, ResetPasswordInput, SendOtpInput, SignInInput, SignUpInput, VerifyOtpInput } from "@foodify/validation";
import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import { sendOtpMail } from "../utils/mail.js";
import  jwt  from "jsonwebtoken";
import genToken, { verifyToken } from "../utils/token.js";

export const signUpUser = async (input:SignUpInput)=>{

    const {fullName,email,mobile,password}=input;

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
        email:normalizedEmail,
    })

    if(existingUser) {
        const error = new Error("User already exists");
        error.name = "USER_ALREADY_EXISTS";
        throw error;
    }

    const hashedPassword = await bcrypt.hash(password,10);

    const user= await User.create({
        fullName:fullName.trim(),
        email:normalizedEmail,
        mobile:mobile.trim(),
        role:"user",
        password:hashedPassword
    })


    return user;

}

export const signInUser = async (input:SignInInput)=>{
    const {email,password}=input;

    const normalizedEmail=email.trim().toLowerCase();

    const user = await User.findOne({
        email:normalizedEmail,
    })

    if(!user){
        const error = new Error("Invalid email or password");
        error.name = "INVALID_CREDENTIALS"
        throw error;
    }

    if(!user?.password){
        const error = new Error("Invalid email or password");
        error.name = "INVALID_CREDENTIALS"
         throw error;
    }
    const isMatch = await bcrypt.compare(password,user.password);

    if(!isMatch){
        const error = new Error("Invalid email or password");
      error.name = "INVALID_CREDENTIALS"
         throw error;
    }
    return user;
}

export const sendOtpUser = async (input:SendOtpInput)=>{
    const email = input.email.trim().toLowerCase();

    const user = await User.findOne({email});

    if(!user){
        const error= new Error("User does not exist.");
        error.name="USER_NOT_FOUND";
        throw error;
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.resetOtp=otp;
    user.otpExpires=new Date(Date.now() + 5 * 60 *1000);
    user.isOtpVerified=false;
          await user.save()
          await sendOtpMail(user.email,otp)

    return {
        user,
        otp,
    }
}

export const verifyUserOtp=async(input:VerifyOtpInput)=>{
    const {email,otp}=input;
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({
        email:normalizedEmail,
    })

    if(!user){
        const error = new Error("User does not exist.");
        error.name = "USER_NOT_FOUND";
        throw error;
    }

    if(!user.resetOtp || user.resetOtp !== otp){
        const error = new Error("Invalid OTP");
        error.name = "INVALID_OTP";
        throw error;
    }

    if(!user.otpExpires || user.otpExpires.getTime() <Date.now()){
        const error = new Error("OTP has expired");
        error.name = "OTP_EXPIRED";
        throw error;
    }

     // OTP has been successfully verified.

    const resetToken = await genToken(
        user._id.toString(),
        "password_reset",
        "5m"
    );

   
    user.resetOtp=undefined;
    user.otpExpires=undefined;
     user.isOtpVerified=true;

    await user.save();

    return {
        user,resetToken
    }

}

export const resetUserPassword = async (input:ResetPasswordInput)=>{
    const {email,newPassword,resetToken}=input;

    const normalizedEmail=email.trim().toLowerCase();

    const user = await User.findOne({email:normalizedEmail});

    if(!user){
        const error = new Error('User does not exist');
        error.name="USER_NOT_FOUND";
        throw error;
    }

    if(!user.isOtpVerified){
        const error = new Error('otp verify failed');

        error.name="VERIFY_FAILED"
        throw error;
    }

    let decoded;

    try{
        decoded = verifyToken(resetToken);
    }catch{
        const error = new Error("Invalid or expired reset token.");
        error.name = "INVALID_RESET_TOKEN";
        throw error;
    }

    if(decoded.purpose !== "password_reset" || decoded.userId !== user._id.toString()){
        const error = new Error("Invalid reset token.");
        error.name = "INVALID_RESET_TOKEN";
        throw error;
    }

    const hashedPassword = await bcrypt.hash(newPassword,10);
    user.password = hashedPassword;
     user.isOtpVerified=false;
    await user.save();

    return user;
}


export const googleSignUpUser=async(input:googleSignUpInput)=>{
    const {fullName,email,mobile}=input;
    const normalizedEmail=email.trim().toLowerCase();

    const existingUser = await User.findOne({email:normalizedEmail});

    if(existingUser){
        const error=new Error("Account already exists. Please sign in.");

        error.name = "ACCOUNT_ALREADY_EXISTS";

        throw error;
    }

    const user = await User.create({
        fullName:fullName.trim(),
        email:normalizedEmail,
        mobile:mobile.trim(),
        role:"user"
    })

    return user;
}

export const googleSignInUser= async(input:googleSignInInput)=>{
    const {email}=input;

    const normalizedEmail=email.trim().toLowerCase();

    const user = await User.findOne({email:normalizedEmail});

     if(!user){
       const error = new Error(
      "Account not found. Please sign up first."
    );

    error.name = "ACCOUNT_NOT_FOUND";

    throw error;
    }
    return user;

}