import React, { useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FaUtensils } from "react-icons/fa";
import axios from 'axios';
import { serverUrl } from '../config';
import { setMyShopData } from '../redux/ownerSlice';
import ClipLoader from 'react-spinners/ClipLoader';
import LocationPicker from '../components/LocationPicker';
import { shopPointFromLocation } from '../utils/shopLocation';



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
  const [loading,setLoading]=useState(false)
  // Pickup point for delivery partners ({ latitude, longitude }); starts from the saved shop location.
  const [point,setPoint]=useState(shopPointFromLocation(myShopData?.location))
  const [error,setError]=useState('')
  const dispatch=useDispatch()
  

 const  handleImage=(e)=>{
  const file = e.target.files[0]
  setBackendImage(file)
  setFrontendImage(URL.createObjectURL(file))
  

 }
 const onPlace=(p)=>{
  setPoint({latitude:p.latitude,longitude:p.longitude})
  setError('')
 }
 const handleSubmit=async(e)=>{
  e.preventDefault()
  if(!point){
    setError('Select the shop location on the map. Delivery partners near this point receive your orders.')
    return
  }
  setLoading(true)
  try {
    const formData=new FormData()
    formData.append("name",name)
    formData.append("city",city)
    formData.append("state",state)
    formData.append("address",address)
    formData.append("latitude",String(point.latitude))
    formData.append("longitude",String(point.longitude))
    if(backendImage){
      formData.append("image",backendImage)
    }
    const result = await axios.post(`${serverUrl}/api/shop/create-edit`,formData,{withCredentials:true})
    dispatch(setMyShopData(result.data))
    setLoading(false)
    navigate("/")
   
    
  } catch (error) {
    console.log(error);
    setError(error?.response?.data?.message || 'Could not save the shop. Please try again.')
    setLoading(false)
    
    
  }
 }


  return (
    <div className='flex justify-center flex-col items-center p-6 bg-gradient-to-br from-primary-soft relative to-background min-h-screen '>
      <div className='absolute top-[20px] left-[20px] z-[10] mb-[10px] '>
        <IoIosArrowRoundBack  size={35} className=' text-brand cursor-pointer ' onClick={()=> navigate("/")} />
      </div>
      <div className='max-w-lg w-full bg-surface shadow-xl rounded-2xl p-8 border border-primary-soft '>
        <div className='flex flex-col items-center mb-6 '>
          <div className='bg-primary-soft p-4 rounded-full mb-4 '>
            <FaUtensils className='text-brand w-16 h-16 '/>
          </div>
          <div className='text-3xl font-extrabold text-ink '>
            {myShopData?"Edit Shop" : "Add Shop"}
          </div>
        </div>
        <form className='space-y-5'>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Name </label>
            <input type="text" placeholder='Enter Shop Name' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setName(e.target.value)} value={name} />
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Shop Image </label>
            <input type="file" accept='image/*' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary '  onChange={handleImage} />
            {frontendImage && (<div className='mt-4'>
              <img src={frontendImage} alt="food-image" className='w-full h-48 object-cover rounded-lg border' />
            </div>)}
          </div>
          {/*for state and city */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4 '>
            <div>
              <label className='block text-sm font-medium text-ink mb-1 '>City </label>
            <input type="text" placeholder='City' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setCity(e.target.value)} value={city} />
            </div>
            <div>
              <label className='block text-sm font-medium text-ink mb-1 '>State </label>
            <input type="text" placeholder=' State' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setState(e.target.value)} value={state} />
            </div>
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Address </label>
            <input type="text" placeholder='Enter Shop address' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setAddress(e.target.value)} value={address} />
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Shop location (pickup point) </label>
            <LocationPicker value={point} onChange={onPlace} />
            <p className='mt-1 text-xs text-muted'>Delivery partners are matched by their distance from this point, so place the pin exactly on your restaurant.</p>
          </div>
          {error && <p role='alert' className='text-sm text-danger'>{error}</p>}
          <button className='w-full bg-primary text-white px-6  py-3 rounded-lg font-semibold shadow-md hover:bg-primary-hover hover:shadow-lg transition-all duration-200 cursor-pointer ' onClick={handleSubmit} disabled={loading} >{loading?<ClipLoader size={20} color="white" />:"Save" }</button>
        </form>
      </div>
     
    </div>
    
  )
}

export default CreateEditShop

