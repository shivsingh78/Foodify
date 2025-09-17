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
               sameSite:"strict",
               maxAge:7*24*60*60*1000,
               httpOnly:true


          })
          // remove password before sending 
          const userResponse = user.toObject();
          delete userResponse.password;
          return res.status(201).json(userResponse)



          } catch (error) {
                return res.status(500).json(`sign up errro ${error}`)
          
     }
}

//Login controller
export const signIn = async (req,res) => {
     try {
          const {email,password} = req.body;
          // check if user exists
          const user = await User.findOne({email:email.trim().toLowerCase()});

          if(!user) {
               return res.status(400).json({message: "Invalid email or password"});
          }

          // compare password with hash
          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) {
               return res.status(400).json({message: "Invalid email or password "});
          }
          // Generate token 
          const token = await genToken(user._id); 

          // set cookie
          res.cookie("token",token,{
               secure: process.env.NODE_ENV === "production",
               sameSite: "strict",
               maxAge: 7*24*60*60*1000, //7days
               httpOnly: true,
          });
          // remove password before sending response
          const userResponse= user.toObject()
          delete userResponse.password;

          return res.status(200).json(userResponse)
     } catch(error){
          return res.status(500).json({message:`Login error : ${error}`})

     }
}

export const signOut = async (req,res) => {
     try {
          res.clearCookie("token")
           return res.status(200).json({message:`Logout successfully`})
          
     } catch (error) {
           return res.status(500).json({message:`signOut error : ${error}`})
          
     }
     
}
//create otp for reset password
export const sendOtp=async (req,res)=>{
     try {
          const {email}=req.body;
          const user=await User.findOne({email})
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
           return res.status(400).json(`send otp error ${error}`)
     }
}
//check and verify otp

export const verifyOtp = async (req,res)=>{
     try {
          const {email,otp}=req.body;
          const user=await User.findOne({email})
          if(!user || user.resetOtp!=otp || user.otpExpires<Date.now()){
                 return res.status(400).json({message:"Invalid/expired otp"})
          }
          user.isOtpVerified=true;
          user.resetOtp=undefined;
          user.otpExpires=undefined
          await user.save()
            return res.status(200).json({message:"otp verify successfully"})
          
     } catch (error) {
            return res.status(400).json(`otp verified error ${error}`)
          
     }
}

// restpassword

export const resetPassword=async (req,res)=> {
     try {
          const {email,newPassword}=req.body;
          const user=await User.findOne({email});
          if(!user || !user.isOtpVerified){
               return res.status(404).json({message:"verification failed"})
          }
          const hashedPassword=await bcrypt.hash(newPassword,10)
          user.password=hashedPassword
          user.isOtpVerified=false;
          await user.save();
          return res.status(200).json({message:"Password reset successfully"});


     } catch (error) {
           return res.status(400).json(`reset password error ${error}`)
          
     }
}