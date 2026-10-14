import React, { useEffect, useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { FaUtensils } from "react-icons/fa";
import axios from 'axios';
import { serverUrl } from '../config';
import { setMyShopData } from '../redux/ownerSlice';
import ClipLoader from 'react-spinners/ClipLoader';



function EditItem() {
     const [currentItem,setCurrentItem]=useState(null)
     const {itemId}=useParams()
  const navigate=useNavigate()
  
  const [name,setName]=useState("")
  const [price,setPrice]=useState( 0)
  const [frontendImage,setFrontendImage]=useState(  "")
  const [backendImage,setBackendImage]=useState(null)
  const [category,setCategory]=useState("")
  const [foodType,setFoodType]=useState( "")
  const [loading,setLoading]=useState(false)
  const [isAvailable,setIsAvailable]=useState(true)
  
  const categories=[
               "Snacks",
               "Main Course",
               "Desserts",
               "Pizza",
               "Burgers",
               "Sandwiches",
               "South Indian",
               "North Indian",
               "Chinese",
               "Fast Food",
               "Others",

          ]
  const dispatch=useDispatch()
  

 const  handleImage=(e)=>{
  const file = e.target.files[0]
  setBackendImage(file)
  setFrontendImage(URL.createObjectURL(file))
  

 }
 const handleSubmit=async(e)=>{
   e.preventDefault()
     setLoading(true)
 
  try {
    const formData=new FormData()
    formData.append("name",name)
    formData.append("category",category)
    formData.append("foodType",foodType)
    formData.append("price",price)
    formData.append("isAvailable",isAvailable)

    if(backendImage){
      formData.append("image",backendImage)
    }
    const result = await axios.post(`${serverUrl}/api/item/edit-item/${itemId}`,formData,{withCredentials:true})
    dispatch(setMyShopData(result.data))
    console.log(result.data);
    
    setLoading(false)
    navigate("/")
  } catch (error) {
    console.log(error);
    setLoading(false)
    
    
  }
 }

 useEffect(()=>{
     const handleGetItemById=async ()=> {
          try {
               const result = await axios.get(`${serverUrl}/api/item/get-by-id/${itemId}`,{withCredentials:true})
               setCurrentItem(result.data)
          } catch (error) {
               console.log(error);
               
          }
     }
     handleGetItemById()
     
 },[itemId])

 useEffect(()=>{
     setName(currentItem?.name || "")
     setPrice(currentItem?.price || 0)
     setCategory(currentItem?.category || "")
     setFoodType(currentItem?.foodType || "")
     setIsAvailable(currentItem?.isAvailable !== false)
     setFrontendImage(currentItem?.image || "")
 },[currentItem])


  return (
    <div className='flex justify-center flex-col items-center p-6 bg-gradient-to-br from-primary-soft relative to-white min-h-screen '>
      <div className='absolute top-[20px] left-[20px] z-[10] mb-[10px] '>
        <IoIosArrowRoundBack  size={35} className=' text-primary cursor-pointer ' onClick={()=> navigate("/")} />
      </div>
      <div className='max-w-lg w-full bg-white shadow-xl rounded-2xl p-8 border border-primary-soft '>
        <div className='flex flex-col items-center mb-6 '>
          <div className='bg-primary-soft p-4 rounded-full mb-4 '>
            <FaUtensils className='text-primary w-16 h-16 '/>
          </div>
          <div className='text-3xl font-extrabold text-ink '>
           Edit Food
          </div>
        </div>
        <form className='space-y-5'>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Name </label>
            <input type="text" placeholder='Enter Food Name' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setName(e.target.value)} value={name} />
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Food Image </label>
            <input type="file" accept='image/*' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary '  onChange={handleImage} />
            {frontendImage && (<div className='mt-4'>
              <img src={frontendImage} alt="food-image" className='w-full h-48 object-cover rounded-lg border' />
            </div>)}
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Price </label>
            <input type="number" placeholder='0' className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setPrice(e.target.value)} value={price} />
          </div>
          <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Select Category </label>
            <select className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setCategory(e.target.value)} value={category} >
               <option value="">
                    Select Category
               </option>
               {categories.map((cate,index)=>(
                    <option value={cate} key={index} >
                    {cate}
               </option>
               ))}
               
                </select>
          </div>
           <div>
            <label className='block text-sm font-medium text-ink mb-1 '>Select Food Type </label>
            <select className='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ' onChange={(e)=>setFoodType(e.target.value)} value={foodType} >
               <option value="veg">
                    veg
               </option>
                <option value="non veg">
                   non veg
               </option>
               
               
                </select>
          </div>
          
          <label className='flex items-center gap-2 text-sm text-ink'>
            <input type="checkbox" checked={isAvailable} onChange={(e)=>setIsAvailable(e.target.checked)} className='h-4 w-4 accent-primary' />
            Available for ordering
          </label>
          <button className='w-full bg-primary text-white px-6  py-3 rounded-lg font-semibold shadow-md hover:bg-primary-hover hover:shadow-lg transition-all duration-200 cursor-pointer ' onClick={handleSubmit} disabled={loading} >{loading?<ClipLoader size={20} color="white" />:"Save" } </button>
        </form>
      </div>
     
    </div>
  )
}

export default EditItem

