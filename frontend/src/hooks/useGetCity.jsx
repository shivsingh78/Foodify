import { reverseGeocode } from '../utils/geo';
import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentAddress, setCurrentCity, setCurrentState } from '../redux/userSlice';
import { setAddress } from '../redux/mapSlice';

function useGetCity() {
     const dispatch=useDispatch()
     const {location}=useSelector(state=>state.map)
  useEffect(()=>{
     if(location.lat == null || location.lon == null) return

     let cancelled = false
     const getCity = async ()=>{
          try {
          const place = await reverseGeocode(location.lat, location.lon)
          if (cancelled || !place) return

          dispatch(setCurrentCity(place.city))
          dispatch(setCurrentState(place.state))
          dispatch(setCurrentAddress(place.addressLine2 || place.addressLine1))

          dispatch(setAddress(place.formatted))
          } catch (error) {
               if (!cancelled) console.error("Unable to get city from location", error)
          }
     }

     getCity()

     return ()=>{
          cancelled = true
     }
  },[location.lat,location.lon,dispatch])
}

export default useGetCity
