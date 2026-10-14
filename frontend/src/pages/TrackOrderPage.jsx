import axios from 'axios'
import { useSocketEvent } from '../utils/socket'
import React, { useEffect, useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { useNavigate, useParams } from 'react-router-dom'
import { serverUrl } from '../config'
import DeliveryBoyTracking from '../components/DeliveryBoyTracking';

function TrackOrderPage() {
     const {orderId}=useParams()
     const [currentOrder,setCurrentOrder]=useState()
     const navigate = useNavigate()
     const [liveLocations,setLiveLocations]=useState({})


     const handleGetOrder = async () => {
          try {
               const result = await axios.get(`${serverUrl}/api/order/get-order-by-id/${orderId}`,{withCredentials:true})
               setCurrentOrder(result.data)
               
          } catch (error) {
               console.log(error);
               
               
          }
     }
     useSocketEvent('updateDeliveryLocation',({deliveryBoyId,latitude,longitude})=>{
          setLiveLocations(prev => ({
               ...prev,[deliveryBoyId]:{lat:latitude,lon:longitude}
          }))
     })


     // Realtime events only say "something changed"; the API is the authoritative state.
     useSocketEvent('etaUpdated',()=>{ handleGetOrder() })
     useSocketEvent('update-status',()=>{ handleGetOrder() })

     useEffect(()=>{
          handleGetOrder()
          window.addEventListener('foodify:resync',handleGetOrder)
          return () => window.removeEventListener('foodify:resync',handleGetOrder)
     },[orderId])
  return (
    <div className='max-w-4xl mx-auto p-4 flex flex-col gap-6 '>
     <div className='relative flex items-center gap-4 top-[20px] left-[20px] z-[10] mb-[10px] '>
             <IoIosArrowRoundBack  size={35} className=' text-brand cursor-pointer ' onClick={()=> navigate("/my-orders")} />
               <h1 className="text-2xl font-bold md:text-center ">Track Order </h1>
           </div>

           {currentOrder?.shopOrders?.map((shopOrder,index)=>(
               <div className="bg-surface p-4 rounded-2xl shadow-md border border-line space-y-4 " key={index}>
                    <div >
                         <p className="text-lg font-bold mb-2 text-brand  ">
                              {shopOrder.shop.name}
                         </p>
                         <p >
                              <span className="font-semibold ">Items : </span>         
                              {shopOrder.shopOrderItems?.map(i=>i.name).join(",")}
                         </p>
                         <p ><span className='font-semibold '>Subtotal : </span>₹{shopOrder.subtotal} </p>
                         <p className="mt-6"><span className=" font-semibold">Delivery address : </span>          
                             {currentOrder.deliveryAddress?.text} </p>
                    </div>
                    {shopOrder.status !== "delivered"? <>
                  
                    {shopOrder.assignedDeliveryBoy? (<div className='text-sm text-ink '>
                         <p >
                              <span className="font-semibold">Delivery Boy Name : </span>{shopOrder.assignedDeliveryBoy.fullName} </p>
                         <p >
                               <span className="font-semibold">Delivery Boy Contact No. : </span>
                              {shopOrder.assignedDeliveryBoy.mobile}
                         </p>


                    </div>):(<p className='font-semibold'>Delivery Boy is not assigned yet.</p>)}

                    {shopOrder.eta?.deliveryAt && (
                         <p className='text-sm text-muted'>Estimated arrival: about {new Date(shopOrder.eta.deliveryAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} (approximate)</p>
                    )}
                    </>: <p className='text-success font-semibold text-lg '>Delivered</p>}
                    {(shopOrder.assignedDeliveryBoy && shopOrder.status !== "delivered") &&
                    (<div className="h-[400px] w-full rounded-2xl overflow-hidden shadow-md  ">
               <DeliveryBoyTracking data={{

           deliveryBoyLocation:liveLocations[shopOrder.assignedDeliveryBoy._id] || {
          lat:shopOrder.assignedDeliveryBoy.location.coordinates[1],
          
          lon:shopOrder.assignedDeliveryBoy.location.coordinates[0]
     },
               customerLocation:{
               lat:currentOrder.deliveryAddress.latitude,
               lon:currentOrder.deliveryAddress.longitude
          }
                    }} />
                    </div>) }
               </div>
           ))}

    </div>
  )
}

export default TrackOrderPage