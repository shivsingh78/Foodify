import express from 'express'
import { isAuth } from '../middlewares/isAuth.js'
import { getOwnerOrders, getUserOrders, placeOrder } from '../controllers/order.controller.js'


const orderRouter = express.Router()

orderRouter.post("/place-order",isAuth,placeOrder)
orderRouter.get("/user-ordes",isAuth,getUserOrders)
orderRouter.get("/owner-ordes",isAuth,getOwnerOrders)


export default orderRouter