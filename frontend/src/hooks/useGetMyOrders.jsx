import axios from "axios";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux"
import { serverUrl } from "../config";
import { setMyOrders } from "../redux/userSlice";


function useGetMyOrders() {
     const dispatch=useDispatch();
     const {userData}=useSelector(state=>state.user)
     useEffect(()=>{
          const fetchOrders=async () => {
               try {
                    const result = await axios.get(`${serverUrl}/api/order/my-orders`,{withCredentials:true})
                    dispatch(setMyOrders(result.data))
                    

               } catch (error) {
                    console.log(error);
                    
                    
               }
          }
          if(!userData) return
          fetchOrders()
          // Realtime events are not replayed after a reconnect, so refetch authoritative state.
          window.addEventListener('foodify:resync',fetchOrders)
          return () => window.removeEventListener('foodify:resync',fetchOrders)
     },[userData?._id])
}

export default useGetMyOrders