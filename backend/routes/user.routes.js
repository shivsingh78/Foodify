import express from 'express'
import { getCurrentUser } from '../controllers/user.controller.js'
import { isAuth } from '../middlewares/isAuth.js'


const userRouter = express.Router()

userRouter.get("/current",isAuth,getCurrentUser)

export default userRouter