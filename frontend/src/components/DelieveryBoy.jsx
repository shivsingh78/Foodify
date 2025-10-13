import React from 'react'
import Nav from './Nav'
import { useSelector } from 'react-redux'
import axios from 'axios'
import { serverUrl } from '../App'
import { useEffect } from 'react'

function DelieveryBoy() {
  const {userData}=useSelector(state=>state.user)

  const getAssignments=async ()=> {
    try {
      const result = await axios.get(`${serverUrl}/api/order/get-assignments`,{withCredentials:true})
      console.log(result.data);
      
    } catch (error) {
      console.log(error);
      
      
    }
  }

  useEffect(()=>{
    getAssignments()
  },[userData])
  return (
    <div className='w-full min-h-screen bg-[#fff9f6] flex flex-col items-center overflow-y-auto '>
      <Nav/>
      <div className="w-full max-w-[800px] flex flex-col gap-5 items-center ">
        <div className="bg-white rounded-2xl shadow-md p-5 flex flex-col justify-start items-center w-[90%] border border-orange-100 text-center gap-2">
          <h1 className="text-xl font-bold text-[#ff4d2d] ">Welcome, {userData.fullName }</h1>
          <p className=' text-[#ff4d2d]'><span className="font-semibold ">Latitude: </span>{userData.location.coordinates[1]}  <span className="font-semibold">Longitude </span>
          {userData.location.coordinates[0]}
          </p>
        </div>

      </div>

    </div>
  )
}

export default DelieveryBoy