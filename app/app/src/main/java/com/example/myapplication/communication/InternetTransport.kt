package com.example.myapplication.communication

import android.util.Log
import com.example.myapplication.sos.SOSMessage
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class InternetTransport(private val backendUrl: String) : Transport {
    
    override fun sendEmergencyMessage(message: SOSMessage, onResult: (Boolean, String) -> Unit) {
        thread {
            try {
                val url = URL("$backendUrl/api/sos")
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Accept", "application/json")
                connection.doOutput = true
                connection.connectTimeout = 5000
                connection.readTimeout = 5000

                // Create JSON
                val jsonParam = JSONObject()
                jsonParam.put("message_id", message.message_id)
                jsonParam.put("source_device_id", message.source_device_id)
                jsonParam.put("message", message.message)
                jsonParam.put("priority", message.priority)
                jsonParam.put("latitude", message.latitude)
                jsonParam.put("longitude", message.longitude)
                jsonParam.put("location_accuracy", message.location_accuracy)
                jsonParam.put("timestamp", message.timestamp)
                jsonParam.put("status", message.status)

                val out = OutputStreamWriter(connection.outputStream)
                out.write(jsonParam.toString())
                out.close()

                val responseCode = connection.responseCode
                if (responseCode == 200 || responseCode == 201) {
                    Log.d("InternetTransport", "SOS delivered to backend")
                    onResult(true, "ACKNOWLEDGED")
                } else {
                    Log.e("InternetTransport", "Failed to deliver. Code: $responseCode")
                    onResult(false, "FAILED_HTTP_$responseCode")
                }
            } catch (e: Exception) {
                Log.e("InternetTransport", "Error sending SOS", e)
                onResult(false, "ERROR: ${e.message}")
            }
        }
    }
}
