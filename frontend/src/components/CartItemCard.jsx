import React from 'react'
import { FaPlus,FaMinus } from "react-icons/fa";
import { CiTrash } from "react-icons/ci";
import { useDispatch } from 'react-redux';
import { removeCartItem, updateQuantity } from '../redux/userSlice';

function CartItemCard({ data }) {
     const dispatch=useDispatch()
     const handleIncrease=(id,currentQty)=>{
          dispatch(updateQuantity({id,quantity:currentQty+1}))

     }
     const handleDecrease=(id,currentQty)=>{
         if(currentQty>1){
           dispatch(updateQuantity({id,quantity:currentQty-1}))

         }
     }
     return (
          <div className='  flex items-center justify-between bg-white p-4 rounded-xl shadow border'>
               {/*left */}
               <div className='flex items-center gap-4 '>
                    <img src={data.image} alt={data.name} className='w-20 h-20 object-cover rounded-lg border ' />
                    <div>
                         <h1 className='font-medium text-gray-800 '>{data.name} </h1>
                         <p className='text-sm text-gray-500 '>₹{data.price} x {data.quantity} </p>
                         <p className='font-bold text-gray-900  '>₹{data.price * data.quantity} </p>

                    </div>
               </div>
               {/*right */}
               <div className='flex items-center gap-4 '>
                    <button className='cursor-pointer p-2 bg-gray-100 rounded-full hover:bg-gray-200 '  onClick={()=>handleDecrease(data.id,data.quantity)}>
                         <FaMinus size={12}  />
                        

                    </button>
                    <span>{data.quantity} </span>
                    <button className='cursor-pointer p-2 bg-gray-100 rounded-full hover:bg-gray-200 '  onClick={()=>handleIncrease(data.id,data.quantity)}>
                         <FaPlus size={12}  />
                    </button>
                     <button className='cursor-pointer p-2 bg-red-100 rounded-full text-red-600 hover:bg-red-200 ' onClick={()=>dispatch(removeCartItem(data.id))}>
                         <CiTrash size={18}  />
                    </button>
                    

               </div>

          </div>
     )
}

export default CartItemCard