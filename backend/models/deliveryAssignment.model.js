import mongoose from "mongoose";

const deliveryAssignmentSchema=new mongoose.Schema({
     order: {
          type: mongoose.Schema.ObjectId,
          ref:"Order"
     },
     shop: {
          type: mongoose.Schema.ObjectId,
          ref:"Shop"
     },
     shopOrderId: {
          type: mongoose.Schema.ObjectId,
         required:true
     },
     brodcastedTo: [{
          type: mongoose.Schema.ObjectId,
          ref:"User"
     }],
     assignedTo:{
           type: mongoose.Schema.ObjectId,
          ref:"User",
          default:null
     },
     status:{
         type:String,
         enum:["brodcasted","assigned","completed"] 
     },
     acceptedAt:Date

},{timestamps:true})

const DeliveryAssignment=mongoose.model("DeliveryAssignment",deliveryAssignmentSchema)
export default DeliveryAssignment