import React, { useEffect } from 'react'
import Nav from './Nav'
import { useSelector } from "react-redux";
import { categories } from '../category';
import CategoryCard from './CategoryCard';

function UserDashboard() {

  return (
    <div className='w-full min-h-screen bg-[#fff9f6] flex flex-col items-center '>
     <Nav/>
     <div className='w-full max-w-6xl flex flex-col gap-5 items-start p-[10px]  '>
      <h1 className='text-gray-800 text-2xl sm:text-3xl ' >Inspiration for your first order</h1>
      <div className="w-full ">
        {categories.map((cate,index)=>(
          <CategoryCard data={cate} key={index} />
        )) }
      </div>
     </div>

    </div>
  )
}

export default UserDashboard