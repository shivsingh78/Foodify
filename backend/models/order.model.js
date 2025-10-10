import mongoose from "mongoose"

const shopOrderItemSchema=new mongoose.Schema({
     item: {
          type:mongoose.Schema.Types.ObjectId,
          ref:"Item",     
     },
              name:String,
              price:Number,
              quantity:Number,

},{timestamps:true})

const shopOrderSchema=new mongoose.Schema({
     shop:{
          type:mongoose.Schema.Types.ObjectId,
          ref:"Shop"
     },
     owner:{
          type:mongoose.Schema.Types.ObjectId,
          ref:"User"
     },
     subtotal:Number,
     shopOrderItems:[shopOrderItemSchema],
     status:{
          type:String,
          enum:["pending","preparing","out of delivery","delivered"],
          default:"pending"
     },
     assignment:{
          type:mongoose.Schema.Types.ObjectId,
          ref:"DeliveryAssignment"
     },
     
},{timestamps:true})

const orderSchema=new mongoose.Schema({
     user:{
          type:mongoose.Schema.Types.ObjectId,
          ref:"User"
     },
     paymentMethod:{
          type:String,
          enum:['cod','online',],
          required:true
     },
     deliveryAddress:{
          text:String,
          latitude:Number,
          longitude:Number,

     },
     totalAmount:{
          type:Number
     },
     shopOrders:[shopOrderSchema],
     

},{timestamps:true})

const Order=mongoose.model("Order",orderSchema)

export default Order