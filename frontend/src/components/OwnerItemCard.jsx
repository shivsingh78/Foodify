import React from 'react'
import { FaPen } from "react-icons/fa";
import { FaTrashAlt } from "react-icons/fa";
import {useNavigate} from 'react-router-dom'
import axios from 'axios'
import {serverUrl} from '../config'
import { useDispatch } from 'react-redux';
import { setMyShopData } from '../redux/ownerSlice';

function OwnerItemCard({data}) {
     const navigate = useNavigate()
     const dispatch = useDispatch()
     const handleDelete= async () => {
          try {
               const result = await axios.delete(`${serverUrl}/api/item/delete/${data._id}`,{withCredentials:true})
               dispatch(setMyShopData(result.data))

          } catch (error) {
               console.log(error);
               
          }
          
     }
  return (
    <div className='flex bg-white rounded-lg shadow-md overflow-hidden border border-primary w-full max-w-2xl '>
     <div className='w-36 flex-shrink-0 bg-surface-muted'>
          <img src={data.image} alt={data.name} className='w-full h-full object-cover' />
     </div>
     <div className='flex flex-col justify-between p-3 flex-1 ' >
          <div>
               <h2 className='text-base font-semibold text-primary  '>{data.name} </h2>
          <p><span className='font-medium text-ink '>Category:</span> {data.category} </p>
          <p><span className='font-medium text-ink '>Food Type:</span> {data.foodType} </p></div>

          <div className='flex items-center justify-between '>
               <div className='text-primary   font-bold'>Price: {data.price} </div>

               <div className='flex items-center  gap-2 '>
                    <div className='p-2 rounded-full hover:bg-primary/10 text-primary cursor-pointer  ' onClick={()=>navigate(`/edit-item/${data._id}`)} >
                          <FaPen size={16} />

                    </div>
                    <div className='p-2 rounded-full hover:bg-primary/10 text-primary cursor-pointer '  onClick={handleDelete} >
                          <FaTrashAlt size={16} />
                         

                    </div>

                   
                   
               </div>
          </div>
     </div>

    </div>
  )
}

export default OwnerItemCard