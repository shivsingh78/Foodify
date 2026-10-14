import { useSocket, useSocketEvent } from '../utils/socket'
import { makeReadyForPickupHandler, makeResyncHandler, startLocationHeartbeat } from '../utils/partnerEvents'
import React from 'react'
import Nav from './Nav'
import { useSelector } from 'react-redux'
import axios from 'axios'
import { serverUrl } from '../config'
import { useEffect } from 'react'
import { useState } from 'react'
import DeliveryBoyTracking from './DeliveryBoyTracking'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ClipLoader from 'react-spinners/ClipLoader'


function DelieveryBoy() {
  const {userData}=useSelector(state=>state.user)
  const socket=useSocket()
  const [availableAssignments,setAvailableAssignments]=useState(null)
  const [currentOrder,setCurrentOrder]=useState()
  const [showOtpBox,setShowOtpBox]=useState(false)
  const [otp,setOtp]=useState("")
  const [deliveryBoyLocation,setDeliveryBoyLocation] =useState(null)
  const [todayDeliveries,setTodayDeliveries]=useState([])
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')
  const [pickupAlert,setPickupAlert]=useState('')
 
  


  const getAssignments=async ()=> {
    try {
      const result = await axios.get(`${serverUrl}/api/order/get-assignments`,{withCredentials:true})
      
      
      
     setAvailableAssignments(result.data)
     
     
      
    } catch (error) {
      console.log(error);
      
      
    }
  }

  const getCurrentOrder = async () => {
    try {
      const result = await axios.get(`${serverUrl}/api/order/get-current-order`,{withCredentials:true})
   
      
      setCurrentOrder(result.data)
  
      
      
      
    } catch (error) {
     if (error.response && error.response.status === 404) {
      // No current order — this is normal
      setCurrentOrder(null);
      return;
    }'console.error("Unexpected error fetching current order:", error);'
      
    }
  }
  


  const acceptOrder = async (assignmentId) => {
    try {
      await axios.post(`${serverUrl}/api/order/accept-order/${assignmentId}`,{},{withCredentials:true})
      await getCurrentOrder()
      
    } catch (error) {
      // Offer expired or was taken: the server decides; reload the real list.
      console.log(error)
      await getAssignments()
    }
    
  }

  const declineOrder = async (offerId) => {
    try {
      await axios.post(`${serverUrl}/api/order/decline-offer/${offerId}`,{},{withCredentials:true})
    } catch (error) {
      console.log(error)
    }
    setAvailableAssignments(prev=>(prev ?? []).filter(a=>a.offerId!==offerId))
  }

  const sendOtp = async ()=> {
    setLoading(true)

    try{
      const result = await axios.post(`${serverUrl}/api/order/send-delivery-otp`,{orderId:currentOrder._id ,shopOrderId:currentOrder.shopOrder._id},{withCredentials:true})
      setLoading(false)
       setShowOtpBox(true)
      console.log(result.data);                    

      

    } catch(error){
      setLoading(false)
      console.log(error)
    }

  }

  const verifyOtp = async () => {
    setMessage("")
    try {
      const result = await axios.post(`${serverUrl}/api/order/verify-delivery-otp`,{orderId:currentOrder._id,shopOrderId:currentOrder.shopOrder._id,otp},{withCredentials:true})
      console.log(result.data);
      setMessage(result.data.message)
      location.reload()
      
      
    } catch (error) {
      console.log(error);
      
      
    }
    
  }
  const handleTodayDeliveries = async () => {
    try {
      const result = await axios.get(`${serverUrl}/api/order/get-today-deliveries`,{withCredentials:true})
      
      setTodayDeliveries(result.data)
      
    } catch (error) {
      console.log(error);
     
      
    }
  }

  const ratePerDelivery = 50
  const totalEarning = todayDeliveries.reduce((sum,d)=> sum + d.count*ratePerDelivery,0)





  
  useEffect(()=>{
    if(!socket || userData.role !== "deliveryBoy" || !navigator.geolocation) return
    const heartbeat=startLocationHeartbeat({emit:(p)=>socket.emit('updateLocation',p)})
    const watchId=navigator.geolocation.watchPosition(
      (position)=>{
        const latitude = position.coords.latitude
        const longitude = position.coords.longitude
        setDeliveryBoyLocation({lat:latitude,lon:longitude})
        heartbeat.update({latitude,longitude})
      },
      (error)=>console.error('Unable to read location',error),
      {enableHighAccuracy:true}
    )
    return ()=> {
      navigator.geolocation.clearWatch(watchId)
      heartbeat.stop()
    }
  },[socket])

  
  

  useSocketEvent('newAssignment',(data)=>{
    if(data.sentTo == userData._id){
      setAvailableAssignments(prev=>[...(prev ?? []).filter(a=>a.offerId!==data.offerId),data])
    }
  })
  // The server is the source of truth for expiry; the UI only reflects what it is told.
  useSocketEvent('offerExpired',({offerId})=>{
    setAvailableAssignments(prev=>(prev ?? []).filter(a=>a.offerId!==offerId))
  })
  useSocketEvent('assignmentCancelled',()=>{
    getCurrentOrder()
  })
  // The restaurant marked the accepted order out for delivery: show it now and reload the authoritative state.
  useSocketEvent('deliveryReadyForPickup',(payload)=>{
    makeReadyForPickupHandler({refreshCurrentOrder:getCurrentOrder,refreshAssignments:getAssignments,setAlert:setPickupAlert})(payload)
  })
  // Events are not replayed after a reconnect, so reload everything from the API.
  useEffect(()=>{
    const resync=makeResyncHandler({refreshCurrentOrder:getCurrentOrder,refreshAssignments:getAssignments,refreshToday:handleTodayDeliveries})
    window.addEventListener('foodify:resync',resync)
    return ()=>window.removeEventListener('foodify:resync',resync)
  },[])




  useEffect(()=>{
    getAssignments()
    getCurrentOrder()
    handleTodayDeliveries()
    
  },[userData])
  return (
    <div className='w-full min-h-screen bg-background flex flex-col items-center overflow-y-auto '>
      <Nav/>
      <div className="w-full max-w-[800px] flex flex-col gap-5 items-center ">
        {pickupAlert && !!currentOrder && <p role="status" className="w-[90%] rounded-xl bg-primary-soft p-3 text-center text-sm font-semibold text-primary">{pickupAlert}</p>}
        <div className="bg-white rounded-2xl shadow-md p-5 flex flex-col justify-start items-center w-[90%] border border-primary-soft text-center gap-2">
          <h1 className="text-xl font-bold text-primary ">Welcome, {userData.fullName }</h1>
          <p className=' text-ink'><span className="font-semibold text-primary ">Latitude: </span>{deliveryBoyLocation?.lat }  <span className="font-semibold text-primary">Longitude </span>
          {deliveryBoyLocation?.lon}
          </p>
        </div>

       

        <div className="bg-white rounded-2xl shadow-md p-5 w-[90%] mb-6 border border-primary-soft  ">
          <h1 className="text-lg font-bold mb-3 text-primary  ">Today Deliveries</h1>
          <ResponsiveContainer width="100%" height={200} >
            <BarChart data={todayDeliveries} >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tickFormatter={(h)=>`${h}:00`} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(value=>[value,"orders"])} labelFormatter={label=>`${label}:00`} />
                  <Bar dataKey="count" fill='var(--color-primary)' />

            </BarChart>

          </ResponsiveContainer>

          <div className="max-w-sm mx-auto mt-6 p-6 bg-white rounded-2xl shadow-lg text-center ">
            <h1 className="text-xl font-semibold text-ink mb-2  ">Today's Earning </h1>
            <span className="text-3xl font-bold text-success  ">₹{totalEarning} </span>
          </div>
          

        </div>

       {!currentOrder &&  <div className="bg-white rounded-2xl p-5 shadow-md w-[90%] border  border-primary-soft">
          <h1 className="text-lg font-bold mb-4 flex items-center gap-2 ">Available Orders </h1>

          <div className='space-y-4 '>
            {availableAssignments?.length > 0 ?(
              availableAssignments?.map((a,index)=>(
                <div className='border rounded-lg p-4 flex justify-between items-center  ' key={index}>
                  <div>
                    <p className='text-sm font-semibold'>{a?.shopName} </p>
                    <p className='text-sm text-muted '><span className='font-semibold '>Delivery Address: </span>{a?.deliveryAddress.text} </p>
                    <p className='text-xs text-muted '>{a.items.length} items | ₹{a.subtotal} </p>
                  </div>
                  <div className='flex flex-col gap-2 items-end'>
                  <button className='bg-primary text-white px-4 py-1 rounded-lg text-sm hover:bg-primary-hover cursor-pointer '  onClick={()=>acceptOrder(a.assignmentId)} >
                    Accept
                    </button>
                  <button className='border border-line text-muted px-4 py-1 rounded-lg text-sm hover:bg-surface-muted cursor-pointer ' onClick={()=>declineOrder(a.offerId)}>
                    Decline
                  </button>
                  {a.expiresAt && <span className='text-xs text-muted'>Offer valid until {new Date(a.expiresAt).toLocaleTimeString()}</span>}
                  </div>
                   
                </div>

              )) 
               ):( <p className='text-muted text-sm '>No Available Orders </p> ) }

          </div>
        </div>}

        {currentOrder && 
        <div className='bg-white rounded-2xl p-5 shadow-md w-[90%] border border-primary-soft '>
          <h2 className='text-lg font-bold mb-3 '> 📦 Current Order </h2>
          <div className='border rounded-lg p-4 mb-3 '>
            <p className="font-semibold text-sm ">{currentOrder?.shopOrder.shop.name } </p>
            <p className="text-sm text-muted">{currentOrder?.deliveryAddress.text } </p>
            <p className="text-xs text-muted">{currentOrder?.shopOrder.shopOrderItems.length } items | ₹{currentOrder.shopOrder.subtotal} </p>
          </div>
          <DeliveryBoyTracking data={
            {
              deliveryBoyLocation: deliveryBoyLocation || {
                lat: userData.location.coordinates[1],
                 lon: userData.location.coordinates[0]
              },
              customerLocation: {
                 lat:currentOrder.deliveryAddress.latitude,
                  lon:currentOrder.deliveryAddress.longitude

              }
             
            }
          }/>

          {!showOtpBox ? (<button className='mt-4 w-full bg-success text-white font-semibold py-2 px-4 rounded-xl shadow-md hover:bg-success/90 active:scale-95 transition-all duration-200 cursor-pointer' onClick={sendOtp} disabled={loading}>
           {loading ? <ClipLoader size={20} color='white' /> : "Mark As Delivered"}
          </button>)
          :
          (<div className='t-4 p-4 border rounded-xl bg-surface-muted '>
            <p className='text-sm font-semibold mb-2 '>Enter Otp send to <span className='text-primary '>{currentOrder.user.fullName}</span> </p>
            <input type="text" className='w-full  border px-3 py-2 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-orange-400 ' placeholder='Enter OTP'  onChange={(e)=>setOtp(e.target.value)} value={otp}/>

            {message && <p className='text-center text-success ' >{message} </p> }
           
            <button className='w-full bg-primary text-white py-2 rounded-lg font-semibold hover:bg-primary-hover transition-all cursor-pointer' onClick={verifyOtp}>Submit OTP </button>
            

          </div> )}

          </div>}


      </div>

    </div>
  )
}

export default DelieveryBoy