import React, { useState } from 'react'
import { FaLocationDot } from "react-icons/fa6";
import { IoSearchSharp } from "react-icons/io5";
import { FiShoppingCart } from "react-icons/fi";
import { RxCross2 } from "react-icons/rx";
import { useDispatch, useSelector } from "react-redux";
import { serverUrl } from '../App';
import axios from 'axios';
import { setUserData } from '../redux/userSlice';
import { FaPlus } from "react-icons/fa6";
import { TbReceipt2 } from "react-icons/tb";


function Nav() {
     const {userData,city} =useSelector(state=>state.user)
     const {myShopData} =useSelector(state=>state.owner)
     const [showInfo,setShowInfo]=useState(false)
     const [showSearch,setShowSearch] =useState(false)
     const dispatch = useDispatch()
     const handleLogout = async () => {
          try {
               const result = await axios.get(`${serverUrl}/api/auth/signout`,{withCredentials:true})
               dispatch(setUserData(null))
          } catch(error){
               console.log(error);
               
          }
     }
     
  return (
    <div className='w-full h-[80px] flex items-center justify-between md:justify-center gap-[30px] px-[20px] fixed top-0 z-[9999] bg-[#fff9f6] '>
     {showSearch && userData.role=="user" &&  <div className='w-[90%]  h-[70px] bg-white shadow-xl rounded-lg  flex fixed top-[80px] left-[5%] items-center gap-[20px] md:hidden'>
          {/*Left section */}
          <div className='flex items-center w-[30%] overflow-hidden gap-[10px] px-[10px] border-r-[2px] border-gray-400 '>
               < FaLocationDot size={25} className='text-[#ff4d2d]' />
               <div className='w-[80%] truncate text-gray-600 '>{city}</div>

          </div>
          {/*right section */}
          <div className='w-[80%] flex items-center gap-[10px] ' >
               <IoSearchSharp  size={25} className='text-[#ff4d2d]' />
               <input type="text" placeholder='search delicious food...' className='px-[10px] text-gray-700 outline-0 w-full '/>

          </div>
          
     </div>}

     <h1 className='text-3xl font-bold mb-2 text-[#ff4d2d] '>Foodify</h1>
    {userData.role=="user" &&  <div className='md:w-[60%] lg:w-[40%] h-[70px] bg-white shadow-xl rounded-lg hidden md:flex items-center gap-[20px] '>
          {/*Left section */}
          <div className='flex items-center w-[30%] overflow-hidden gap-[10px] px-[10px] border-r-[2px] border-gray-400 '>
               < FaLocationDot size={25} className='text-[#ff4d2d]' />
               <div className='w-[80%] truncate text-gray-600 '>{city}</div>

          </div>
          {/*right section */}
          <div className='w-[80%] flex items-center gap-[10px] ' >
               <IoSearchSharp  size={25} className='text-[#ff4d2d]'  />
               <input type="text" placeholder='search delicious food...' className='px-[10px] text-gray-700 outline-0 w-full '/>

          </div>
          
     </div>}

     <div className='flex items-center gap-4 '>
          {userData.role=="user" && (showSearch ? <RxCross2 size={25}  className='text-[#ff4d2d] md:hidden' onClick={()=>setShowSearch(false)}/> : <IoSearchSharp  size={25} className='text-[#ff4d2d] md:hidden' onClick={()=>setShowSearch(true)} />) }
          

          {userData.role=="owner" ? <>
          {myShopData && <>
          <button className='hidden md:flex items-center gap-1 p-2 cursor-pointer rounded-full bg-[#ff4d2d]/10 text-[#ff4d2d]  '>
               <FaPlus size={20}/>
               <span>Add Food Item</span>
          </button>
          <button className='md:hidden flex items-center  p-2 cursor-pointer rounded-full bg-[#ff4d2d]/10 text-[#ff4d2d]  '>
               <FaPlus size={20}/>
               
          </button>
          </>}
          <div className='hidden md:flex items-center gap-2 cursor-pointer relative px-3 py-1 rounded-lg bg-[#ff4d2d]/10 text-[#ff4d2d] font-medium '>
          <TbReceipt2 size={20}/>
          <span>My Orders</span>
          <span className='absolute -right-2 -top-2 text-xs font-bold text-white bg-[#ff4d2d] rounded-full px-[6px] py-[1px] '>0</span>

          </div>
          <div className='md:hidden flex items-center gap-2 cursor-pointer relative px-3 py-1 rounded-lg bg-[#ff4d2d]/10 text-[#ff4d2d] font-medium '>
          <TbReceipt2 size={20}/>
       
          <span className='absolute -right-2 -top-2 text-xs font-bold text-white bg-[#ff4d2d] rounded-full px-[6px] py-[1px] '>0</span>

          </div>
          </>:(<>
           <div className='relative cursor-pointer'>
               <FiShoppingCart size={25} className='text-[#ff4d2d]'/>
               <span className='absolute right-[-9px] top-[-12px] text-[#ff4d2d] '>5</span>
          </div>
          
          <button className='hidden md:block px-3 py-1 rounded-lg bg-[#ff4d2d]/10 text-[#ff4d2d] text-sm font-medium '>
               My Orders
          </button>
          
          </>)}

           
          
          <div className='w-[40px] h-[40px] rounded-full flex items-center justify-center bg-[#ff4d2d] text-white text-[18px] shadow-xl font-semibold cursor-pointer 'onClick={()=>setShowInfo(prev=>!prev)} >
               {userData?.fullName.slice(0,1)}

          </div>
          {showInfo && <div className='fixed top-[80px] right-[10px] md:right-[10%] lg:right-[25%] w-[180px] bg-white shadow-2xl rounded-xl p-[20px] flex flex-col gap-[10px] z-[9999] '>
               <div className='text-[17px] font-semibold '>{userData.fullName} </div>
               <div className='md:hidden text-[#ff4d2d] font-semibold cursor-pointer '>My orders</div>
               <div className='text-[#ff4d2d] font-semibold cursor-pointer' onClick={handleLogout}>Log Out</div>

          </div>}
          
          </div>
    </div>
  )
}

export default Nav