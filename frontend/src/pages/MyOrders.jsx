import React from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import UserOrderCard from '../components/userOrderCard';
import OwnerDashboard from '../components/OwnerDashboard';

function MyOrders() {
     const {userData,myOrders}=useSelector(state=>state.user)
     const navigate=useNavigate()
  return (
    <div className=' w-full min-h-screen bg-[#fff9f6] flex justify-center px-4  '>
     <div className="w-full max-w-[800px] p-4 ">
          <div className='flex items-center gap-[20px] mb-6 '>
                         <div className=' z-[10]  '>
        <IoIosArrowRoundBack  size={35} className=' text-[#ff4d2d] cursor-pointer ' onClick={()=> navigate("/")} />
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
               <OwnerDashboard data={order} key={index} />
          ):null
                              ))
                         }
                    </div>
     </div>

    </div>
  )
}

export default MyOrders