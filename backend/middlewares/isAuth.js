import jwt from "jsonwebtoken"

export const isAuth = async (req,res,next) => {
     try {
          const token = req.cookies.token
          if(!token){
               return res.status(401).json({message:"Authentication token missing"});
          }
          const decodedToken = jwt.verify(token,process.env.JWT_SECRET)
          if(!decodedToken){
               return res.status(401).json({message:"Invalid or expired token"});
          }
          
          req.userId=decodedToken.userId
          next()
          
     } catch (error) {
          console.error("Auth error:", error.message);
          return res.status(401).json({message:"Authentication failed"});
          
     }
     
}
