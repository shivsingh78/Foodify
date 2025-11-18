import React from 'react'
import scooter from "../assets/scooter.png"
import home from "../assets/home.png"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { MapContainer,Marker,Polyline,Popup,TileLayer } from 'react-leaflet'

const deliveryBoyIcon = new L.Icon({
          iconUrl:scooter,
          iconSize:[40,40],
          iconAnchor: [20,40]
     })
     const customerIcon = new L.Icon({
      iconUrl:home,
      iconSize:[40,40],
      iconAnchor:[20,40]
     })



function DeliveryBoyTracking({data}) {
  const deliveryBoyLat = data.deliveryBoyLocation.lat
  const deliveryBoyLon = data.deliveryBoyLocation.lon
  const customerLat = data.customerLocation.lat
  const customerLon = data.customerLocation.lon

  const path = [
     [deliveryBoyLat,deliveryBoyLon],
     [customerLat,customerLon]
    ]
    const center = [deliveryBoyLat,deliveryBoyLon]
     
     

  return (
    <div className='w-full h-[400px] mt-3 rounded-xl overflow-hidden shadow-md '>
      <MapContainer
      className= {"w-full h-full"} 
      center={center}
      zoom={16}
      >
         <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright"></a> '
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[deliveryBoyLat,deliveryBoyLon]} icon={deliveryBoyIcon}>
              <Popup>Delivery Boy </Popup>

            </Marker>
            <Marker position={[customerLat,customerLon]} icon={customerIcon}>
              <Popup>User Location </Popup>

            </Marker>
            <Polyline positions={path} color='blue' weight={4} />

      </MapContainer>
     
    </div>
  )
}

export default DeliveryBoyTracking