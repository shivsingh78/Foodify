import express from 'express'
import dotenv from 'dotenv'
dotenv.config()
import connectDb from './config/db.js';
import cors from 'cors'
import authRouter from './routes/auth.routes.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet'
import morgan from 'morgan'
import userRouter from './routes/user.routes.js';
import shopRouter from './routes/shop.routes.js';
import itemRouter from './routes/item.routes.js';

const app = express()
const port = process.env.PORT || 5000;

//middleware
//secuirty headers
app.use(helmet())

// log requests (only in dev mode)
if(process.env.NODE_ENV === "development") {
     app.use(morgan("dev"))
}
app.use(cors({
     origin: process.env.CLIENT_URL,
     credentials:true,
}))
app.use(express.json())
app.use(cookieParser())
app.use("/api/auth",authRouter)
app.use("/api/user",userRouter)
app.use("/api/shop",shopRouter)
app.use("/api/item",itemRouter)


//check db to be connected

const startServer = async () => {
     try {
          await connectDb();
          app.listen(port, () => {
               console.log(`✅ Server started at: ${port}`);
               
          })
     } catch (error) {
           console.error("❌ Failed to connect to DB", error);
    process.exit(1); // Exit if DB fails
     }
}

startServer()



