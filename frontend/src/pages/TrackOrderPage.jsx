import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useParams } from 'react-router-dom'
import { serverUrl } from '../App'

function TrackOrderPage() {
     const {orderId}=useParams()
     const [currentOrder,setCurrentOrder]=useState()
     const handleGetOrder = async () => {
          try {
               const result = await axios.get(`${serverUrl}/api/order/get-order-by-id/${orderId}`,{withCredentials:true})
               setCurrentOrder(result.data)
               
          } catch (error) {
               console.log(error);
               
               
          }
     }
     useEffect(()=>{
          handleGetOrder()
     },[orderId])
  return (
    <div>
     <div className='absolute top-[20px] left-[20px] z-[10] mb-[10px] '>
             <IoIosArrowRoundBack  size={35} className=' text-[#ff4d2d] cursor-pointer ' onClick={()=> navigate("/")} />
           </div>

    </div>
  )
}

export default TrackOrderPage