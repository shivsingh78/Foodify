import express from 'express'
import { googleSignIn, googleSignUp, resetPassword, sendOtp, signIn, signOut, signUp, verifyOtp } from '../controllers/auth.controller.js'
import { validate } from '../middlewares/validate.js'
import { googleSignInSchema, googleSignUpSchema, resetPasswordSchema, sendOtpSchema, signInSchema, signUpSchema, verifyOtpSchema } from '@foodify/validation'

const authRouter = express.Router()

authRouter.post("/signup", validate(signUpSchema) , signUp)
authRouter.post("/signin",validate(signInSchema),signIn)
authRouter.get("/signout",signOut)
authRouter.post("/send-otp",validate(sendOtpSchema),sendOtp)
authRouter.post("/verify-otp",validate(verifyOtpSchema),verifyOtp)
authRouter.post("/reset-password",validate(resetPasswordSchema),resetPassword)
authRouter.post("/google-signup",validate(googleSignUpSchema),googleSignUp)
authRouter.post("/google-signin",validate(googleSignInSchema),googleSignIn)

export default authRouter
