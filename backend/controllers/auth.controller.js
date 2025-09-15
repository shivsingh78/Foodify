import User from "../models/user.model.js";
import bcrypt from 'bcryptjs'
import genToken from "../utils/token.js";


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