import React, { useEffect, useState } from 'react'
import { IoIosArrowRoundBack } from "react-icons/io";
import { IoLocationSharp } from "react-icons/io5";
import { MdDeliveryDining } from "react-icons/md";
import { FaMobileScreenButton } from "react-icons/fa6";
import { FaCreditCard } from "react-icons/fa";
import { IoSearchOutline } from "react-icons/io5";
import { TbCurrentLocation } from "react-icons/tb";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import "leaflet/dist/leaflet.css"
import { setAddress, setLocation } from '../redux/mapSlice';
import axios from 'axios';
import { serverUrl } from '../config';
import { addMyOrder } from '../redux/userSlice';
import { getErrorMessage, newIdempotencyKey } from '../utils/api';
import { useRef } from 'react';
import '../utils/leafletIcons';
import { geoErrorMessage, geolocationErrorMessage, MIN_SEARCH_LENGTH, reverseGeocode, searchAddresses } from '../utils/geo';
import { readPublicConfig } from '../runtimeConfig';

function RecenterMap({location}){
  const map=useMap()

  useEffect(()=>{
    if(location.lat != null && location.lon != null){
    map.setView([location.lat,location.lon],17,{animate:true})
    }
  },[location.lat,location.lon,map])

  return null
}

function ClickToSelect({onSelect}){
  useMapEvents({click:(e)=>onSelect(e.latlng.lat,e.latlng.lng)})
  return null
}

function CheckOut() {
 
  const [addressInput,setAddressInput]=useState('')
  const [paymentMethod,setPaymentMethod]= useState('cod')
  const {location,address}=useSelector(state=>state.map)
  const {cartItems,totalAmount}=useSelector(state=>state.user)
  const dispatch=useDispatch()
  const [placing,setPlacing]=useState(false)
  const [error,setError]=useState('')
  const idempotencyKey=useRef(newIdempotencyKey())
  const [suggestions,setSuggestions]=useState([])
  const [searching,setSearching]=useState(false)
  const [searchNotice,setSearchNotice]=useState('')
  const [locating,setLocating]=useState(false)
  const skipNextSearch=useRef(false)

   const deliveryFee = totalAmount>500?0:40

   const amountWithDeliveryFee=totalAmount+deliveryFee;

   const center = location.lat != null && location.lon != null ? [location.lat,location.lon]: [20.5937, 78.9629]; // default India
  

  const selectPoint=async(lat,lon,knownAddress)=>{
    dispatch(setLocation({lat,lon}))
    setSuggestions([])
    setSearchNotice('')
    if(knownAddress){
      dispatch(setAddress(knownAddress))
      return
    }
    try {
      const place = await reverseGeocode(lat,lon)
      if(place?.formatted) dispatch(setAddress(place.formatted))
      else setSearchNotice('No address found for that spot. You can type the address manually.')
    } catch (err) {
      setSearchNotice(geoErrorMessage(err))
    }
  }

  const onDragEnd=(e)=>{
    const {lat,lng}=e.target.getLatLng()
    selectPoint(lat,lng)
  }

  const getCurrentLocation=()=>{
    if (!navigator.geolocation) {
      setSearchNotice('This browser does not support location access. Search for your address instead.')
      return
    }
    setLocating(true)
    setSearchNotice('')
    navigator.geolocation.getCurrentPosition(
      ({coords})=>{
        setLocating(false)
        selectPoint(coords.latitude,coords.longitude)
      },
      (err)=>{
        setLocating(false)
        setSearchNotice(geolocationErrorMessage(err))
      },
      {enableHighAccuracy:true, maximumAge:0, timeout:10000}
    )
  }

  // Debounced, cancellable autocomplete. Nothing is requested below the minimum length.
  useEffect(()=>{
    if(skipNextSearch.current){
      skipNextSearch.current=false
      return
    }
    const text=addressInput.trim()
    if(text.length < MIN_SEARCH_LENGTH){
      setSuggestions([])
      setSearching(false)
      setSearchNotice('')
      return
    }
    const controller=new AbortController()
    const timer=setTimeout(async()=>{
      setSearching(true)
      setSearchNotice('')
      try {
        const places = await searchAddresses(text,controller.signal)
        setSuggestions(places)
        if(places.length===0) setSearchNotice('No matching addresses. Try a different search or tap the map.')
      } catch (err) {
        if(controller.signal.aborted) return
        setSuggestions([])
        setSearchNotice(geoErrorMessage(err))
      } finally {
        if(!controller.signal.aborted) setSearching(false)
      }
    },400)
    return ()=>{
      clearTimeout(timer)
      controller.abort()
    }
  },[addressInput])

  const chooseSuggestion=(place)=>{
    skipNextSearch.current=true
    setAddressInput(place.formatted)
    selectPoint(place.latitude,place.longitude,place.formatted)
  }

  const handlePlaceOrder = async () => {
    if (placing) return
    if (!addressInput || location.lat == null || location.lon == null) {
      return setError('Choose a delivery location on the map first.')
    }
    setError('')
    setPlacing(true)
    try {
      // The server prices the order; only ids and quantities are sent. The key makes retries safe.
      const result = await axios.post(`${serverUrl}/api/order/place-order`,{
        paymentMethod,
        deliveryAddress:{
          text:addressInput,
          latitude:location.lat,
          longitude:location.lon,
        },
        cartItems: cartItems.map(({id,quantity})=>({id,quantity})),
        idempotencyKey: idempotencyKey.current,
      },{withCredentials:true})

      //check payment method
      if(paymentMethod === "cod"){
        dispatch(addMyOrder(result.data))
      navigate("/order-placed")

      } else{
        const orderId=result.data.orderId
        const razorOrder=result.data.razorOrder

        openRazorpayWindow(orderId,razorOrder)
      }

    } catch (error) {
      setError(getErrorMessage(error))
      // A failed attempt may be retried as a new submission.
      idempotencyKey.current = newIdempotencyKey()
    } finally {
      setPlacing(false)
    }
  }

  const openRazorpayWindow=(orderId,razorOrder)=>{ 
    const options={
      key:readPublicConfig().VITE_RAZORPAY_KEY_ID,
      amount:razorOrder.amount,
      currency:"INR",
      name:"Foodify",
      description:"Food Delivery Website",
      order_id:razorOrder.id,
      handler:async function (response) {
        try {
          const result = await axios.post(`${serverUrl}/api/order/verify-payment`,{
            razorpay_payment_id:response.razorpay_payment_id,
            razorpay_order_id:response.razorpay_order_id,
            razorpay_signature:response.razorpay_signature,
            orderId
          },{withCredentials:true})
         
          dispatch(addMyOrder(result.data))
          navigate("/order-placed")
          
          
        } catch (error) {
          setError(getErrorMessage(error, 'Payment could not be verified. If money was deducted, contact support with your order id.'))
        }
        
      }
    }    
    const raz=new window.Razorpay(options)  
    raz.open()                                

  }



  useEffect(()=>{
    setAddressInput(address)

  },[address])
  

  

  const navigate=useNavigate()
  return (
    
    <div className='min-h-screen bg-background flex items-center justify-center p-6 '>
       <div className='absolute top-[20px] left-[20px]  z-[10]  ' onClick={()=> navigate("/cart")}>
        <IoIosArrowRoundBack  size={35} className=' text-primary cursor-pointer '  />
      </div>
      <div className='w-full max-w-[900px] bg-white rounded-2xl shadow-xl p-6 space-y-6 '>
        <h1 className='text-2xl font-bold text-ink '>Checkout</h1>
        {/*section for map */}
        <section>
          <h2 className='text-lg font-semibold mb-2 flex items-center gap-2 text-ink '>< IoLocationSharp className='text-primary  ' /> Delivery Location</h2>
          <div className='relative mb-3'>
            <div className='flex gap-2'>
              <input type="text" role="combobox" aria-expanded={suggestions.length>0} aria-controls="address-suggestions" aria-label="Delivery address" autoComplete="off" className='flex-1 border border-line rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ' placeholder='Search your delivery address…' value={addressInput}  onChange={(e)=>setAddressInput(e.target.value)} />
              <button type="button" className='bg-info hover:bg-info/90 text-white px-3 py-2 rounded-lg flex items-center justify-center cursor-pointer ' onClick={getCurrentLocation} disabled={locating} aria-label="Use my current location" title="Use my current location">
                <TbCurrentLocation size={17} />
              </button>
            </div>
            {searching && <p className='mt-1 text-xs text-muted' role="status">Searching…</p>}
            {searchNotice && <p className='mt-1 text-xs text-muted' role="status">{searchNotice}</p>}
            {suggestions.length>0 && (
              <ul id="address-suggestions" role="listbox" className='absolute z-[1000] mt-1 w-full max-h-60 overflow-auto rounded-lg border border-line bg-white shadow-lg'>
                {suggestions.map((place,i)=>(
                  <li key={`${place.latitude},${place.longitude},${i}`} role="option">
                    <button type="button" className='block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-muted' onClick={()=>chooseSuggestion(place)}>
                      {place.formatted}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className='rounded-xl border overflow-hidden '>
            <div className="h-64 w-full flex items-center justify-center ">

              <MapContainer className={"w-full h-full"} center={center} zoom={17} 
               >
                <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    <RecenterMap location={location}/>
    <ClickToSelect onSelect={(lat,lon)=>selectPoint(lat,lon)} />
    {location.lat != null && location.lon != null && (
      <Marker position={[location.lat,location.lon]} draggable eventHandlers={{dragend:onDragEnd}}>
        <Popup>
         {address}
        </Popup>
      </Marker>
    )}

              </MapContainer>
            </div>

          </div>
          {location.lat != null && location.lon != null ? (
            <p className='mt-2 text-xs text-muted' data-testid="selected-location">
              Selected: {address || 'Looking up address…'} · {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
            </p>
          ) : (
            <p className='mt-2 text-xs text-muted'>No location selected yet. Search above, tap the map or use your current location.</p>
          )}
        </section>
         {/*section for payment method */}

        <section>
                <h2 className='text-lg font-semibold mb-3 text-ink '>Payment Method</h2> 
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-4 '>
                  <div className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${paymentMethod === "cod" ? "border-primary bg-primary-soft shadow " : "border-line hover:border-line"}` }  onClick={()=>setPaymentMethod("cod")}>
                    <span className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-success-soft '>
                      <MdDeliveryDining className='text-success text-xl '/>
                    </span>
                    <div>
                      <p className='font-medium text-ink  '>Cash On Delivery</p>
                      <p className='text-xs text-muted  '>Pay when your food arrives</p>
                    </div>
                    
                  </div>
                   <div className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${paymentMethod === "online" ? "border-primary bg-primary-soft shadow " : "border-line hover:border-line"}`}  onClick={()=>setPaymentMethod("online")}>
                   <span className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted'>
                    < FaMobileScreenButton className='text-brand-brown text-lg '/>
                    </span>
                    <span className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-info-soft '>
                      < FaCreditCard className='text-info text-lg ' />
                    </span>
                    <div>
                      <p className='font-medium text-ink  '>UPI / Credit / Debit Card</p>
                      <p className='text-xs text-muted  '>Pay Securely Online</p>
                    </div>
                    
                  </div>
                </div>      
        </section>

         {/*section for order summary*/}

         <section>
          <h2 className='text-lg font-semibold mb-3 text-ink '>Order Summary</h2> 
          <div className='rounded-xl border bg-surface-muted p-4 space-y-2 '>
          {
            cartItems.map((item,index)=>(
              
              <div className='flex justify-between text-sm text-ink ' key={index}>
                <span>{item.name} x {item.quantity} </span>
                <span>
                  ₹{item.price*item.quantity}
                </span>

              </div>
            ))
          }
          <hr className='border-line my-2 ' />
          <div className='flex justify-between text-ink font-medium '>
            <span>Subtotal</span>
            <span> ₹{totalAmount} </span>
            </div>
            <div className='flex justify-between text-ink '>
            <span>Delivery Fee</span>
            <span>{deliveryFee==0?"Free":" ₹"+ deliveryFee} </span>
            </div>
            <div className='flex justify-between text-lg font-bold text-primary '>
            <span>Total</span>
            <span>{`₹ ${amountWithDeliveryFee}`} </span>
            </div>

         </div>

         </section>
         {error && <p role="alert" className="alert-error">{error}</p>}
         <button className="btn-primary w-full py-3" onClick={handlePlaceOrder} disabled={placing || cartItems.length === 0}>
           {placing ? "Processing…" : paymentMethod==="cod" ? "Place Order" :"Pay & Place Order"}
         </button>
         <p className="text-center text-xs text-muted">The final amount is confirmed by the server using current menu prices.</p>
         
      </div>
      
    </div>
   
  )
}

export default CheckOut
