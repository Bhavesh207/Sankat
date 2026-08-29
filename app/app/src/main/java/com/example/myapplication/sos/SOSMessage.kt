package com.example.myapplication.sos

data class SOSMessage(
    val message_id: String,
    val source_device_id: String,
    val type: String = "SOS",
    val message: String,
    val priority: String,
    val latitude: Double,
    val longitude: Double,
    val location_accuracy: Double,
    val timestamp: String,
    val status: String,
    val ttl: Int = 10,
    val hopCount: Int = 0,
    val route: List<String> = emptyList(),
    val relatedSosId: String? = null,
    val battery: Int = -1
)
