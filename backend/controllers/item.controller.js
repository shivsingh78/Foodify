import Item from "../models/item.model.js";
import Shop from "../models/shop.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";

export const addItem=async (req,res) => {
try {
     const {name,category,foodType,price}=req.body;
     let image;
     if(req.file){
          image=await uploadOnCloudinary(req.file.path)

     }
     const shop=await Shop.findOne({owner:req.userId})
     if(!shop){
          return res.status(400).json({message:"shop not found"})

     }
     const item=await Item.create({
          name,category,foodType,price,image,shop:shop._id
     })
     return res.status(201).json(item)
} catch (error) {
     console.log(error);
     return res.status(500).json({message:"add item error"})
     
     
}
     
}

export const editItem = async (req,res) => {
     try {
          const itemId=req.params.itemId;
           const {name,category,foodType,price}=req.body;
           let image;
           if(req.file){
               image=await uploadOnCloudinary(req.file.path)
           }
           const item=await Item.findByIdAndUpdate(itemId,{ name,category,foodType,price },{new:true})

           if(!item){
                return res.status(400).json({message:"item not found"})

           }
           return res.status(201).json(item)
           
     } catch (error) {
          console.log(error);
          
           return res.status(500).json({message:"edit item error"})
          
     }
     
}