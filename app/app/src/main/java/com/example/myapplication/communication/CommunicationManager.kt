package com.example.myapplication.communication

import com.example.myapplication.sos.SOSMessage
import com.example.myapplication.storage.MessageStore

class CommunicationManager(
    private val internetTransport: InternetTransport,
    private var bluetoothTransport: BluetoothTransport? = null,
    private var messageStore: MessageStore? = null
) {
    fun setTransports(bt: BluetoothTransport, store: MessageStore) {
        this.bluetoothTransport = bt
        this.messageStore = store
    }

    fun sendEmergencyMessage(message: SOSMessage, onResult: (Boolean, String) -> Unit) {
        // 1. Try internet first
        internetTransport.sendEmergencyMessage(message) { success, _ ->
            if (success) {
                onResult(true, "DELIVERED_TO_GATEWAY")
            } else {
                // 2. Internet failed, try Bluetooth
                if (bluetoothTransport != null && bluetoothTransport!!.isAvailable()) {
                    bluetoothTransport!!.sendEmergencyMessage(message) { btSuccess, _ ->
                        if (btSuccess) {
                            onResult(true, "RECEIVED_BY_RELAY")
                        } else {
                            // 3. Both failed, queue locally
                            messageStore?.queueMessage(message)
                            onResult(false, "QUEUED")
                        }
                    }
                } else {
                    messageStore?.queueMessage(message)
                    onResult(false, "NO_ROUTE")
                }
            }
        }
    }
}
