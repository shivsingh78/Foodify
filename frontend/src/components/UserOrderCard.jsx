import React from 'react'

function UserOrderCard({data}) {
     const formateDate=(dateString)=>{
          const date=new Date(dateString)
          return date.toLocaleString('en-GB',{
               day:"2-digit",
               month:"short",
               year:"numeric"
          })
     }
  return (
    <div className='bg-white rounded-lg shadow p-4 space-y-4 '>
     <div className="flex justify-between border-b pb-2 ">
          <div className=" ">
               <p className='font-semibold '>order #{data._id.slice(-6)} </p>
               <p className='text-sm text-gray-500 '>Date: {formateDate(data.createdAt)} </p>
          </div>
          <div className="">
               <p className='text-sm text-gray-500 '> {data.paymentMethod.toUpperCase()} </p>
               <p className='font-medium text-blue-600'>{data.shopOrders?.[0].status} </p>
          </div>
     </div>

     

    </div>
  )
}

export default UserOrderCard