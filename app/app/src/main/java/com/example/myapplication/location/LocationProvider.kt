package com.example.myapplication.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle

data class LocationData(val lat: Double, val lng: Double, val accuracy: Float, val timestamp: Long)

class LocationProvider(private val context: Context) {
    
    private var locationManager: LocationManager? = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager?
    private var locationListener: LocationListener? = null
    
    @SuppressLint("MissingPermission")
    fun getLastKnownLocation(): LocationData? {
        if (locationManager == null) return null
        return try {
            val providers = locationManager!!.getProviders(true)
            var bestLocation: Location? = null
            for (provider in providers) {
                val l = locationManager!!.getLastKnownLocation(provider) ?: continue
                if (bestLocation == null || l.accuracy < bestLocation.accuracy) {
                    bestLocation = l
                }
            }
            if (bestLocation != null) {
                LocationData(bestLocation.latitude, bestLocation.longitude, bestLocation.accuracy, bestLocation.time)
            } else null
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("MissingPermission")
    fun requestLocationUpdates(callback: (LocationData) -> Unit) {
        if (locationManager == null) return
        
        locationListener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                callback(LocationData(location.latitude, location.longitude, location.accuracy, location.time))
            }
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        
        try {
            if (locationManager!!.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager!!.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000L, 5f, locationListener!!)
            }
            if (locationManager!!.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager!!.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000L, 5f, locationListener!!)
            }
        } catch (e: Exception) {
            // Ignore if permissions missing
        }
    }

    @SuppressLint("MissingPermission")
    fun stopLocationUpdates() {
        locationListener?.let {
            try {
                locationManager?.removeUpdates(it)
            } catch (e: Exception) {}
        }
        locationListener = null
    }
}
