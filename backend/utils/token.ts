import jwt, { JwtPayload } from "jsonwebtoken"

type TokenPurpose = "password_reset";
type TokenPayload = {
     userId:string;
     purpose?:TokenPurpose;
}

const genToken = async (userId:string,purpose?:TokenPurpose,expiresIn: jwt.SignOptions["expiresIn"]="7d") => {
     try {
          const secret=process.env.JWT_SECRET;

          if(!secret){
               throw new Error("JWT_SECRET is not configured");
          }
          const payload: {
             userId:string;
             purpose?:TokenPurpose;
               
          }={
               userId,
          }

          if(purpose) {
               payload.purpose = purpose;
          }
          return jwt.sign(payload,secret,{
               expiresIn
          })
     }
     catch (error) {
          console.log(error);
          

     }
}

export const verifyToken=(token:string):JwtPayload &TokenPayload =>{
     const secret = process.env.JWT_SECRET;
     if(!secret){
          throw new Error("JWT_SECRET is not configured");
     }

     return jwt.verify(token,secret) as JwtPayload & TokenPayload;
}

export default genToken