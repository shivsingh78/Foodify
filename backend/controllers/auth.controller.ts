import User, {  UserDocument } from "../models/user.model.js";
import genToken from "../utils/token.js";
import type { Request, Response } from "express";
import { googleSignInUser, googleSignUpUser, resetUserPassword, sendOtpUser, signInUser, signUpUser, verifyUserOtp } from "../services/auth.service.js";


const getErrorMessage = (error:unknown): string =>{
     if(error instanceof Error) {
          return error.message;
     }
     return String(error);
}

const isMongoDuplicateKeyError = (error:unknown):boolean =>{
     return (
          typeof error === "object" && 
          error !==null && "code" in error && error.code ===11000
     )
}

//signup controller
export const signUp = async (req:Request,res:Response) => {
     try{

          const user= await signUpUser(req.body);
          //genrate token 
          const token = await genToken(user._id.toString())
          res.cookie("token",token,{
               secure:process.env.NODE_ENV === "production",
               sameSite:process.env.NODE_ENV === "production" ? "none" : "lax",
               maxAge:7*24*60*60*1000,
               httpOnly:true


          })
          // remove password before sending 
          const userResponse = user.toObject();
          delete userResponse.password;
          return res.status(201).json({
               message:"User created successfully",
               userResponse
          })



          } catch (error) {
               
                if(error instanceof Error && error.name === "USER_ALREADY_EXISTS"){
                    return res.status(409).json({
                         message:"User already exists"
                    })
                }

                if(isMongoDuplicateKeyError(error)){
                    return res.status(409).json({
                         message:"Email already exists"
                    })
                }
                console.log("SignUp error:",error);

                return res.status(500).json({
                    message:`Sign up error :${getErrorMessage(error)}`,
                })
                
          
     }
}

//Login controller
export const signIn = async (req:Request,res:Response) => {
     try {
          
         const user = await signInUser(req.body);

          // Generate token 
          const token = await genToken(user._id.toString()); 

          // set cookie
          res.cookie("token",token,{
               secure: process.env.NODE_ENV === "production",
               sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
               maxAge: 7*24*60*60*1000, //7days
               httpOnly: true,
          });
          // remove password before sending response
          const userResponse= user.toObject()
          delete userResponse.password;

          return res.status(200).json(userResponse)
     } catch(error){
         if(error instanceof Error && error.name === "INVALID_CREDENTIALS"){
          return res.status(401).json({
               message:"Invalid email or password",
          })
         }
         console.error("Login error:",error);

         return res.status(500).json({
          message:`Login error: ${getErrorMessage(error)}`
         })

     }
}

export const signOut = async (req:Request,res:Response) => {
     try {
          res.clearCookie("token")
           return res.status(200).json({message:`Logout successfully`})
          
     } catch (error) {
          console.error("SignOut error:", error);
            return res.status(500).json({message:`signOut error : ${getErrorMessage(error)

            }`})
          
     }
     
}
//create otp for reset password
export const sendOtp=async (req:Request,res:Response)=>{
     try {
          const {user,otp}=await sendOtpUser(req.body);
          return res.status(200).json({message:"otp sent successfully"})
          
     } catch (error) {
          console.error("SendOtp error:", error);
            return res.status(500).json({message:`send otp error: ${getErrorMessage(error)}`})
     }
}
//check and verify otp

export const verifyOtp = async (req:Request,res:Response)=>{
     try {
          const {resetToken}=await verifyUserOtp(req.body);
            return res.status(200).json({
               message:"otp verify successfully",
               resetToken

            })
          
     } catch (error) {
          console.error("VerifyOtp error:", error);
            return res.status(500).json({message:`otp verified error: ${getErrorMessage(error)}`})
          
     }
}

// restpassword

export const resetPassword=async (req:Request,res:Response)=> {
     try {
          const user=await resetUserPassword(req.body);
         
          return res.status(200).json({message:"Password reset successfully"});


     } catch (error) {
         
       if (
  error instanceof Error &&
  error.name === "INVALID_RESET_TOKEN"
) {
  return res.status(401).json({
    message: "Invalid or expired reset token",
  });
}

    console.error("Reset password error:", error);

    return res.status(500).json({
      message: `reset password error: ${getErrorMessage(error)}`,
    });
     }
}

const setAuthCookie = (res:Response, token:string) => {
     res.cookie("token", token, {
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
          httpOnly: true,
     });
}

const sendGoogleAuthResponse = async (res:Response, user:UserDocument) => {
    
     const token = await genToken(user._id.toString());
      if(!token){
          return res.status(500).json({
               message:"Failed to genrate authentication token"
          })
     }
     setAuthCookie(res, token);

     const userResponse = user.toObject();
     delete userResponse.password;
     return res.status(200).json(userResponse);
}

// Creates an application account after Firebase has completed Google sign-in.
export const googleSignUp = async (req:Request,res:Response) => {
     try {
         const user = await googleSignUpUser(req.body);
          return sendGoogleAuthResponse(res, user);

     } catch (error) {
         if (
      error instanceof Error &&
      error.name === "ACCOUNT_ALREADY_EXISTS"
    ) {
      return res.status(409).json({
        message: "Account already exists. Please sign in.",
      });
    }

    console.error("Google sign-up error:", error);

    return res.status(500).json({
      message: `Google sign-up error: ${getErrorMessage(error)}`,
    });
     }
}

// Starts an application session only for an existing application account.
export const googleSignIn = async (req:Request,res:Response) => {
     try {
         const user=await googleSignInUser(req.body);

         
          return sendGoogleAuthResponse(res, user);

     } catch (error) {
          console.error("Google sign-in error:", error);
          return res.status(500).json({message:`Google sign-in error: ${getErrorMessage(error)}`})
          
     }
}
