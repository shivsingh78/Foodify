import express from 'express'
import { isAuth } from '../middlewares/isAuth.js'
import { acceptOrder, getCurrentOrder, getDeliveryBoyAssignment, getMyOrders,  getOrderById,  placeOrder, updateOrderStatus } from '../controllers/order.controller.js'


const orderRouter = express.Router()

orderRouter.post("/place-order",isAuth,placeOrder)
orderRouter.get("/my-orders",isAuth,getMyOrders)
orderRouter.post("/update-status/:orderId/:shopId",isAuth,updateOrderStatus)
orderRouter.get("/get-assignments",isAuth,getDeliveryBoyAssignment)  
orderRouter.get("/get-current-order",isAuth,getCurrentOrder)
orderRouter.get("/accept-order/:assignmentId",isAuth,acceptOrder)
orderRouter.get("/get-order-by-id/:orderId",isAuth,getOrderById)


export default orderRouter