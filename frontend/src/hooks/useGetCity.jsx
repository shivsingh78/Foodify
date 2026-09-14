import axios from 'axios';
import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentAddress, setCurrentCity, setCurrentState } from '../redux/userSlice';
import { setAddress } from '../redux/mapSlice';

function useGetCity() {
     const dispatch=useDispatch()
     const apiKey=import.meta.env.VITE_GEOAPIKEY
     const {location}=useSelector(state=>state.map)
  useEffect(()=>{
     if(location.lat == null || location.lon == null) return

     let cancelled = false
     const getCity = async ()=>{
          try {
          const result = await axios.get(`https://api.geoapify.com/v1/geocode/reverse?lat=${location.lat}&lon=${location.lon}&format=json&apiKey=${apiKey}`)
          if (cancelled) return
          
          dispatch(setCurrentCity(result?.data.results[0].city))
          dispatch(setCurrentState(result?.data.results[0].state))
          dispatch(setCurrentAddress(result?.data.results[0].address_line2 || result?.data.results[0].address_line1 ))
          
          dispatch(setAddress(result?.data.results[0].formatted || result?.data.results[0].address_line2 ))
          } catch (error) {
               if (!cancelled) console.error("Unable to get city from location", error)
          }
     }

     getCity()

     return ()=>{
          cancelled = true
     }
  },[location.lat,location.lon,apiKey,dispatch])
}

export default useGetCity
