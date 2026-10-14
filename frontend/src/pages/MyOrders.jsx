import { useSocketEvent } from '../utils/socket'
import React from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useSelector,useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import UserOrderCard from '../components/UserOrderCard';
import OwnerOrderCard from '../components/OwnerOrderCard';
import {setMyOrders,updateRealtimeOrderStatus} from '../redux/userSlice'
import axios from 'axios'
import { serverUrl } from '../config'
import { makeOrdersRefetch } from '../utils/partnerEvents'



function MyOrders() {
     const {userData,myOrders}=useSelector(state=>state.user)
     const navigate=useNavigate()
     const dispatch=useDispatch()

     useSocketEvent('newOrder',(data)=>{
          if(data.shopOrders?.owner._id == userData._id){
               dispatch(setMyOrders([data,...myOrders]))
          }
     })
     // A delivery partner accepted (or dispatch gave up): reload so the order card shows the real assignment.
     const refetchOrders=makeOrdersRefetch({fetchOrders:async()=>(await axios.get(`${serverUrl}/api/order/my-orders`,{withCredentials:true})).data,setOrders:(orders)=>dispatch(setMyOrders(orders))})
     useSocketEvent('deliveryAssigned',()=>{ refetchOrders() })
     useSocketEvent('dispatchExhausted',()=>{ refetchOrders() })
     useSocketEvent('update-status',({orderId,shopId,status,userId})=>{
          if(userId === userData._id){
               dispatch(updateRealtimeOrderStatus({orderId,shopId,status}))
          }
     })


  return (
    <div className=' w-full min-h-screen bg-background flex justify-center px-4  '>
     <div className="w-full max-w-[800px] p-4 ">
          <div className='flex items-center gap-[20px] mb-6 '>
                         <div className=' z-[10]  '>
        <IoIosArrowRoundBack  size={35} className=' text-brand cursor-pointer ' onClick={()=> navigate("/")} />
      </div>
      <h1 className='text-2xl font-bold text-start  '>My orders</h1>
          
                    </div>
                    <div className="space-y-6 ">
                         {
                              myOrders?.map((order,index)=>(
          userData.role==="user"?(
               <UserOrderCard data={order} key={index} />
          ):
          userData.role === "owner" ? (
               <OwnerOrderCard data={order} key={index} />
          ):null
                              ))
                         }
                    </div>
     </div>

    </div>
  )
}

export default MyOrders