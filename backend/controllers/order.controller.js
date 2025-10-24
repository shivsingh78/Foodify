// Import all required Mongoose models
import DeliveryAssignment from "../models/deliveryAssignment.model.js";
import Order from "../models/order.model.js";
import Shop from "../models/shop.model.js";
import User from "../models/user.model.js";
import { sendDeliveryOtpMail } from "../utils/mail.js";
import Razorpay from 'razorpay'
import dotenv from "dotenv"
dotenv.config()

let  instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID ,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

//controller for place order
export const placeOrder = async (req,res) => {
     try {

          const {cartItems,paymentMethod,deliveryAddress,totalAmount}=req.body;

          if(!cartItems || cartItems.length === 0 ){
               return res.status(400).json({message:"cart is empty"})
          } 
          if(!deliveryAddress.text || !deliveryAddress.latitude || !deliveryAddress.longitude){
                return res.status(400).json({message:"send complete deliveryAddress"})
          }
          // Object to group cart items by shop
          const groupItemsByShop={}
          //✅ Group each item by its shopId
          cartItems.forEach(item => {
               const shopId=item.shop;
               if(!groupItemsByShop[shopId]){
                    groupItemsByShop[shopId]=[]
               }
               groupItemsByShop[shopId].push(item)
               
          });
          //✅ For each shop, calculate subtotal and prepare sub-order

          const shopOrders = await Promise.all( Object.keys(groupItemsByShop).map( async (shopId) => {
              try {
               //Find shop and its owner details
                const shop = await Shop.findById(shopId).populate("owner")
               if(!shop) throw new Error(`shop with ${shopId} not found`)

               const items=groupItemsByShop[shopId]
               //Calculate subtotal for this shop
               const subtotal=items.reduce((sum,i)=> sum + Number(i.price)*Number(i.quantity),0)

               // Return sub-order structure for this shop

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
          // if Payment method is offline

          if(paymentMethod == "online"){
               const razorOrder = await  instance.orders.create({
                    amount:Math.round(totalAmount*100) ,
                    currency:'INR',
                    receipt:'receipt_${Date.now()}'


               })
               const newOrder = await Order.create({
                    user:req.userId,
                    paymentMethod,
                    deliveryAddress,
                    totalAmount,
                    shopOrders,
                    razorpayOrderId: razorOrder.id,
                    payment:false,
               })
               return res.status(200).json({
                    razorOrder,
                    orderId:newOrder._id,
                    
               })
          }

          // Create main order document

          const newOrder = await Order.create({
               user:req.userId,
               paymentMethod,
               deliveryAddress,
               totalAmount,
               shopOrders,
          })

          // Populate referenced fields for detailed response 
          await newOrder.populate("shopOrders.shopOrderItems.item","name image price")
          await newOrder.populate("shopOrders.shop","name socketId")
          await newOrder.populate("shopOrders.owner", "socketId  name");

          await newOrder.populate("user","name email mobile")

          const io=req.app.get('io')

          if(io){
               newOrder.shopOrders.forEach(shopOrder => {
                    const ownerSocketId = shopOrder.owner.socketId 
                    if(ownerSocketId){
                         io.to(ownerSocketId).emit('newOrder',{
     _id:newOrder._id,
     paymentMethod:newOrder.paymentMethod,
     user: newOrder.user,
     shopOrders: shopOrder,
     createdAt: newOrder.createdAt,
     deliveryAddress: newOrder.deliveryAddress,
     payment: newOrder.payment
})
                    }
                    
               });
          }

          //implement socket io for real time commnunication 

          // Send created order back to client 
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

//verify razorpay payment
export const verifyPayment = async (req,res)=> {
     try {
          const {razorpay_payment_id,orderId}= req.body;
          const payment = await instance.payments.fetch(razorpay_payment_id)
          if(!payment || payment.status !== "captured"){
               return res.status(404).json({message:"payment not captured"})
          }
          const order = await Order.findById(orderId)
          if(!order){
               return res.status(404).json({message:"order not found"})
          }
          order.payment=true
          order.razorpayPaymentId=razorpay_payment_id
          await order.save()

          await order.populate("shopOrders.shopOrderItems.item","name image price")
          await order.populate("shopOrders.shop","name")
          await order.populate("shopOrders.owner","socketId name ")
          await order.populate("user","name email mobile")

          const io = req.app.get('io')

         if(io){
           order.shopOrders.forEach(shopOrder => {
               const ownerSocketId = shopOrder.owner.socketId
               if(ownerSocketId){
                    io.to(ownerSocketId).emit('newOrder', {
                         _id: order._id,
                         paymentMethod: order.paymentMethod,
                         user:order.user,
                         shopOrders: shopOrder,
                         createdAt:order.createdAt,
                         deliveryAddress: order.deliveryAddress,
                         payment:order.payment
                    })
               }
               
          });
         }




          return res.status(200).json(order)
     } catch (error) {
          console.log(error);
          return res.status(500).json({message:"server error due to verify payment"})
          
          
     }
}

//get user orders

export const getMyOrders=async (req,res) => {
     try {
          const user=await User.findById(req.userId)
          // CASE 1: When user is a customer
          if(user.role === "user"){
               const orders = await Order.find({user:req.userId})
          .sort({createdAt:-1})
          .populate("shopOrders.shop","name")
          .populate("shopOrders.owner","name email mobile")
          .populate("shopOrders.shopOrderItems.item","name image price")

          return res.status(200).json(orders)

          // CASE 2: When user is a shop owner

          } else if(user.role==="owner"){
                const orders = await Order.find({"shopOrders.owner":req.userId})
          .sort({createdAt:-1})
          .populate("shopOrders.shop","name")
          .populate("user")
          .populate("shopOrders.shopOrderItems.item","name image price")
          .populate("shopOrders.assignedDeliveryBoy" , "fullName mobile")

          // Filter each order to only include that owner's shopOrders

          const filterOrders=orders.map((order=>(
               {
               _id:order._id,
               paymentMethod:order.paymentMethod,
               user:order.user,
               shopOrders:order.shopOrders.find(o=>o.owner._id == req.userId),
               createdAt:order.createdAt,
               deliveryAddress:order.deliveryAddress,
               payment:order.payment

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
// update order status and find nearby delivery boys
export const updateOrderStatus = async (req,res) => {
     try {
         
          
          const {orderId,shopId}=req.params;
          const {status}=req.body;
          //Find main order and the shop-specific sub order
          const order = await Order.findById(orderId)
          const shopOrder = order.shopOrders.find(o=>o.shop==shopId)
          if(!shopOrder){
               return res.status(400).json({message:"shop order not found"})
          }
          //update order status
          shopOrder.status=status;
          let deliveryBoysPayload=[]

          // If status is "out of delivery ", find nearby delivery boys 

          if(status=="out of delivery" && !shopOrder.assignment){
               const {longitude,latitude}=order.deliveryAddress;

               // Find all delivery boys within 5km radius
               const nearByDeliveryBoys = await User.find({
                    role:"deliveryBoy",
                    location:{
                         $near:{
                              $geometry:{type:"Point",coordinates:[Number(longitude),Number(latitude)] },
                              $maxDistance:5000
                         }
                    }

               })

               //Get list of nearby IDs

               const nearByIds = nearByDeliveryBoys.map(b=>b._id)
               //Find delivery boys who are currently busy (not available)
               const busyIds = await DeliveryAssignment.find({
                    assignedTo:{$in:nearByIds},
                    status:{$nin:["brodcasted","completed"]}
               }).distinct("assignedTo")

               //Filter out busy delivery boys

               const busyIdSet = new Set(busyIds.map(id => String(id)))

               const avilableBoys=nearByDeliveryBoys.filter(b=>!busyIdSet.has(String(b._id)))

               const candidates=avilableBoys.map(b=>b._id)
              
               
               //If no delivery boys available, just save order and respond
               if(candidates.length==0){
                    await order.save()
                    return res.json({
                         message:"order status updated but there is no available delivery boys"
                    })
               }

               // Create a new DeliveryAssignment document
             
               

               const deliveryAssignment =await DeliveryAssignment.create({
                    order:order._id,
                    shop:shopOrder.shop,
                    shopOrderId:shopOrder._id,
                    brodcastedTo:candidates,
                    status:"brodcasted"

               })
               //Attach assignment info to shop order
               shopOrder.assignedDeliveryBoy=deliveryAssignment.assignedTo
               shopOrder.assignment=deliveryAssignment._id;

               //Prepare structtured info for frontend map/tracking

               deliveryBoysPayload=avilableBoys.map(b=>({
                    id:b._id,
                    fullName:b.fullName,
                    longitude:b.location.coordinates?.[0],
                    latitude:b.location.coordinates?.[1],
                    mobile:b.mobile
               }))
               await deliveryAssignment.populate('order')
               await deliveryAssignment.populate('shop')

               const io = req.app.get('io')
                
               if(io){
                    avilableBoys.forEach(boy => {
                         const boySocketId = boy.socketId
                         if(boySocketId){
                              io.to(boySocketId).emit('newAssignment',{
                                   sentTo:boy._id,
          assignmentId: deliveryAssignment._id,
          orderId:deliveryAssignment.order._id,
          shopName:deliveryAssignment.shop.name,
          deliveryAddress:deliveryAssignment.order.deliveryAddress,
          items:deliveryAssignment.order.shopOrders.find(so=> so._id.equals(deliveryAssignment.shopOrderId)).shopOrderItems || [],
          subtotal: deliveryAssignment.order.shopOrders.find(so => so._id.equals(deliveryAssignment.shopOrderId))?.subtotal

                              })
                         }
                         
                    });
               }



          }

          //Save both main order and shop sub-order

          await shopOrder.save()
          await order.save()
          //Find updated shop order again after save
           const updatedShopOrder = order.shopOrders.find(o=>o.shop==shopId)
          
           

          await order.populate("shopOrders.shop","name")
          await order.populate("shopOrders.assignedDeliveryBoy","fullName email mobile")
          await order.populate("user","socketId")

         

        

          //Implement socketIO for real time check user Order status
          const io=req.app.get('io')
          if(io){
               const userSocketId = order.user.socketId
               if(userSocketId){
                    io.to(userSocketId).emit('update-status',{
                         orderId:order._id,
                         shopId:updatedShopOrder._id,
                         status:updatedShopOrder.status,
                         userId:order.user._id

                    })
               }

          }



         
          //✅ Send response with updated data
          return res.status(200).json({
               shopOrder:updatedShopOrder,
               assignedDeliveryBoy:updatedShopOrder?.assignedDeliveryBoy,
               availableBoys:deliveryBoysPayload,
               assignment:updatedShopOrder?.assignment?._id,
          })
     } catch (error) {
          console.log(error);
          
          return res.status(500).json({message:"order error "})
          
     }
}

export const getDeliveryBoyAssignment = async (req,res) => {
     try {
          
          const deliveryBoyId=req.userId;
          const assignment = await DeliveryAssignment.find({
               brodcastedTo:deliveryBoyId,
               status:"brodcasted"
          })
          .populate("order")
          .populate("shop")

          const formated = assignment.map(a=>({
               assignmentId:a._id,
               orderId:a.order._id,
               shopName:a.shop.name,
               deliveryAddress:a.order.deliveryAddress,
               items:a.order.shopOrders.find(so=>so._id.equals(a.shopOrderId))?.shopOrderItems || [],
               subtotal:a.order.shopOrders.find(so=>so._id.equals(a.shopOrderId))?.subtotal
               
               
          }))
          return res.status(200).json(formated)
     } catch (error) {
          console.log(error);
          return res.status(500).json({message: "get delivery boy Assignment error"})
          
          
     }
}


// controller for accept delivery boy

export const acceptOrder = async (req,res) => {
     try {
          const {assignmentId} = req.params;
          const assignment = await DeliveryAssignment.findById(assignmentId)
          if(!assignment){
               return res.status(404).json({message:"assignment is not found "})
          }
          if(assignment.status !== "brodcasted"){
               return res.status(409).json({message:"assignment is expired"})
          }
          const alreadyAssigned = await DeliveryAssignment.findOne({
               assignedTo:req.userId,
               status:{$nin:["brodcasted","completed"]}
          })
          if(alreadyAssigned){
               return res.status(400).json({message:"You are already assigned to another order"})
          }

          assignment.assignedTo = req.userId
          assignment.status='assigned'
          assignment.acceptedAt=new Date()
          await assignment.save()

          const order = await Order.findById(assignment.order)
          if(!order){
               return res.status(400).json({message:"order not found"})
          }
          const shopOrder = order.shopOrders.find(so=>so._id.equals(assignment.shopOrderId))
          shopOrder.assignedDeliveryBoy=req.userId

          await order.save()

          return res.status(200).json({
               sucess:true,
               message:"order accepted sucessfully",
               assignmentId:assignment._id,
               orderId:order._id
          })


     } catch (error) {
          console.log(error);
          
           return res.status(500).json({message:"Error accepting order"})
          
     }
}

//controller for show current order in delivery page

export const getCurrentOrder=async (req,res) => {
     try {
          const assignment = await DeliveryAssignment.findOne({
               assignedTo:req.userId,
               status:"assigned"
          })
          .populate("shop","name")
          .populate("assignedTo","fullName email mobile location")
          .populate({
               path:"order",
               populate:[{path:"user", select:"fullName email location mobile"},
                     { path: "shopOrders.shop", select: "name address" }  

               ]
              
          })
          if(!assignment){
               return res.status(404).json({message:"assignment not found"})
          }
          if(!assignment.order){
               return res.status(404).json({message:"order not found"})
          }
          const shopOrder=assignment.order.shopOrders.find(so=>String(so._id)== String(assignment.shopOrderId))
          if(!shopOrder){
               return res.status(404).json({message:"shopOrder not found"})
          }
          
          let deliveryBoyLocation={lat:null,lon:null}
          if(assignment.assignedTo.location.coordinates.length  ==2){
               deliveryBoyLocation.lat=assignment.assignedTo.location.coordinates[1]
          deliveryBoyLocation.lon=assignment.assignedTo.location.coordinates[0] 
          

          }

          

          let customerLocation={lat:null,lon:null}
          if(assignment.order.deliveryAddress){
               customerLocation.lat = assignment.order.deliveryAddress.latitude

           customerLocation.lon=assignment.order.deliveryAddress.longitude

          }

          return res.status(200).json({
               _id:assignment.order._id,
               user:assignment.order.user,
               shopOrder,
               deliveryAddress:assignment.order.deliveryAddress,
               deliveryBoyLocation,
               customerLocation
          })
           
          
     } catch (error) {
          console.log(error);
           return res.status(400).json({message:"get current order error"})
          
          
     }
     
}

export const getOrderById = async(req,res) => {
     try {
          const {orderId} = req.params
          const order = await Order.findById(orderId)
          .populate({
               path:"shopOrders.shop",
               model:"Shop"
          })
          .populate({
               path:"shopOrders.assignedDeliveryBoy",
               model:"User"

          })
          .populate({
               path:"shopOrders.shopOrderItems.item",
               model:"Item"
          })
          .lean()

          if(!order){
               return res.status(404).json({message:"order not found"})

          }
          return res.status(201).json(order)

          
     } catch (error) {
           console.log(error);
           return res.status(400).json({message:"get  order by Id error"})
          
     }
} 

export const sendDeliveryOtp = async (req,res) => {
     try {
          const {orderId,shopOrderId} = req.body
          const order = await Order.findById(orderId).populate("user")
          const shopOrder = order.shopOrders.id(shopOrderId)

          if(!order || !shopOrder){
              return res.status(404).json({message:"enter valid order or shopOrderid"})
          }
           const otp = Math.floor(1000 + Math.random() * 9000).toString()
           shopOrder.deliveryOtp=otp
           shopOrder.otpExpires = Date.now() + 5*60*1000
           await order.save()
           await sendDeliveryOtpMail(order.user,otp)

           return res.status(200).json({message: `Otp sent Sucessfully to ${order?.user?.fullName}`})
          
     } catch (error) {
          console.log(error);
           return res.status(500).json({message: `delivery Otp sent error `})
          
          
          
     }
     
}

export const verifyDeliveryOtp = async (req,res) => {
     try {
          const {orderId,shopOrderId,otp}=req.body
          const order = await Order.findById(orderId).populate("user")
          if(!order ){
               return res.status(404).json({message: " order not found"})
          }
          const shopOrder = order.shopOrders.id(shopOrderId)
          if( !shopOrder){
               return res.status(404).json({message: "shop order not found"})
          }
          if(shopOrder.deliveryOtp !== otp || !shopOrder.otpExpires || shopOrder.otpExpires < Date.now()){
               return res.status(400).json({message:"Invalid or Expired otp"})
          }
          shopOrder.status = "delivered"
          shopOrder.deliveredAt=Date.now()
          await order.save()
          await DeliveryAssignment.deleteOne({
               shopOrderId:shopOrder._id,
               order:order._id,
               assignedTo:shopOrder.assignedDeliveryBoy
          })

          return res.status(200).json({message:"Order Delivered Sucessfully"})



     } catch (error) {
           console.log(error);
           return res.status(500).json({message: `Internal server error while verifying otp `})
          
     }
}