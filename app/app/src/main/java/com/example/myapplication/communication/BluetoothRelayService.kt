package com.example.myapplication.communication

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.example.myapplication.R
import com.example.myapplication.sos.SOSMessage

class BluetoothRelayService : Service() {

    private val binder = LocalBinder()
    lateinit var bluetoothTransport: BluetoothTransport
        private set
        
    private val CHANNEL_ID = "sanket_relay"
    var onMessageReceived: ((SOSMessage) -> Unit)? = null

    inner class LocalBinder : Binder() {
        fun getService(): BluetoothRelayService = this@BluetoothRelayService
    }

    override fun onCreate() {
        super.onCreate()
        bluetoothTransport = BluetoothTransport(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SANKET Relay")
            .setContentText("SANKET is protecting your area")
            .setSmallIcon(R.mipmap.ic_launcher)
            .build()
            
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                1,
                notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE 
                else 0
            )
        } else {
            startForeground(1, notification)
        }
        
        try {
            bluetoothTransport.startListening { msg ->
                onMessageReceived?.invoke(msg)
                showEmergencyNotification(msg)
            }
        } catch (e: Exception) {
            android.util.Log.e("BluetoothRelayService", "Failed to start BLE", e)
        }
        
        return START_STICKY
    }

    private fun showEmergencyNotification(msg: SOSMessage) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEW EMERGENCY: ${msg.priority}")
            .setContentText("From ${msg.source_device_id}: ${msg.message}")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        manager.notify(msg.message_id.hashCode(), notification)
    }

    override fun onDestroy() {
        super.onDestroy()
        bluetoothTransport.stopListening()
    }

    override fun onBind(intent: Intent?): IBinder {
        return binder
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SANKET Relay Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
