import React from 'react'
import { FaCircleCheck } from "react-icons/fa6";
import { useNavigate } from 'react-router-dom';

function OrderPlaced() {
  const navigate=useNavigate()
  return (
    <div className='min-h-screen bg-background flex flex-col justify-center items-center px-4 text-center relative overflow-hidden '>
      <FaCircleCheck className='text-success text-6xl mb-4 ' />
      <h1 className='text-3xl font-bold text-ink mb-2  '>Order Placed!</h1>
      <p className='text-muted max-w-md mb-6 '>
        Thank you for your purchase. Your order is being prepared. You can track your order status in the "My Orders " section.
      </p>
      <button className='bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg text-lg font-medium transition cursor-pointer' onClick={()=>navigate("/my-orders")}>Back to my orders</button>
      


    </div>
  )
}

export default OrderPlaced