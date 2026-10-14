import axios from 'axios'
import React from 'react'
import { useEffect } from 'react'
import { serverUrl } from '../config'
import { useDispatch, useSelector } from 'react-redux'

import { setMyShopData } from '../redux/ownerSlice'


function useGetMyShop() {
   
     const dispatch = useDispatch()
     const {userData}=useSelector(state=>state.user)
     const isOwner = userData?.role === 'owner'
   
  useEffect(()=>{
     // /shop/get-my is owner-only; customers, riders and admins must not call it (it would 403).
     if(!isOwner) return
       const fetchShop=async ()=>{
     try {
         
          const result=await axios.get(`${serverUrl}/api/shop/get-my`,{withCredentials:true})
         
          dispatch(setMyShopData(result.data))
         
          
     
     } catch (error) {
          console.error("Shop fetch error:", error?.response?.status ?? error);
          
            
     }
}
fetchShop()

  },[isOwner,userData?._id])
}


export default useGetMyShop