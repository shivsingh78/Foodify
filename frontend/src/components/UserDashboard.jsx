import React, { useEffect, useRef, useState } from 'react'
import Nav from './Nav'
import { useSelector } from "react-redux";
import { categories } from '../category';
import CategoryCard from './CategoryCard';
import { FaCircleChevronLeft , FaCircleChevronRight } from "react-icons/fa6";

function UserDashboard() {
  const {currentCity}=useSelector(state=>state.user)
  const cateScrollRef=useRef()
  const [showLeftCateButton,setShowLeftCateButton]=useState(false)
  const [showRightCateButton,setShowRightCateButton]=useState(false)

  const updateButton=(ref,setLeftButton,setRightButton)=>{
const element = ref.current;
if(element){
  setLeftButton(element.scrollLeft>0)
   setRightButton(element.scrollLeft + element.clientWidth < element.scrollWidth)
  
}
  }

  const scrollHandler = (ref,direction)=>{
    if(ref.current){
      ref.current.scrollBy({
        left:direction=="left"?-200:200,
        behavior:"smooth"
      })
    }
  }

  useEffect(() => {
  const element = cateScrollRef.current;
  if (element) {
    const handler = () => updateButton(cateScrollRef, setShowLeftCateButton, setShowRightCateButton);

    element.addEventListener("scroll", handler);

    // Run once initially
    handler();

    return () => element.removeEventListener("scroll", handler);
  }
}, []);


  return (
    <div className='w-full min-h-screen bg-[#fff9f6] flex flex-col items-center '>
     <Nav/>
      {/*for category*/}
     <div className='w-full max-w-6xl flex flex-col gap-5 items-start p-[10px]  '>
      <h1 className='text-gray-800 text-2xl sm:text-3xl ' >Inspiration for your first order</h1>
      <div className="w-full relative">
         {/*left button*/}
         {showLeftCateButton && <button className='absolute left-0 top-1/2 -translate-y-1/2 bg-[#ff4d2d] text-white p-2 rounded-full shadow-lg hover:bg-[#e64528] z-10 cursor-pointer'  onClick={()=>scrollHandler(cateScrollRef,"left")} >
         
          <FaCircleChevronLeft/>
      </button> }
         
       <div className='w-full flex overflow-x-auto gap-4 pb-2   ' ref={cateScrollRef}>
         {categories.map((cate,index)=>(
          <CategoryCard data={cate} key={index} />
        )) }
       </div>
       {/*right button*/}
       {showRightCateButton && <button className='absolute right-0 top-1/2 -translate-y-1/2 bg-[#ff4d2d] text-white p-2 rounded-full shadow-lg hover:bg-[#e64528] z-10 cursor-pointer'  onClick={()=>scrollHandler(cateScrollRef,"right")}>
        <FaCircleChevronRight/>
       

       </button>}
      </div>
      
     </div>
      {/*for Shop */}
     <div className='w-full max-w-6xl flex flex-col gap-5 items-start p-[10px] '>
       <h1 className='text-gray-800 text-2xl sm:text-3xl ' > Best Shop in {currentCity} </h1>
     </div>

    </div>
  )
}

export default UserDashboard