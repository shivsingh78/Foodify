import Order from "../models/order.model.js";
import Shop from "../models/shop.model.js";
import User from "../models/user.model.js";

export const placeOrder = async (req,res) => {
     try {
          const {cartItems,paymentMethod,deliveryAddress,totalAmount}=req.body;

          if(!cartItems || !cartItems.length === 0 ){
               return res.status(400).json({message:"cart is empty"})
          } 
          if(!deliveryAddress.text || !deliveryAddress.latitude || !deliveryAddress.longitude){
                return res.status(400).json({message:"send complete deliveryAddress"})
          }

          const groupItemsByShop={}

          cartItems.forEach(item => {
               const shopId=item.shop;
               if(!groupItemsByShop[shopId]){
                    groupItemsByShop[shopId]=[]
               }
               groupItemsByShop[shopId].push(item)
               
          });

          const shopOrders = await Promise.all( Object.keys(groupItemsByShop).map( async (shopId) => {
              try {
                const shop = await Shop.findById(shopId).populate("owner")
               if(!shop) throw new Error(`shop with ${shopId} not found`)

               const items=groupItemsByShop[shopId]
               const subtotal=items.reduce((sum,i)=> sum + Number(i.price)*Number(i.quantity),0)

               return {
                    shop:shop._id,
                    owner:shop.owner._id,
                    subtotal,
                     shopOrderItems:items.map((i)=>({
                         item:i.id,
                         name:i.name,
                         price:i.price,
                         quantity:i.quantity
                     }))

               }
              } catch (error) {
               console.error(`Error for shop ${shopId}:`, error.message);
    return null;
              }
          }))

          const newOrder = await Order.create({
               user:req.userId,
               paymentMethod,
               deliveryAddress,
               totalAmount,
               shopOrders,
          })
          await newOrder.populate("shopOrders.shopOrderItems.item","name image price")
          await newOrder.populate("shopOrders.shop","name")
          return res.status(201).json(newOrder)


          
     } catch (error) {
          console.log(error);
          return res.status(500).json({
               success:false ,
               message:"Failed to create order",
               error:error.message,
          })
          
          
     }
}

//get user orders

export const getMyOrders=async (req,res) => {
     try {
          const user=await User.findById(req.userId)
          if(user.role === "user"){
               const orders = await Order.find({user:req.userId})
          .sort({createdAt:-1})
          .populate("shopOrders.shop","name")
          .populate("shopOrders.owner","name email mobile")
          .populate("shopOrders.shopOrderItems.item","name image price")

          return res.status(200).json(orders)

          } else if(user.role==="owner"){
                const orders = await Order.find({"shopOrders.owner":req.userId})
          .sort({createdAt:-1})
          .populate("shopOrders.shop","name")
          .populate("user")
          .populate("shopOrders.shopOrderItems.item","name image price")

          const filterOrders=orders.map((order=>(
               {
               _id:order._id,
               paymentMethod:order.paymentMethod,
               user:order.user,
               shopOrders:order.shopOrders.find(o=>o.owner._id == req.userId),
               createdAt:order.createdAt,
               deliveryAddress:order.deliveryAddress

          }
          )))
          return res.status(200).json(filterOrders)
          }
          
     } catch(error){
           console.log(error);
          return res.status(500).json({
               success:false ,
               message:"Failed to get user order",
               error:error.message,
          })
     }
}

export const updateOrderStatus = async (req,res) => {
     try {
          const {orderId,shopId}=req.params;
          const {status}=req.body;
          const order = await Order.findById(orderId)
          const shopOrder = order.shopOrders.find(o=>o.shop==shopId)
          if(!shopOrder){
               return res.status(400).json({message:"shop order not found"})
          }
          shopOrder.status=status;
          await shopOrder.save()
          await order.save()
          
          return res.status(200).json(shopOrder.status)
     } catch (error) {
          console.log(error);
          
          return res.status(500).json({message:"order error "})
          
     }
}

