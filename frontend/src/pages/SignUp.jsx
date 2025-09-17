import React, { useState } from 'react'
import { FaRegEye } from "react-icons/fa";
import { FaRegEyeSlash } from "react-icons/fa";
import ClipLoader from 'react-spinners/ClipLoader';
import { FcGoogle } from "react-icons/fc";
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { serverUrl } from '../App';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../../firebase';

function SignUp() {
  const primaryColor = '#ff4d2d';
  const hoverColor = '#e64323';
  const bgColor = '#fff9f6';
  const borderColor = '#ddd'
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [role, setRole] = useState("user")
  const navigate = useNavigate()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [mobile, setMobile] = useState("")
  const [password, setPassword] = useState("")
  const [showPopup,setShowPopup]=useState(false)

  const handleSignUp = async () => {
    try {
      setLoading(true)
      const result = await axios.post(`${serverUrl}/api/auth/signup`, {
        fullName,
        email,
        password,
        mobile,
        role
      }, { withCredentials: true })
      console.log(result);



    } catch (error) {
      console.log(error);


    } finally {
      setLoading(false)
    }

  }

  const handleGoogleAuth = async () => {
    try {
      if(!mobile){
        return alert("mobile number is required")
      }
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth,provider)
      console.log(result);
      


    } catch (error) {
      console.log(error);
      

    }

  }


  return (
    <div className='min-h-screen w-full flex items-center justify-center p-4  ' style={{ backgroundColor: bgColor }}>
      <div className={`bg-white rounded-xl shadow-lg w-full max-w-md p-8 border-[1px] `} style={{ border: `1px solid ${borderColor}` }} >
        <h1 className={`text-3xl font-bold mb-2`} style={{ color: primaryColor }} >FoodiFy</h1>
        <p className='text-gray-600 mb-8  '> Create your account to get started with delicious food deliveries</p>

        {/* fullName */}

        <div className='mb-4 '>
          <label htmlFor="fullName" className='block text-gray-700 font-medium mb-1 '> Full Name </label>
          <input type="text" className='w-full border rounded-lg px-3 py-2 focus:outline-none  ' placeholder='Enter your Full Name ' style={{ border: `1px solid ${borderColor}` }} onChange={(e) => setFullName(e.target.value)} value={fullName} />
        </div>
        {/* email */}

        <div className='mb-4 '>
          <label htmlFor="email" className='block text-gray-700 font-medium mb-1 '> Email </label>
          <input type="email" className='w-full border rounded-lg px-3 py-2 focus:outline-none  ' placeholder='Enter your Email ' style={{ border: `1px solid ${borderColor}` }} onChange={(e) => setEmail(e.target.value)} value={email} />
        </div>

        {/* mobile */}

        <div className='mb-4 '>
          <label htmlFor="mobile" className='block text-gray-700 font-medium mb-1 '> Mobile </label>
          <input type="text" className='w-full border rounded-lg px-3 py-2 focus:outline-none  ' placeholder='Enter your Mobile Number ' style={{ border: `1px solid ${borderColor}` }} onChange={(e) => setMobile(e.target.value)} value={mobile} />
        </div>

        {/* password */}

        <div className='mb-4 '>
          <label htmlFor="password" className='block text-gray-700 font-medium mb-1 '> Password </label>
          <div className=' relative'>
            <input type={`${showPassword ? "text" : "password"}`} className='w-full border rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 ' placeholder='Enter your Password ' style={{ border: `1px solid ${borderColor}` }} onChange={(e) => setPassword(e.target.value)} value={password} />
            <button className='absolute right-3 top-[14px] text-gray-500 cursor-pointer  ' onClick={() => setShowPassword(prev => !prev)} >{!showPassword ? <FaRegEye /> : <FaRegEyeSlash />}</button>
          </div>
        </div>

        {/* role */}

        <div className='mb-4 '>
          <label htmlFor="role" className='block text-gray-700 font-medium mb-1 '> Role </label>
          <div className=' flex gap-2'>
            {
              ["user", "owner", "deliveryBoy"].map((r) => (
                <button
                  type='button'
                  className='flex-1 border rounded-lg px-3 py-2 text-center font-medium transition-colors cursor-pointer'
                  onClick={() => setRole(r)}
                  style={
                    role == r ? { backgroundColor: primaryColor, color: "white" } : { border: `1px solid ${primaryColor}`, color: primaryColor }
                  }>
                  {r}
                </button>
              ))}

          </div>
        </div>
        <button className={`w-full mt-4 flex items-center justify-center gap-2 border rounded-lg px-4 py-2 transition duration-200 bg-[#ff4d2d] text-white hover:bg-[#e64323] cursor-pointer `} onClick={handleSignUp} disabled={loading} >
          {loading ? (<ClipLoader color="#fff" size={20} />) : ("Sign Up")}
        </button>

        <button className='w-full mt-4 flex items-center justify-center gap-2 border rounded-lg px-4 py-2 transition duration-200 border-gray-400 hover:bg-gray-100 cursor-pointer ' onClick={handleGoogleAuth}>
          <FcGoogle size={20} />
          <span>Sign up with Google </span>
        </button>

        <p className="text-center mt-6">
          Already have an account?{" "}
          <span
            onClick={() => navigate("/signin")}
            className="text-[#ff4d2d] cursor-pointer hover:underline"
          >
            Sign In
          </span>
        </p>



      </div>

    </div>
  )
}

export default SignUp