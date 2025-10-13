import express from 'express'
import { isAuth } from '../middlewares/isAuth.js'
import { getDeliveryBoyAssignment, getMyOrders,  placeOrder, updateOrderStatus } from '../controllers/order.controller.js'


const orderRouter = express.Router()

orderRouter.post("/place-order",isAuth,placeOrder)
orderRouter.get("/my-orders",isAuth,getMyOrders)
orderRouter.post("/update-status/:orderId/:shopId",isAuth,updateOrderStatus)
orderRouter.get("/get-assignments",isAuth,getDeliveryBoyAssignment)  



export default orderRouter