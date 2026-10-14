import React, { lazy, Suspense } from 'react'
import Nav from './Nav'
import { useSelector } from 'react-redux'
import { FaUtensils } from "react-icons/fa";
import { useNavigate } from 'react-router-dom';
import { FaPen } from "react-icons/fa";
import OwnerItemCard from './OwnerItemCard';
const OwnerAnalytics = lazy(() => import('./OwnerAnalytics'));

function OwnerDashboard() {
  const {myShopData}=useSelector(state=>state.owner)

  
  const navigate=useNavigate()
 
  
  return (
    <div className='w-full min-h-screen bg-background flex flex-col items-center '>
      <Nav/>
      {!myShopData && 
      <div className='flex justify-center items-center p-4 sm:p-6 '>
        <div className='w-full max-w-md bg-surface shadow-lg rounded-2xl p-6 border border-line hover:shadow-xl transition-shadow duration-300 '>
          <div className='flex flex-col items-center text-center'>
            <FaUtensils className='text-brand w-16 h-16 sm:w-20 mb-4 '/>
            <h1 className=' text-xl sm:text-2xl font-bold text-ink mb-2'>Add Your Restaurant</h1>
            <p className='text-muted mb-4 text-sm sm:text-base '>Join our food delivery platform and reach thousands of hungry customers every day.</p>
            <button className='bg-primary text-white px-5 sm:px-6 py-2 rounded-full font-medium shadow-md hover:bg-primary-hover transition-colors duration-200 cursor-pointer ' onClick={()=>navigate("/create-edit-shop")}>
              Get Started
            </button>

          </div>

        </div>
      </div>}
       {myShopData && <div className=' w-full flex flex-col items-center gap-6 px-4 sm:px-6'>
        <h1 className='text-2xl sm:text-3xl text-ink flex items-center gap-3 mt-8 text-center '> <FaUtensils className='text-brand w-14 h-14  '/>Welcome to {myShopData.name} 
        </h1>
        <div className='bg-surface shadow-lg rounded-xl overflow-hidden border border-primary-soft hover:shadow-2xl transition-all duration-300 w-full max-w-3xl relative'>
          <div className='absolute top-4 right-4 bg-primary text-white p-2 rounded-full shadow-md hover:bg-primary-hover transition-colors cursor-pointer '>
            <FaPen size={20} onClick={()=>navigate("/create-edit-shop")} />
            

          </div>
          <img src={myShopData.image} alt={myShopData.name} className='w-full h-48 sm:h-64 object-cover' />
          <div className='p-4 sm:p-6 '>
          <h1 className='text-xl sm:text-2xl font-bold text-ink mb-2  '>{myShopData.name} </h1>
          <p className='text-muted '>{myShopData.city},{myShopData.state} </p>
          <p className='text-muted mb-4'>{myShopData.address} </p>
        </div>
        </div>
        <Suspense fallback={<div className='skeleton h-40 w-full max-w-3xl' />}><OwnerAnalytics /></Suspense>
        {myShopData?.items?.length==0 && 
           <div className='flex justify-center items-center p-4 sm:p-6 '>
        <div className='w-full max-w-md bg-surface shadow-lg rounded-2xl p-6 border border-line hover:shadow-xl transition-shadow duration-300 '>
          <div className='flex flex-col items-center text-center'>
            <FaUtensils className='text-brand w-16 h-16 sm:w-20 mb-4 '/>
            <h1 className=' text-xl sm:text-2xl font-bold text-ink mb-2'>Add Your Food Items.</h1>
            <p className='text-muted mb-4 text-sm sm:text-base '>Share your delicious creations with our coustomers by adding them to the menu.</p>
            <button className='bg-primary text-white px-5 sm:px-6 py-2 rounded-full font-medium shadow-md hover:bg-primary-hover transition-colors duration-200 cursor-pointer ' onClick={()=>navigate("/add-item")}>
              Add Food
            </button>

          </div>

        </div>
      </div>
         }
        
        {myShopData?.items?.length>0 && <div className='flex flex-col items-center gap-4 w-full max-w-3xl '>
          {myShopData.items.map((item,index)=>(
            <OwnerItemCard data={item} key={index} />
          ))}
        </div>
        }

       </div> }
    </div>
  )
}

export default OwnerDashboard