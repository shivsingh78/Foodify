import React from 'react'
import { useSelector } from 'react-redux'
import UserDashboard from '../components/UserDashboard'
import OwnerDashboard from '../components/OwnerDashboard'
import DelieveryBoy from '../components/DelieveryBoy'
import { Navigate } from 'react-router-dom'

function Home() {
     const {userData} =useSelector(state=>state.user)
     if(userData.role == "admin") return <Navigate to="/admin/applications" replace />
  return (

    <div className='w-[100vw] min-h-[100vh] pt-[100px] flex felx-col items-center bg-background '>
     
          {userData.role == "user" && <UserDashboard/> }
           {userData.role == "owner" && <OwnerDashboard/> }
            {userData.role == "deliveryBoy" && <DelieveryBoy/> }
     
     
     

    </div>
  )
}

export default Home