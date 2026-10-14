import React, { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import ForgotPassword from './pages/ForgotPassword';
import useGetCurrentUser from './hooks/useGetCurrentUser';
import { useSelector } from 'react-redux';
import Home from './pages/Home';
import useGetCity from './hooks/useGetCity';
import CreateEditShop from './pages/CreateEditShop';
import useGetMyShop from './hooks/useGetMyShop';
import AddItem from './pages/AddItem';
import EditItem from './pages/EditItem';
import useGetShopByCity from './hooks/useGetShopByCity';
import useGetItemsByCity from './hooks/useGetItemsByCity';
import CartPage from './pages/CartPage';
import CheckOut from './pages/CheckOut';
import OrderPlaced from './pages/OrderPlaced';
import MyOrders from './pages/MyOrders';
import useGetMyOrders from './hooks/useGetMyOrders';
import useUpdateLocation from './hooks/useUpdateLocation';
import TrackOrderPage from './pages/TrackOrderPage';
import Shop from './pages/Shop';
import BecomeOwner from './pages/BecomeOwner';
import BecomeDeliveryPartner from './pages/BecomeDeliveryPartner';
import MyApplications from './pages/MyApplications';
import AdminApplications from './pages/AdminApplications';
import { connectSocket, disconnectSocket } from './utils/socket';
import ThemeToggle from './components/ThemeToggle';


function App() {
  const {userData,authLoading} = useSelector(state=>state.user);
  
  const location = useLocation()
  // After signing in, return to the page that required it (e.g. an application form).
  const afterLogin = location.state?.from ?? '/'
  const signinFor = <Navigate to='/signin' state={{from:location.pathname}} />
  const adminOnly = (el) => !userData ? signinFor : userData.role==='admin' ? el : <Navigate to='/' />
  const customerOnly = (el) => !userData ? signinFor : userData.role==='user' ? el : <Navigate to='/' />
  useGetMyShop()
  useGetShopByCity() 
  useGetItemsByCity()
  useGetCurrentUser()
  useUpdateLocation()
  useGetCity()
  useGetMyOrders()

  // One socket per signed-in user; the server authenticates it from the session cookie.
  useEffect(()=>{
    if(!userData?._id) return
    connectSocket()
    return () => disconnectSocket()
  },[userData?._id])

  if(authLoading)  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );

  // Screens that already carry the switch (Nav on the home dashboards, AuthLayout on sign-in/up/reset) must not
  // show a second one; every other page gets a small floating switch so the theme is changeable everywhere.
  const hasOwnToggle = ['/', '/signin', '/signup', '/forgot-password'].includes(location.pathname)

  return (
   <>
   {!hasOwnToggle && <ThemeToggle className="fixed bottom-4 right-4 z-[9998] shadow-lg" />}
   <Routes>
    <Route path='/signup' element={!userData?<SignUp/>: <Navigate to={afterLogin} /> } />
     <Route path='/signin' element={!userData?<SignIn/>: <Navigate to={afterLogin} />} />
     <Route path='/forgot-password' element={!userData?<ForgotPassword/>:<Navigate to={"/"} />} />
     <Route path='/' element={userData?<Home/>:<Navigate to={"/signin"} />} />
     <Route path='/create-edit-shop' element={userData?<CreateEditShop/>:<Navigate to={"/signin"} />} />
     <Route path='/add-item' element={userData?<AddItem/>:<Navigate to={"/signin"} />} />
     <Route path='/edit-item/:itemId' element={userData?<EditItem/>:<Navigate to={"/signin"} />} />
     <Route path='/cart' element={userData?<CartPage/>:<Navigate to={"/signin"} />} />
     <Route path='/checkout' element={userData?<CheckOut/>:<Navigate to={"/signin"} />} />
     <Route path='/order-placed' element={userData?<OrderPlaced/>:<Navigate to={"/signin"} />} />
     <Route path='/my-orders' element={userData?<MyOrders/>:<Navigate to={"/signin"} />} />
     <Route path='/track-order/:orderId' element={userData?<TrackOrderPage/>:<Navigate to={"/signin"}/>} />
     <Route path='/shop/:shopId' element={userData?<Shop/>:<Navigate to={"/signin" }/> } />
     <Route path='/become-owner' element={customerOnly(<BecomeOwner/>)} />
     <Route path='/become-delivery-partner' element={customerOnly(<BecomeDeliveryPartner/>)} />
     <Route path='/my-applications' element={userData?<MyApplications/>:signinFor} />
     <Route path='/admin/applications' element={adminOnly(<AdminApplications/>)} />
   </Routes>
   </>
  )
}

export default App