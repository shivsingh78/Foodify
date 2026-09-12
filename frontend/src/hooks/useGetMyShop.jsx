import axios from 'axios'
import React from 'react'
import { useEffect } from 'react'
import { serverUrl } from '../App'
import { useDispatch, useSelector } from 'react-redux'

import { setMyShopData } from '../redux/ownerSlice'

function useGetMyShop() {
     const dispatch = useDispatch()
     const {userData}=useSelector(state=>state.user)
   
  useEffect(()=>{
       const fetchShop=async ()=>{
     try {
          
          const result=await axios.get(`${serverUrl}/api/shop/get-my`,{withCredentials:true})
         
          dispatch(setMyShopData(result.data))
          
     
     } catch (error) {
          console.log("Shop fetch error:", error);
          
          
     }
}
fetchShop()

  },[userData])
}


export default useGetMyShop