import express from 'express'
import { isAuth } from '../middlewares/isAuth'
import { placeOrder } from '../controllers/order.controller'


const orderRouter = express.Router()

orderRouter.post("/place-order",isAuth,placeOrder)


export default orderRouter