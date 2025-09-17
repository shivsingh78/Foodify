import axios from 'axios'
import React from 'react'
import { useEffect } from 'react'
import { serverUrl } from '../App'

function useGetCurrentUser() {
   
  useEffect(()=>{
       const fetchUser=async ()=>{
     try {
          
          const result=await axios.get(`${serverUrl}/api/user/current`,{withCredentials:true})
          console.log(result);
          
     
     } catch (error) {
          console.log(error);
          
          
     }
}
fetchUser()

  },[])
}


export default useGetCurrentUser