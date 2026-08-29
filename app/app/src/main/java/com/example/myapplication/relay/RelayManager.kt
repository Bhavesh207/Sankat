package com.example.myapplication.relay

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.myapplication.communication.BluetoothTransport
import com.example.myapplication.communication.InternetTransport
import com.example.myapplication.sos.SOSMessage
import com.example.myapplication.storage.MessageStore

class RelayManager(
    private val messageStore: MessageStore,
    private val internetTransport: InternetTransport,
    private val bluetoothTransport: BluetoothTransport,
    private val deviceId: String
) {
    companion object {
        private const val TAG = "RelayManager"
    }

    var onNearbyEmergencyReceived: ((SOSMessage) -> Unit)? = null
    private val handler = Handler(Looper.getMainLooper())
    private val queueRunnable = object : Runnable {
        override fun run() {
            processQueue()
            handler.postDelayed(this, 60000)
        }
    }

    init {
        handler.post(queueRunnable)
    }

    fun onMessageReceived(msg: SOSMessage) {
        if (messageStore.isProcessed(msg.message_id)) {
            Log.d(TAG, "Message already processed: \${msg.message_id}")
            return
        }
        
        messageStore.markProcessed(msg.message_id)
        messageStore.saveReceivedMessage(msg, "BLUETOOTH")
        
        handler.post { onNearbyEmergencyReceived?.invoke(msg) }

        if (msg.ttl <= 0) {
            Log.d(TAG, "TTL expired for message: \${msg.message_id}")
            return
        }

        val relayMsg = msg.copy(
            ttl = msg.ttl - 1,
            hopCount = msg.hopCount + 1,
            route = msg.route + deviceId,
            status = "RELAYING"
        )

        internetTransport.sendEmergencyMessage(relayMsg) { success, _ ->
            if (success) {
                Log.d(TAG, "Relayed to Internet: \${msg.message_id}")
            } else {
                if (bluetoothTransport.isAvailable()) {
                    bluetoothTransport.sendEmergencyMessage(relayMsg) { btSuccess, _ ->
                        if (!btSuccess) {
                            messageStore.queueMessage(relayMsg)
                        }
                    }
                } else {
                    messageStore.queueMessage(relayMsg)
                }
            }
        }
    }

    fun processQueue() {
        val queued = messageStore.getQueuedMessages()
        for (msg in queued) {
            internetTransport.sendEmergencyMessage(msg) { success, _ ->
                if (success) {
                    messageStore.removeFromQueue(msg.message_id)
                } else if (bluetoothTransport.isAvailable()) {
                    bluetoothTransport.sendEmergencyMessage(msg) { btSuccess, _ ->
                        if (btSuccess) {
                            messageStore.removeFromQueue(msg.message_id)
                        }
                    }
                }
            }
        }
    }

    fun getReceivedEmergencies(): List<SOSMessage> {
        return messageStore.getReceivedMessages()
    }
    
    fun stopQueueProcessor() {
        handler.removeCallbacks(queueRunnable)
    }
}
