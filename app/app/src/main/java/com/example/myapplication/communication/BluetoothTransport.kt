package com.example.myapplication.communication

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.myapplication.sos.SOSMessage
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class BluetoothTransport(private val context: Context) : Transport {

    companion object {
        private const val TAG = "BluetoothTransport"
        val SERVICE_UUID: UUID = UUID.fromString("00005AFE-0000-1000-8000-00805F9B34FB")
        val CHAR_UUID: UUID = UUID.fromString("00005051-0000-1000-8000-00805F9B34FB")
    }

    private val bluetoothManager: BluetoothManager? = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter

    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null

    private var onMessageReceivedCallback: ((SOSMessage) -> Unit)? = null

    val discoveredDevices = mutableSetOf<BluetoothDevice>()
    var connectedDevicesCount = 0

    private val handler = Handler(Looper.getMainLooper())

    override fun isAvailable(): Boolean {
        return bluetoothAdapter?.isEnabled == true
    }

    @SuppressLint("MissingPermission")
    override fun startListening(onMessageReceived: (SOSMessage) -> Unit) {
        if (!isAvailable()) return
        Log.d(TAG, "Starting Bluetooth listening...")
        this.onMessageReceivedCallback = onMessageReceived
        
        startGattServer()
        startAdvertising()
        startScanning()
    }

    @SuppressLint("MissingPermission")
    override fun stopListening() {
        Log.d(TAG, "Stopping Bluetooth listening...")
        stopScanning()
        stopAdvertising()
        stopGattServer()
    }

    @SuppressLint("MissingPermission")
    private fun startGattServer() {
        if (bluetoothManager == null) return
        val serverCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    connectedDevicesCount++
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    connectedDevicesCount--
                }
            }
            
            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray
            ) {
                super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value)
                if (characteristic.uuid == CHAR_UUID) {
                    try {
                        val jsonStr = String(value)
                        val msg = deserializeSOSMessage(jsonStr)
                        if (msg != null) {
                            Log.d(TAG, "Received SOS over BLE: \${msg.message_id}")
                            onMessageReceivedCallback?.invoke(msg)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error parsing BLE data", e)
                    }
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                    }
                }
            }
        }
        
        gattServer = bluetoothManager.openGattServer(context, serverCallback)
        
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val characteristic = BluetoothGattCharacteristic(
            CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        service.addCharacteristic(characteristic)
        gattServer?.addService(service)
    }

    @SuppressLint("MissingPermission")
    private fun stopGattServer() {
        gattServer?.close()
        gattServer = null
    }

    @SuppressLint("MissingPermission")
    private fun startAdvertising() {
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        if (advertiser == null) return
        
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
            
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(android.os.ParcelUuid(SERVICE_UUID))
            .build()
            
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    @SuppressLint("MissingPermission")
    private fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.d(TAG, "Advertising started successfully")
        }
        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "Advertising failed: \$errorCode")
        }
    }

    @SuppressLint("MissingPermission")
    private fun startScanning() {
        scanner = bluetoothAdapter?.bluetoothLeScanner
        if (scanner == null) return
        
        val filter = ScanFilter.Builder()
            .setServiceUuid(android.os.ParcelUuid(SERVICE_UUID))
            .build()
            
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
            
        scanner?.startScan(listOf(filter), settings, scanCallback)
    }

    @SuppressLint("MissingPermission")
    private fun stopScanning() {
        scanner?.stopScan(scanCallback)
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            result.device?.let { discoveredDevices.add(it) }
        }
    }

    @SuppressLint("MissingPermission")
    override fun sendEmergencyMessage(message: SOSMessage, onResult: (Boolean, String) -> Unit) {
        if (!isAvailable()) {
            onResult(false, "BLUETOOTH_UNAVAILABLE")
            return
        }
        
        val dataBytes = serializeSOSMessage(message).toByteArray()
        if (discoveredDevices.isEmpty()) {
            onResult(false, "NO_NEARBY_DEVICES")
            return
        }
        
        var successCount = 0
        var failCount = 0
        val targetCount = discoveredDevices.size
        
        for (device in discoveredDevices.toList()) {
            val gattCallback = object : BluetoothGattCallback() {
                override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        gatt.requestMtu(512)
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        gatt.close()
                    }
                }
                
                override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        gatt.discoverServices()
                    }
                }
                
                override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        val service = gatt.getService(SERVICE_UUID)
                        val characteristic = service?.getCharacteristic(CHAR_UUID)
                        if (characteristic != null) {
                            characteristic.value = dataBytes
                            gatt.writeCharacteristic(characteristic)
                        } else {
                            gatt.disconnect()
                            failCount++
                            checkCompletion()
                        }
                    }
                }
                
                override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        successCount++
                    } else {
                        failCount++
                    }
                    gatt.disconnect()
                    checkCompletion()
                }
                
                private fun checkCompletion() {
                    if (successCount + failCount >= targetCount) {
                        handler.post {
                            if (successCount > 0) {
                                onResult(true, "SENT_TO_\${successCount}_DEVICES")
                            } else {
                                onResult(false, "FAILED_TO_WRITE")
                            }
                        }
                    }
                }
            }
            
            device.connectGatt(context, false, gattCallback)
        }
    }
    
    private fun serializeSOSMessage(msg: SOSMessage): String {
        val json = JSONObject()
        json.put("message_id", msg.message_id)
        json.put("source_device_id", msg.source_device_id)
        json.put("type", msg.type)
        json.put("message", msg.message)
        json.put("priority", msg.priority)
        json.put("latitude", msg.latitude)
        json.put("longitude", msg.longitude)
        json.put("location_accuracy", msg.location_accuracy)
        json.put("timestamp", msg.timestamp)
        json.put("status", msg.status)
        json.put("ttl", msg.ttl)
        json.put("hopCount", msg.hopCount)
        val routeArray = JSONArray()
        msg.route.forEach { routeArray.put(it) }
        json.put("route", routeArray)
        if (msg.relatedSosId != null) json.put("relatedSosId", msg.relatedSosId)
        json.put("battery", msg.battery)
        return json.toString()
    }

    private fun deserializeSOSMessage(jsonStr: String): SOSMessage? {
        return try {
            val json = JSONObject(jsonStr)
            val routeList = mutableListOf<String>()
            if (json.has("route") && !json.isNull("route")) {
                val routeArray = json.getJSONArray("route")
                for (i in 0 until routeArray.length()) {
                    routeList.add(routeArray.getString(i))
                }
            }
            SOSMessage(
                message_id = json.getString("message_id"),
                source_device_id = json.getString("source_device_id"),
                type = json.optString("type", "SOS"),
                message = json.getString("message"),
                priority = json.getString("priority"),
                latitude = json.getDouble("latitude"),
                longitude = json.getDouble("longitude"),
                location_accuracy = json.getDouble("location_accuracy"),
                timestamp = json.getString("timestamp"),
                status = json.getString("status"),
                ttl = json.optInt("ttl", 10),
                hopCount = json.optInt("hopCount", 0),
                route = routeList,
                relatedSosId = if (json.has("relatedSosId") && !json.isNull("relatedSosId")) json.getString("relatedSosId") else null,
                battery = json.optInt("battery", -1)
            )
        } catch (e: Exception) {
            null
        }
    }
}
