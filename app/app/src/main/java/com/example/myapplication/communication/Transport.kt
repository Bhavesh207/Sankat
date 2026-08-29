package com.example.myapplication.communication

import com.example.myapplication.sos.SOSMessage

interface Transport {
    fun sendEmergencyMessage(message: SOSMessage, onResult: (Boolean, String) -> Unit)
    fun startListening(onMessageReceived: (SOSMessage) -> Unit) {}
    fun stopListening() {}
    fun isAvailable(): Boolean = false
}
