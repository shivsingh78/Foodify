import { v2 as cloudinary } from 'cloudinary'   
import fs from "fs" 

const uploadOnCloudinary = async (file) => {
  cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  try {
    const result = await cloudinary.uploader.upload(file, {
      folder: "food-items",      // optional folder
      use_filename: true,        // keep original filename
      unique_filename: true,     // ✅ ensures Cloudinary generates unique public_id
      overwrite: false,          // ✅ prevents overwriting old image
      resource_type: "auto"      // supports image/video
    });

    fs.unlinkSync(file); 
    return result.secure_url;    // this will now be NEW every time

  } catch (error) {
    fs.unlinkSync(file);
    console.log("Cloudinary upload error:", error);
    return null;
  }
}

export default uploadOnCloudinary;
