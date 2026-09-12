 import mongoose from "mongoose"
 

 const connectDb=async () => {
     try {
          await mongoose.connect(process.env.MONGODB_URL)
          console.log("✅ mongoDB connected");
          
     } catch (error) {
          console.log("mongoDB connection failed",error); 
          
          
     }
     
 }

 export default connectDb