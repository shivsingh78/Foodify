import mongoose, { HydratedDocument } from "mongoose";

export interface ILocaiton {
     type:"Point"
     coordinates:[number,number]
}

export interface IUser{

     fullName:string
     email:string
     password?:string
     mobile:string
     isOtpVerified?:boolean
     otpExpires?:Date | null
     resetOtp?:string | null
     socketId:string
     isOnline:boolean
     role: "user" | "owner" | "deliveryBoy";
     location:ILocaiton
     
}
export type UserDocument = HydratedDocument<IUser>;

const userSchema = new mongoose.Schema<IUser>({
     fullName: {
          type: String,
          required: true
     },
     email: {
          type: String,
          required: true,
          unique: true
     },
     password: {
          type: String
     },
     mobile: {
          type: String,
          required: true,
     },
     role: {
            type: String,
            enum:["user","owner","deliveryBoy"],
          required: true
     },
     resetOtp:{
          type:String
     },
     isOtpVerified:{
          type:Boolean,
          default:false,
     },
     otpExpires:{
          type:Date,
     },
     socketId:{
          type:String
     },
     isOnline:{
          type:Boolean,
          default:false
     }
     ,
     location:{
          type:{type:String,enum:['Point'],default:'Point'},
          coordinates:{type:[Number],default:[0,0]}
     }

}, { timestamps: true })

userSchema.index({location:'2dsphere'})


const User = mongoose.model<IUser>("User",userSchema)

export default User