import React, { useEffect } from 'react'
import Nav from './Nav'
import { useSelector } from "react-redux";

function UserDashboard() {

  return (
    <div className='w-full min-h-screen bg-[#fff9f6] flex flex-col items-center '>
     <Nav/>

    </div>
  )
}

export default UserDashboard