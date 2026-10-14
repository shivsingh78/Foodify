import axios from 'axios'
import React from 'react'
import { useEffect } from 'react'
import { serverUrl } from '../config'
import { useDispatch, useSelector } from 'react-redux'
import { setShopsInMyCity } from '../redux/userSlice'

function useGetShopByCity() {
     const dispatch = useDispatch()
     const {currentCity}=useSelector(state=>state.user)
   
  useEffect(()=>{
     // The city is unknown until location detection finishes; never request /null.
     if(!currentCity) return
       const fetchShops=async ()=>{
     try {
          
          const result=await axios.get(`${serverUrl}/api/shop/get-by-city/${encodeURIComponent(currentCity)}`,{withCredentials:true})
          dispatch(setShopsInMyCity(result.data))
          
          
          
     
     } catch (error) {
          console.log(error);
          
          
     }
}
fetchShops()

  },[currentCity])
}


export default useGetShopByCity