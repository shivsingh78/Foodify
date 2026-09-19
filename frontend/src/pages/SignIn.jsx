import React, { useState } from 'react'
import { FaRegEye } from "react-icons/fa";
import { FaRegEyeSlash } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import ClipLoader from 'react-spinners/ClipLoader';
import {useNavigate} from 'react-router-dom'
import axios from 'axios'
import { serverUrl } from '../config';
import { signInWithGoogle } from '../utils/googleAuth';
import { useDispatch } from 'react-redux';
import { setUserData } from '../redux/userSlice';
function SignIn() {
     const primaryColor = '#ff4d2d';
     const bgColor = '#fff9f6';
     const borderColor = '#ddd'
     const [showPassword,setShowPassword] = useState(false)
     const [loading,setLoading]=useState(false)
     const navigate = useNavigate()
     const [email,setEmail]=useState("")
     const [password,setPassword]=useState("")
     const [err,setErr]=useState("")
    const [googleLoading,setGoogleLoading]=useState(false)
     const dispatch = useDispatch()

     const handleSignIn= async()=>{
      setLoading(true)
      try{
        const result = await axios.post(`${serverUrl}/api/auth/signin`,{
          email,
          password,
        },{withCredentials:true})
        dispatch(setUserData(result.data))
        setErr("")
      } catch(error){
       setErr(error?.response?.data?.message)
        

      } finally{
        setLoading(false)
      }
      
     }

      const handleGoogleAuth = async () => {
        if (googleLoading) return
        setGoogleLoading(true)
         try {
           const result = await signInWithGoogle()
           if (!result) return
            
           const {data} = await axios.post(`${serverUrl}/api/auth/google-signin`,{
             email:result.user.email,
           },{withCredentials:true})
         dispatch(setUserData(data))
     
         } catch (error) {
           setErr(error?.response?.data?.message || (
             error.code === "auth/popup-blocked"
               ? "Your browser blocked the Google window. Allow popups for this site and try again."
               : error.message
           ))
         } finally {
           setGoogleLoading(false)
         }
     
       }
     
     

  return (
    <div className='min-h-screen w-full flex items-center justify-center p-4  ' style={{backgroundColor:bgColor}}>
     <div className={`bg-white rounded-xl shadow-lg w-full max-w-md p-8 border-[1px] `} style={{border:`1px solid ${borderColor}`}} >
          <h1 className={`text-3xl font-bold mb-2`} style={{color:primaryColor}} >FoodiFy</h1>
          <p className='text-gray-600 mb-8  '> Sign In to your account to get started with delicious food deliveries</p>

         
          {/* email */}

          <div className='mb-4 '>
            <label htmlFor="email" className='block text-gray-700 font-medium mb-1 '> Email </label>
            <input type="email" className='w-full border rounded-lg px-3 py-2 focus:outline-none  ' placeholder='Enter your Email ' style={{border:`1px solid ${borderColor}`}} onChange={(e)=>setEmail(e.target.value)} value={email} required/>
          </div>

          {/* password */}

          <div className='mb-4 '>
            <label htmlFor="password" className='block text-gray-700 font-medium mb-1 '> Password </label>
           <div className=' relative'>
             <input type={`${showPassword?"text":"password"}`} className='w-full border rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 ' placeholder='Enter your Password ' style={{border:`1px solid ${borderColor}`}} onChange={(e)=>setPassword(e.target.value)} value={password} required />
             <button className='absolute right-3 top-[14px] text-gray-500 cursor-pointer  ' onClick={()=>setShowPassword(prev=>!prev)} >{!showPassword? <FaRegEye/>  : <FaRegEyeSlash/> }</button>
           </div>
          </div>
          <div className='text-right mb-4 text-[#ff4d2d] font-medium cursor-pointer' onClick={()=>navigate("/forgot-password")}>Forgot Password</div>

         
          <button className={`w-full mt-4 flex items-center justify-center gap-2 border rounded-lg px-4 py-2 transition duration-200 bg-[#ff4d2d] text-white hover:bg-[#e64323] cursor-pointer `} onClick={handleSignIn} disabled={loading} >
            {loading?(  <ClipLoader color="#fff" size={20} />):("Sign In")}
          </button>
           {err && <p className='text-red-500 text-center my-[10px] '>*{err}</p>
}

          <button className='w-full mt-4 flex items-center justify-center gap-2 border rounded-lg px-4 py-2 transition duration-200 border-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ' onClick={handleGoogleAuth} disabled={googleLoading}>
            <FcGoogle size={20}/>
                    <span>{googleLoading ? "Signing in..." : "Sign in with Google"}</span>
                  </button>

                  <p className="text-center mt-6">
          Want to create a new account?
          <span
            onClick={() => navigate("/signup")}
            className="text-[#ff4d2d] cursor-pointer hover:underline"
          >
            Sign Up
          </span>
          </p>
        


     </div>

    </div>
  )
}

export default SignIn
