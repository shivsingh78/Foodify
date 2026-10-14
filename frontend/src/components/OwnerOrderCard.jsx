import React from 'react'
import { MdPhone } from "react-icons/md";
import { serverUrl } from '../config';
import axios from 'axios';
import { useDispatch } from 'react-redux';
import { updateOrderStatus } from '../redux/userSlice';
import { useState } from 'react';
import { getErrorMessage } from '../utils/api';

// Mirrors the server's state machine; the server remains the authority.
const NEXT_STATUSES = {
  pending: ['preparing', 'cancelled'],
  preparing: ['out of delivery', 'cancelled'],
}
const STATUS_LABELS = { preparing: 'Preparing', 'out of delivery': 'Out of delivery', cancelled: 'Cancel order' }

function OwnerOrderCard({data}) {
  const [availableBoys,setAvailableBoys]=useState([])
  const [error,setError]=useState('')
  const dispatch=useDispatch()
  const handleUpdateStatus=async (orderId,shopId,status) => {
    try {
      setError('')
      const result = await axios.post(`${serverUrl}/api/order/update-status/${orderId}/${shopId}`,{status},{withCredentials:true})
      dispatch(updateOrderStatus({orderId,shopId,status}))
      setAvailableBoys(result.data.availableBoys)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className='bg-white rounded-lg shadow p-4 space-y-4 '>
      <div>
        <h2 className='text-lg font-semibold text-ink '>{data.user.fullName} </h2>
        <p className='text-sm text-muted '>{data.user.email} </p>
        <p className='flex items-center gap-2 text-sm text-muted '><MdPhone /> <span>{data.user.mobile}</span> </p>
        {data.paymentMethod === "online"? (<p className='gap-2 text-sm text-muted '>payment: <span className='text-primary-hover'>{data.payment?"true":"false"}</span> </p> ):(<p >Payment Method: <span className='text-info'>  {data.paymentMethod}</span> </p>)}
        
      </div>

      <div className="flex items-start flex-col gap-2 text-muted ">
        <p>{data?.deliveryAddress?.text }</p>
        <p className="text-xs text-muted ">Lan: {data?.deliveryAddress.latitude}, Lon:  {data?.deliveryAddress.longitude} </p>
      </div>

      <div >
         <div className="flex space-x-4 overflow-auto pb-2 ">
                         {data.shopOrders.shopOrderItems.map((item)=>(
               <div key={item._id ?? item.name} className="flex-shrink-0 w-40 border border-line rounded-lg p-2 bg-white ">
                    <img src={item.item.image} alt={item.name} />
                    <p className='text-sm font-semibold mt-1 '>{item.name} </p>
                    <p className='text-xs text-muted'>{`Qty: ${item.quantity} x ₹ ${item.price}`} </p>

               </div>
            
                         )) }
                    </div>
      </div>

      <div className="flex justify-between items-center mt-auto pt-3 border-t border-line ">
        <span className='text-sm '>status:<span className='font-semibold capitalize text-primary '>  {data.shopOrders.status} </span></span>
        {NEXT_STATUSES[data.shopOrders.status] && (
          <select
            aria-label="Update order status"
            className='input w-auto py-1 text-sm'
            value=""
            onChange={(e)=>e.target.value && handleUpdateStatus(data._id,data.shopOrders.shop._id,e.target.value)}
          >
            <option value="">Update status…</option>
            {NEXT_STATUSES[data.shopOrders.status].map((st)=>(
              <option key={st} value={st}>{STATUS_LABELS[st]}</option>
            ))}
          </select>
        )}
      </div>

      {data.shopOrders.status == "out of delivery" && (
        <div className='mt-3 p-2 border rounded-lg text-sm bg-primary-soft '>
          {data.shopOrders.assignedDeliveryBoy?(<p>Assigned Delivery Boys: </p>):(<p>Available Delivery Boys: </p>)  }
          
          {availableBoys?.length>0?(
            availableBoys.map((b)=>(
              <div key={b.id}>{b.fullName} , {b.mobile} </div>
            ))

          ): data.shopOrders.assignedDeliveryBoy ? (<div>{data.shopOrders.assignedDeliveryBoy.fullName} - {data.shopOrders.assignedDeliveryBoy.mobile} </div> ): (<div> Waiting for delivery boy to accept </div> ) }

        </div>

      )}


      {error && <p role="alert" className="alert-error">{error}</p>}
      <div className="text-right font-bold text-ink text-sm "> Total: ₹{data.shopOrders.subtotal} </div>
      

    </div>
  )
}

export default OwnerOrderCard