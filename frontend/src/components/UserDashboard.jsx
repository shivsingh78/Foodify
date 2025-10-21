import React, { useEffect, useRef, useState } from 'react'
import Nav from './Nav'
import { useSelector } from "react-redux";
import { categories } from '../category';
import CategoryCard from './CategoryCard';
import { FaCircleChevronLeft , FaCircleChevronRight } from "react-icons/fa6";
import FoodCard from './FoodCard';
import { useNavigate } from 'react-router-dom';

function UserDashboard() {
  const {currentCity,shopInMyCity,itemsInMyCity}=useSelector(state => state.user)
  const cateScrollRef=useRef()
  const shopScrollRef=useRef()
  const [showLeftCateButton,setShowLeftCateButton]=useState(false)
  const [showRightCateButton,setShowRightCateButton]=useState(false)
  const [showLeftShopButton,setShowLeftShopButton]=useState(false)
  const [showRightShopButton,setShowRightShopButton]=useState(false)
  const [updatedItemsList,setUpdatedItemsList] = useState([])
  const navigate = useNavigate()


const handleFilterByCategory = (category)=> {
  if(category == "ALL"){
    setUpdatedItemsList(itemsInMyCity)
  }else {
    const filteredList = itemsInMyCity.filter(i=>i.category === category)
    setUpdatedItemsList(filteredList)
  }
}

useEffect(()=>{
  setUpdatedItemsList(itemsInMyCity)
},[itemsInMyCity])



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
  const element = cateScrollRef.current ;
  const elementShop = shopScrollRef.current;
  const cateHandler=()=>{
    updateButton(cateScrollRef, setShowLeftCateButton, setShowRightCateButton);
  }
  const shopHandler=()=>{
    updateButton(shopScrollRef,setShowLeftShopButton,setShowRightShopButton)
  }
  if (element) {
element.addEventListener("scroll", cateHandler);
    // Run once initially
    cateHandler();
  }
  if(elementShop){
    elementShop.addEventListener("scroll",shopHandler)
    shopHandler()
  }

   // cleanup BOTH listeners
  return () => {
    if (element) element.removeEventListener("scroll", cateHandler);
    if (elementShop) elementShop.removeEventListener("scroll", shopHandler);
  };
}, []);


  return (
    <div className='w-full min-h-screen bg-[#fff9f6] flex flex-col items-center overflow-y-auto '>
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
          <CategoryCard name={cate.category} image={cate.image} key={index} onClick={()=>handleFilterByCategory(cate.category)} />
          
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
        <div className="w-full relative">
         {/*left button*/}
         {showLeftShopButton && <button className='absolute left-0 top-1/2 -translate-y-1/2 bg-[#ff4d2d] text-white p-2 rounded-full shadow-lg hover:bg-[#e64528] z-10 cursor-pointer'  onClick={()=>scrollHandler(shopScrollRef,"left")} >
         
          <FaCircleChevronLeft/>
      </button> }
         
       <div className='w-full flex overflow-x-auto gap-4 pb-2   ' ref={shopScrollRef}>
         {shopInMyCity?.map((shop,index)=>(
          <CategoryCard name={shop.name} image={shop.image} key={index} onClick={()=>navigate(`/shop/${shop._id}`)} />
          
        )) }
       </div>
       {/*right button*/}
       {showRightShopButton && <button className='absolute right-0 top-1/2 -translate-y-1/2 bg-[#ff4d2d] text-white p-2 rounded-full shadow-lg hover:bg-[#e64528] z-10 cursor-pointer'  onClick={()=>scrollHandler(shopScrollRef,"right")}>
        <FaCircleChevronRight/>
       

       </button>}
      </div>
     </div>

       {/*for Shop Items */}
       <div className='w-full max-w-6xl flex flex-col gap-5 items-start p-[10px] '>
         <h1 className='text-gray-800 text-2xl sm:text-3xl ' > Suggested Food Items </h1>

         <div className='w-full h-auto flex flex-wrap gap-[20px] justify-center  '>
          {updatedItemsList?.map((item,index)=>(
            <FoodCard key={index} data={item}/>
          ))}

          </div>        

       </div>

    </div>
  )
}

export default UserDashboard