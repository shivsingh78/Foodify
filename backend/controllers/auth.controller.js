import User from "../models/user.model.js";
import bcrypt from 'bcryptjs'
import genToken from "../utils/token.js";
import { sendOtpMail } from "../utils/mail.js";


//signup controller
export const signUp = async (req,res) => {
     try {
          const {fullName,email,password,mobile,role} = req.body;
          let user = await User.findOne({email})
          //check if user already exist
          if(user){
               return res.status(400).json({message:"User Already exist"})
          }
          //check password length
          if(password.length <6){
               return res.status(400).json({message:"password must be at least 6 characters."})
          }
           //check mobile no. length
          if(mobile.length <10){
               return res.status(400).json({message:" mobile no. must be at least 10 digits "})
          }

          //hash the password that we get from user

          const hashPassword = await bcrypt.hash(password,10)

          // check for duplicate (handle race condition)
          try {
                user = await User.create({
                fullName,
                email:email.trim().toLowerCase(),
                role,
                mobile,
                password:hashPassword
           })
          } catch (error) {
               if (error.code === 11000) {
                    // Mongo duplicate key
                    return res.status(409).json({message: "Email already exists "})
               }
               throw error;
               
          }
     

          //genrate token 
          const token = await genToken(user._id)
          res.cookie("token",token,{
               secure:process.env.NODE_ENV === "production",
               sameSite:process.env.NODE_ENV === "production" ? "strict" : "lax",
               maxAge:7*24*60*60*1000,
               httpOnly:true


          })
          // remove password before sending 
          const userResponse = user.toObject();
          delete userResponse.password;
          return res.status(201).json(userResponse)



          } catch (error) {
                console.error("SignUp error:", error);
                return res.status(500).json({message:`sign up error: ${error.message}`})
          
     }
}

//Login controller
export const signIn = async (req,res) => {
     try {
          const {email,password} = req.body;
          
          // Validate input
          if(!email || !password) {
               return res.status(400).json({message: "Email and password are required"});
          }

          // check if user exists
          const user = await User.findOne({email:email.trim().toLowerCase()});

          if(!user) {
               return res.status(401).json({message: "Invalid email or password"});
          }

          // compare password with hash
          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) {
               return res.status(401).json({message: "Invalid email or password"});
          }
          // Generate token 
          const token = await genToken(user._id); 

          // set cookie
          res.cookie("token",token,{
               secure: process.env.NODE_ENV === "production",
               sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
               maxAge: 7*24*60*60*1000, //7days
               httpOnly: true,
          });
          // remove password before sending response
          const userResponse= user.toObject()
          delete userResponse.password;

          return res.status(200).json(userResponse)
     } catch(error){
          console.error("SignIn error:", error);
          return res.status(500).json({message:`Login error : ${error.message}`})

     }
}

export const signOut = async (req,res) => {
     try {
          res.clearCookie("token")
           return res.status(200).json({message:`Logout successfully`})
          
     } catch (error) {
          console.error("SignOut error:", error);
            return res.status(500).json({message:`signOut error : ${error.message}`})
          
     }
     
}
//create otp for reset password
export const sendOtp=async (req,res)=>{
     try {
          const {email}=req.body;
          
          if(!email) {
               return res.status(400).json({message: "Email is required"});
          }

          const user=await User.findOne({email:email.trim().toLowerCase()})
          if(!user){
               return res.status(404).json({message:"User does not exist."})
          }
          const otp=Math.floor(1000 + Math.random() * 9000).toString()
          user.resetOtp=otp;
          user.otpExpires=Date.now()+5*60*1000;
          user.isOtpVerified=false;
          await user.save()
          await sendOtpMail(email,otp)
          return res.status(200).json({message:"otp sent successfully"})
          
     } catch (error) {
          console.error("SendOtp error:", error);
            return res.status(500).json({message:`send otp error: ${error.message}`})
     }
}
//check and verify otp

export const verifyOtp = async (req,res)=>{
     try {
          const {email,otp}=req.body;
          
          if(!email || !otp) {
               return res.status(400).json({message: "Email and OTP are required"});
          }

          const user=await User.findOne({email:email.trim().toLowerCase()})
          if(!user || user.resetOtp!=otp || user.otpExpires<Date.now()){
                 return res.status(400).json({message:"Invalid/expired otp"})
          }
          user.isOtpVerified=true;
          user.resetOtp=undefined;
          user.otpExpires=undefined
          await user.save()
            return res.status(200).json({message:"otp verify successfully"})
          
     } catch (error) {
          console.error("VerifyOtp error:", error);
            return res.status(500).json({message:`otp verified error: ${error.message}`})
          
     }
}

// restpassword

export const resetPassword=async (req,res)=> {
     try {
          const {email,newPassword}=req.body;
          
          if(!email || !newPassword) {
               return res.status(400).json({message: "Email and new password are required"});
          }

          const user=await User.findOne({email:email.trim().toLowerCase()});
          if(!user || !user.isOtpVerified){
               return res.status(401).json({message:"Verification failed"})
          }
          const hashedPassword=await bcrypt.hash(newPassword,10)
          user.password=hashedPassword
          user.isOtpVerified=false;
          await user.save();
          return res.status(200).json({message:"Password reset successfully"});


     } catch (error) {
          console.error("ResetPassword error:", error);
            return res.status(500).json({message:`reset password error: ${error.message}`})
          
     }
}

const setAuthCookie = (res, token) => {
     res.cookie("token", token, {
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
          httpOnly: true,
     });
}

const sendGoogleAuthResponse = async (res, user) => {
     const token = await genToken(user._id);
     setAuthCookie(res, token);

     const userResponse = user.toObject();
     delete userResponse.password;
     return res.status(200).json(userResponse);
}

// Creates an application account after Firebase has completed Google sign-in.
export const googleSignUp = async (req,res) => {
     try {
          const {fullName,email,mobile,role}=req.body;
          
          if(!fullName || !email || !mobile || !role) {
               return res.status(400).json({message: "Full name, email, mobile, and role are required"});
          }

          const normalizedEmail = email.trim().toLowerCase();
          const existingUser = await User.findOne({email: normalizedEmail});
          if(existingUser) {
               return res.status(409).json({message: "Account already exists. Please sign in."});
          }

          const user = await User.create({
               fullName,
               email: normalizedEmail,
               mobile,
               role
          });

          return sendGoogleAuthResponse(res, user);

     } catch (error) {
          console.error("Google sign-up error:", error);
          return res.status(500).json({message:`Google sign-up error: ${error.message}`})
     }
}

// Starts an application session only for an existing application account.
export const googleSignIn = async (req,res) => {
     try {
          const {email} = req.body;

          if(!email) {
               return res.status(400).json({message: "Email is required"});
          }

          const user = await User.findOne({email: email.trim().toLowerCase()});
          if(!user) {
               return res.status(404).json({message: "Account not found. Please sign up first."});
          }

          return sendGoogleAuthResponse(res, user);

     } catch (error) {
          console.error("Google sign-in error:", error);
          return res.status(500).json({message:`Google sign-in error: ${error.message}`})
          
     }
}
