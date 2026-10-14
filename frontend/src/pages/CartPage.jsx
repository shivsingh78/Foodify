import React from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import CartItemCard from '../components/CartItemCard';


function CartPage() {
     const navigate=useNavigate()
     const {cartItems,totalAmount}=useSelector(state=>state.user)
  return (
    <div className='min-h-screen bg-background flex justify-center p-6 '>
     <div className='w-full max-w-[800px] '>
          <div className='flex items-center gap-[20px] mb-6 '>
               <div className=' z-[10]  '>
                       <IoIosArrowRoundBack  size={35} className=' text-brand cursor-pointer ' onClick={()=> navigate("/")} />
                     </div>
                     <h1 className='text-2xl font-bold text-start  '>Your Cart</h1>

          </div>
          {
               cartItems?.length==0 ?(
                    <div className='text-muted text-lg text-center '>Your Cart is Empty</div>
               ):(
                    <>
                     <div className=' space-y-4'>
                         {cartItems?.map((item,index)=>(
                              <CartItemCard data={item} key={index} />
                         ))}

                    </div>
                    <div className='mt-6 bg-surface p-4 rounded-xl shadow flex justify-between items-center border '>
                         <h1 className='text-lg font-semibold '>Total Amount</h1>
                         <span className='text-xl font-bold text-brand '>₹{totalAmount} </span>

                    </div>
                    <div className='mt-4 flex justify-end '>
                         <button className='bg-primary text-white px-6 py-3 rounded-lg text-lg font-medium hover:bg-primary-hover transition cursor-pointer 'onClick={()=>navigate('/checkout')} >
                             Proceed to CheckOut
                         </button>
                         
                         </div>
                    </>
                   
               )
          }


     </div>

    </div>
  )
}

export default CartPage