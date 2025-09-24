import express from 'express'
import { createEditShop } from '../controllers/shop.controller.js'
import { isAuth } from '../middlewares/isAuth.js'
import { upload } from '../middlewares/multer.js'


const shopRouter = express.Router()

shopRouter.get("/create-edit",isAuth,upload.single("image"),createEditShop)

export default shopRouter