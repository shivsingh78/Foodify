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
import orderRouter from './routes/order.routes.js';
import http from 'http'
import { Server } from 'socket.io';
import { socketHandler } from './socket.js';

const app = express()
const server=http.createServer(app)

// Handle CORS origins for development and production
const allowedOrigins = [
     process.env.FRONTEND_URL,
     'http://localhost:3000',
     'http://localhost:5173',
     'http://127.0.0.1:3000',
     'http://127.0.0.1:5173'
].filter(Boolean);

const io = new Server(server,{
     cors:{
          origin: allowedOrigins,
          credentials:true,
          methods:['POST','GET']
     }
})
app.set("io",io)

const port = process.env.PORT || 5000;

//middleware
//secuirty headers
app.use(helmet())

// log requests (only in dev mode)
if(process.env.NODE_ENV === "development") {
     app.use(morgan("dev"))
}

// CORS configuration with proper origin handling
app.use(cors({
     origin: function(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
               callback(null, true)
          } else {
               callback(new Error('Not allowed by CORS'))
          }
     },
     credentials: true,
     methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
     allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())
app.use(cookieParser())
app.use("/api/auth",authRouter)
app.use("/api/user",userRouter)
app.use("/api/shop",shopRouter)
app.use("/api/item",itemRouter)
app.use("/api/order",orderRouter)

socketHandler(io)



//check db to be connected

const startServer = async () => {
     try {
          await connectDb();
          server.listen(port, () => {
               console.log(`✅ Server started at: ${port}`);
               console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
               
          })
     } catch (error) {
            console.error("❌ Failed to connect to DB", error);
     process.exit(1); // Exit if DB fails
     }
}

startServer()

