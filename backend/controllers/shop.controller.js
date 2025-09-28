import Shop from "../models/shop.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";

export const createEditShop = async (req, res) => {
  try {
    const { name, city, state, address } = req.body;

    // 1. Validate input
    if (!name || !city || !state || !address) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 2. Check authentication
    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 3. Handle image upload
    let image = null;
    if (req.file) {
      image = await uploadOnCloudinary(req.file.path);
    }

    // 4. Find existing shop
    let shop = await Shop.findOne({ owner: req.userId });
    let message, statusCode;

    if (!shop) {
      // Create new shop
      shop = await Shop.create({
        name,
        city,
        state,
        address,
        image,
        owner: req.userId,
      });
      message = "Shop created successfully";
      statusCode = 201;
    } else {
      // Update existing shop
      const updateData = { name, city, state, address };
      if (image) updateData.image = image; // only update image if new one

      shop = await Shop.findByIdAndUpdate(shop._id, updateData, { new: true });
      message = "Shop updated successfully";
      statusCode = 200;
    }

    // 5. Populate safe owner info
    await shop.populate("owner items", "name email");

    // 6. Send response
    return res.status(statusCode).json({
      success: true,
      message,
      shop,
    });

  } catch (error) {
    console.error("createEditShop error:", error);
    return res.status(500).json({ message: "Something went wrong. Try again later." });
  }
};

export const getMyShop= async (req,res) => {
  try {
    const shop=await Shop.findOne({owner:req.userId}).populate("owner items")
    if(!shop){
      return null
    }
    return res.status(201).json(shop)
    
  } catch (error) {
    console.error("createEditShop error:", error);
    return res.status(500).json({ message: "get my shop error " });
  }
}


