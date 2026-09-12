import React from 'react'
import { useSelector } from 'react-redux'
import UserDashboard from '../components/UserDashboard'
import OwnerDashboard from '../components/OwnerDashboard'
import DelieveryBoy from '../components/DelieveryBoy'

function Home() {
     const {userData} =useSelector(state=>state.user)
  return (

    <div className='w-[100vw] min-h-[100vh] pt-[100px] flex felx-col items-center bg-[#fff9f6] '>
     
          {userData.role == "user" && <UserDashboard/> }
           {userData.role == "owner" && <OwnerDashboard/> }
            {userData.role == "deliveryBoy" && <DelieveryBoy/> }
     
     
     

    </div>
  )
}

export default Home