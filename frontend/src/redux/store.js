import { configureStore } from "@reduxjs/toolkit";
import UserSlice from "./userSlice"

export const store=configureStore({
     reducer:{
          user:UserSlice
     }
     
})