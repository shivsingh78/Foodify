
import axios from 'axios'
import { useEffect } from 'react'
import {useDispatch, useSelector} from 'react-redux'
import { serverUrl } from '../App'
import { setLocation } from '../redux/mapSlice'

function useUpdateLocation() {
 const dispatch = useDispatch()
 const {userData} = useSelector(state=>state.user)
  
 useEffect(()=>{
     if(!userData?._id || !navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(async ({coords})=>{
        const lat = coords.latitude;
        const lon = coords.longitude;

      dispatch(setLocation({lat,lon}))

       try {
          await axios.post(`${serverUrl}/api/user/update-location`,{lat,lon},{withCredentials:true})
       } catch (error) {
          console.error("Unable to update location", error)
       }
     },
     (error)=>console.error("Unable to get location", error),
     {enableHighAccuracy:true, maximumAge:0, timeout:10000}
    )

     return ()=> navigator.geolocation.clearWatch(watchId)

 },[userData?._id,dispatch])
}

export default useUpdateLocation
