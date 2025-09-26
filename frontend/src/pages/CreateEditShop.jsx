import React, { useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FaUtensils } from "react-icons/fa";
import axios from 'axios';
import { serverUrl } from '../App';
import { setMyShopData } from '../redux/ownerSlice';


function CreateEditShop() {
  const navigate=useNavigate()
  const {myShopData}=useSelector(state=>state.owner)
  const {currentCity,currentState,currentAddress}=useSelector(state=>state.user)
  const [name,setName]=useState(myShopData?.name || "")
  const [address,setAddress]=useState(myShopData?.address || currentAddress)
  const [city,setCity]=useState(myShopData?.city || currentCity)
  const [state,setState]=useState(myShopData?.state || currentState)
  const [frontendImage,setFrontendImage]=useState(myShopData?.image || null)
  const [backendImage,setBackendImage]=useState(null)
  const dispatch=useDispatch()

 const  handleImage=(e)=>{
  const file = e.target.files[0]
  setBackendImage(file)
  setFrontendImage(URL.createObjectURL(file))
  

 }
 const handleSubmit=async(e)=>{
  e.preventDefault()
  try {
    const formData=new FormData()
    formData.append("name",name)
    formData.append("city",city)
    formData.append("state",state)
    formData.append("address",address)
    if(backendImage){
      formData.append("image",backendImage)
    }
    const result = await axios.post(`${serverUrl}/api/shop/create-edit`,formData,{withCredentials:true})
    dispatch(setMyShopData(result.data))
    console.log(result.data);
    
  } catch (error) {
    console.log(error);
    
    
  }
 }


  return (
    <div className='flex justify-center flex-col items-center p-6 bg-gradient-to-br from-orange-50 relative to-white min-h-screen '>
      <div className='absolute top-[20px] left-[20px] z-[10] mb-[10px] '>
        <IoIosArrowRoundBack  size={35} className=' text-[#ff4d2d] cursor-pointer ' onClick={()=> navigate("/")} />
      </div>
      <div className='max-w-lg w-full bg-white shadow-xl rounded-2xl p-8 border border-orange-100 '>
        <div className='flex flex-col items-center mb-6 '>
          <div className='bg-orange-100 p-4 rounded-full mb-4 '>
            <FaUtensils className='text-[#ff4d2d] w-16 h-16 '/>
          </div>
          <div className='text-3xl font-extrabold text-gray-900 '>
            {myShopData?"Edit Shop" : "Add Shop"}
          </div>
        </div>
        <form className='space-y-5'>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1 '>Name </label>
            <input type="text" placeholder='Enter Shop Name' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 ' onChange={(e)=>setName(e.target.value)} value={name} />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1 '>Shop Image </label>
            <input type="file" accept='image/*' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 '  onChange={handleImage} />
            {frontendImage && (<div className='mt-4'>
              <img src={frontendImage} alt="food-image" className='w-full h-48 object-cover rounded-lg border' />
            </div>)}
          </div>
          {/*for state and city */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4 '>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1 '>City </label>
            <input type="text" placeholder='City' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 ' onChange={(e)=>setCity(e.target.value)} value={city} />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1 '>State </label>
            <input type="text" placeholder=' State' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 ' onChange={(e)=>setState(e.target.value)} value={state} />
            </div>
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1 '>Address </label>
            <input type="text" placeholder='Enter Shop address' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 ' onChange={(e)=>setAddress(e.target.value)} value={address} />
          </div>
          <button className='w-full bg-[#ff4d2d] text-white px-6  py-3 rounded-lg font-semibold shadow-md hover:bg-orange-600 hover:shadow-lg transition-all duration-200 cursor-pointer ' onClick={handleSubmit} >Save</button>
        </form>
      </div>
     
    </div>
  )
}

export default CreateEditShop

