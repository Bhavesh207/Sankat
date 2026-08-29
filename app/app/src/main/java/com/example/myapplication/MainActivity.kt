package com.example.myapplication

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.myapplication.communication.BluetoothRelayService
import com.example.myapplication.communication.CommunicationManager
import com.example.myapplication.communication.InternetTransport
import com.example.myapplication.location.LocationData
import com.example.myapplication.location.LocationProvider
import com.example.myapplication.relay.RelayManager
import com.example.myapplication.sos.SOSMessage
import com.example.myapplication.storage.MessageStore
import com.example.myapplication.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class MainActivity : ComponentActivity() {
    
    private val internetTransport = InternetTransport("http://10.30.140.194:3000")
    private val communicationManager = CommunicationManager(internetTransport)
    private lateinit var messageStore: MessageStore
    private lateinit var locationProvider: LocationProvider
    
    private var relayService: BluetoothRelayService? = null
    private var relayManager: RelayManager? = null
    private var isBound = false
    
    private lateinit var prefs: SharedPreferences
    private lateinit var deviceId: String
    
    private val locationState = mutableStateOf<LocationData?>(null)
    private val nearbyEmergencies = mutableStateListOf<SOSMessage>()
    private val connectedNodes = mutableStateOf(0)
    private val isBluetoothActive = mutableStateOf(false)

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(className: ComponentName, service: IBinder) {
            val binder = service as BluetoothRelayService.LocalBinder
            relayService = binder.getService()
            isBound = true
            
            val btTransport = relayService!!.bluetoothTransport
            relayManager = RelayManager(messageStore, internetTransport, btTransport, deviceId)
            communicationManager.setTransports(btTransport, messageStore)
            
            relayService!!.onMessageReceived = { msg ->
                relayManager?.onMessageReceived(msg)
            }
            
            relayManager?.onNearbyEmergencyReceived = { msg ->
                if (!nearbyEmergencies.any { it.message_id == msg.message_id }) {
                    nearbyEmergencies.add(0, msg)
                }
            }
            
            nearbyEmergencies.clear()
            nearbyEmergencies.addAll(relayManager?.getReceivedEmergencies() ?: emptyList())
            
            isBluetoothActive.value = true
        }

        override fun onServiceDisconnected(arg0: ComponentName) {
            isBound = false
            relayService = null
            isBluetoothActive.value = false
        }
    }

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true || permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true) {
            startLocationUpdates()
        }
        // Start Bluetooth service only AFTER permissions are granted
        startBluetoothServiceSafely()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        prefs = getSharedPreferences("sanket_prefs", Context.MODE_PRIVATE)
        deviceId = prefs.getString("sanket_device_id", null) ?: run {
            val newId = "device-" + UUID.randomUUID().toString().substring(0, 8).uppercase()
            prefs.edit().putString("sanket_device_id", newId).apply()
            newId
        }
        
        messageStore = MessageStore(this)
        locationProvider = LocationProvider(this)
        
        val permissionsToRequest = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissionsToRequest.add(Manifest.permission.BLUETOOTH_SCAN)
            permissionsToRequest.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            permissionsToRequest.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissionLauncher.launch(permissionsToRequest.toTypedArray())

        setContent {
            MyApplicationTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    EmergencyApp(
                        communicationManager = communicationManager,
                        deviceId = deviceId,
                        locationState = locationState,
                        nearbyEmergencies = nearbyEmergencies,
                        connectedNodes = connectedNodes,
                        isBluetoothActive = isBluetoothActive,
                        batteryLevel = getBatteryLevel(),
                        toggleBluetooth = { toggleBluetoothService() }
                    )
                }
            }
        }
    }

    private fun startBluetoothServiceSafely() {
        try {
            val serviceIntent = Intent(this, BluetoothRelayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed to start Bluetooth service", e)
        }
    }

    private fun startLocationUpdates() {
        locationState.value = locationProvider.getLastKnownLocation()
        locationProvider.requestLocationUpdates { loc ->
            locationState.value = loc
        }
    }

    private fun toggleBluetoothService() {
        if (isBound) {
            unbindService(serviceConnection)
            stopService(Intent(this, BluetoothRelayService::class.java))
            isBound = false
            isBluetoothActive.value = false
        } else {
            val serviceIntent = Intent(this, BluetoothRelayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
        }
    }

    private fun getBatteryLevel(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    override fun onDestroy() {
        super.onDestroy()
        locationProvider.stopLocationUpdates()
        if (isBound) {
            unbindService(serviceConnection)
            isBound = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyApp(
    communicationManager: CommunicationManager,
    deviceId: String,
    locationState: State<LocationData?>,
    nearbyEmergencies: List<SOSMessage>,
    connectedNodes: State<Int>,
    isBluetoothActive: State<Boolean>,
    batteryLevel: Int,
    toggleBluetooth: () -> Unit
) {
    var selectedPriority by remember { mutableStateOf("CRITICAL") }
    var messageText by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var statusText by remember { mutableStateOf("System Ready") }
    
    val sosHistory = remember { mutableStateListOf<SOSMessage>() }
    val coroutineScope = rememberCoroutineScope()
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Text("SANKET", fontWeight = FontWeight.Bold, color = TextPrimary, fontFamily = FontFamily.Default) 
                },
                actions = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(end = 16.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(if (isBluetoothActive.value) AccentGreen else AccentRed)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            if (isBluetoothActive.value) "Online" else "Offline", 
                            color = if (isBluetoothActive.value) AccentGreen else AccentRed, 
                            fontSize = 14.sp, 
                            fontWeight = FontWeight.Medium,
                            fontFamily = FontFamily.Default
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgPrimary
                )
            )
        },
        bottomBar = {
            BottomAppBar(
                containerColor = BgCard,
                contentColor = TextPrimary,
                modifier = Modifier.height(56.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, contentDescription = "Status", modifier = Modifier.size(16.dp), tint = TextPrimary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Status: $statusText", fontSize = 14.sp, fontFamily = Mono)
                    }
                    Text("Bat: $batteryLevel%", fontSize = 14.sp, color = AccentGreen, fontFamily = Mono)
                }
            }
        },
        containerColor = BgPrimary
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            item {
                // Item 1: Merged Status Card
                Card(
                    colors = CardDefaults.cardColors(containerColor = BgCard),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        // Row 1: Bluetooth Relay
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Bluetooth Relay", color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
                                Spacer(modifier = Modifier.width(8.dp))
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .clip(CircleShape)
                                        .background(if (isBluetoothActive.value) AccentGreen else AccentRed)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    if (isBluetoothActive.value) "ACTIVE" else "INACTIVE",
                                    color = if (isBluetoothActive.value) AccentGreen else AccentRed,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Default
                                )
                            }
                            OutlinedButton(
                                onClick = toggleBluetooth,
                                modifier = Modifier.height(32.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, TextMuted)
                            ) {
                                Text(if (isBluetoothActive.value) "Turn Off" else "Turn On", fontSize = 12.sp, color = TextPrimary)
                            }
                        }
                        
                        Spacer(modifier = Modifier.height(12.dp))
                        
                        // Row 2: Nearby Nodes
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Nearby Nodes:", color = TextMuted, fontSize = 14.sp, fontFamily = FontFamily.Default)
                            Spacer(modifier = Modifier.width(8.dp))
                            if (connectedNodes.value == 0) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("0", color = AccentYellow, fontSize = 14.sp, fontFamily = Mono)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Icon(Icons.Default.Warning, contentDescription = "Warning", tint = AccentYellow, modifier = Modifier.size(16.dp))
                                }
                            } else {
                                Text("${connectedNodes.value}", color = TextPrimary, fontSize = 14.sp, fontFamily = Mono)
                            }
                        }
                        
                        Spacer(modifier = Modifier.height(12.dp))
                        HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))
                        Spacer(modifier = Modifier.height(12.dp))
                        
                        // Row 3: Location
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.LocationOn, 
                                contentDescription = "Location", 
                                tint = AccentBlue,
                                modifier = Modifier.size(24.dp)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            if (locationState.value != null) {
                                val loc = locationState.value!!
                                val displayLat = if (loc.lat != 0.0) loc.lat else 26.9124
                                val displayLng = if (loc.lng != 0.0) loc.lng else 75.7873
                                val displayAcc = if (loc.lat != 0.0) loc.accuracy else 10f
                                Column {
                                    Text("Lat: ${"%.4f".format(displayLat)}, Lng: ${"%.4f".format(displayLng)}", color = TextPrimary, fontSize = 12.sp, fontFamily = Mono)
                                    val date = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(loc.timestamp))
                                    Text("Accuracy: ±${displayAcc}m | Updated: $date", color = TextMuted, fontSize = 11.sp, fontFamily = Mono)
                                }
                            } else {
                                Text("GPS ACQUIRING...", color = AccentYellow, fontSize = 12.sp, fontFamily = Mono, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
            
            item {
                // Item 2: Priority Selector
                Text("EMERGENCY PRIORITY", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
                Spacer(modifier = Modifier.height(8.dp))
                
                val priorities = listOf("CRITICAL", "HIGH", "MEDIUM", "LOW")
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    priorities.forEachIndexed { index, priority ->
                        val priorityColor = when(priority) {
                            "CRITICAL" -> AccentRed
                            "HIGH" -> PriorityHigh
                            "MEDIUM" -> AccentYellow
                            "LOW" -> AccentBlue
                            else -> TextMuted
                        }
                        
                        SegmentedButton(
                            selected = selectedPriority == priority,
                            onClick = { selectedPriority = priority },
                            shape = SegmentedButtonDefaults.itemShape(index = index, count = priorities.size),
                            colors = SegmentedButtonDefaults.colors(
                                activeContainerColor = priorityColor.copy(alpha = 0.2f),
                                activeContentColor = priorityColor,
                                inactiveContainerColor = Color.Transparent,
                                inactiveContentColor = TextMuted,
                                activeBorderColor = priorityColor.copy(alpha = 0.5f),
                                inactiveBorderColor = TextMuted.copy(alpha = 0.5f)
                            )
                        ) {
                            Text(priority, fontSize = 10.sp, fontWeight = if (selectedPriority == priority) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
            
            item {
                // Item 3: Message Input
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Describe your emergency...", color = TextMuted, fontFamily = FontFamily.Default) },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = BgCard,
                        unfocusedContainerColor = BgCard,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = AccentBlue,
                        unfocusedBorderColor = TextMuted.copy(alpha = 0.3f),
                        cursorColor = AccentBlue
                    ),
                    shape = RoundedCornerShape(8.dp),
                    minLines = 3,
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Default)
                )
                Spacer(modifier = Modifier.height(32.dp))
            }
            
            item {
                // Item 4: SOS Button Area
                var isHolding by remember { mutableStateOf(false) }
                var holdProgress by remember { mutableStateOf(0f) }
                
                val infiniteTransition = rememberInfiniteTransition(label = "pulse")
                val scale1 by infiniteTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.5f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "scale1"
                )
                val alpha1 by infiniteTransition.animateFloat(
                    initialValue = 0.2f,
                    targetValue = 0f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "alpha1"
                )
                
                val scale2 by infiniteTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.5f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, delayMillis = 600, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "scale2"
                )
                val alpha2 by infiniteTransition.animateFloat(
                    initialValue = 0.2f,
                    targetValue = 0f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, delayMillis = 600, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "alpha2"
                )
                
                val scale3 by infiniteTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.5f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, delayMillis = 1200, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "scale3"
                )
                val alpha3 by infiniteTransition.animateFloat(
                    initialValue = 0.2f,
                    targetValue = 0f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2000, delayMillis = 1200, easing = LinearOutSlowInEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "alpha3"
                )

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(240.dp)
                            .pointerInput(Unit) {
                                awaitEachGesture {
                                    val down = awaitFirstDown()
                                    if (isSending) return@awaitEachGesture
                                    isHolding = true
                                    
                                    val job = coroutineScope.launch {
                                        val totalTime = 2000f
                                        var elapsed = 0f
                                        val step = 50f
                                        while (elapsed < totalTime) {
                                            delay(step.toLong())
                                            elapsed += step
                                            holdProgress = elapsed / totalTime
                                        }
                                        // Trigger action
                                        isHolding = false
                                        holdProgress = 0f
                                        isSending = true
                                        statusText = "QUEUED"
                                        
                                        val loc = locationState.value
                                        val msgId = "SOS-" + UUID.randomUUID().toString().substring(0, 8).uppercase()
                                        val msg = SOSMessage(
                                            message_id = msgId,
                                            source_device_id = deviceId,
                                            message = messageText.ifBlank { "Emergency assistance needed!" },
                                            priority = selectedPriority,
                                            latitude = if (loc != null && loc.lat != 0.0) loc.lat else 26.9124,
                                            longitude = if (loc != null && loc.lng != 0.0) loc.lng else 75.7873,
                                            location_accuracy = loc?.accuracy?.toDouble() ?: 10.0,
                                            timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()),
                                            status = "QUEUED",
                                            ttl = 10,
                                            hopCount = 0,
                                            route = listOf(deviceId),
                                            battery = batteryLevel
                                        )
                                        
                                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                            sosHistory.add(0, msg)
                                        }
                                        
                                        communicationManager.sendEmergencyMessage(msg) { success, status ->
                                            isSending = false
                                            if (success) {
                                                statusText = "DELIVERED"
                                                val index = sosHistory.indexOfFirst { it.message_id == msgId }
                                                if (index != -1) {
                                                    sosHistory[index] = sosHistory[index].copy(status = "DELIVERED")
                                                }
                                            } else {
                                                statusText = "QUEUED / $status"
                                            }
                                        }
                                    }
                                    
                                    // Wait for up event
                                    do {
                                        val event = awaitPointerEvent()
                                    } while (event.changes.any { it.pressed })
                                    
                                    // Only cancel if job hasn't completed yet (user released early)
                                    if (job.isActive) {
                                        job.cancel()
                                        isHolding = false
                                        holdProgress = 0f
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        // Pulse rings
                        if (!isSending) {
                            Box(modifier = Modifier.size(160.dp).scale(scale1).clip(CircleShape).background(AccentRed.copy(alpha = alpha1)))
                            Box(modifier = Modifier.size(160.dp).scale(scale2).clip(CircleShape).background(AccentRed.copy(alpha = alpha2)))
                            Box(modifier = Modifier.size(160.dp).scale(scale3).clip(CircleShape).background(AccentRed.copy(alpha = alpha3)))
                        }

                        // Progress indicator while holding
                        if (isHolding) {
                            CircularProgressIndicator(
                                progress = { holdProgress },
                                modifier = Modifier.size(176.dp),
                                color = TextPrimary,
                                strokeWidth = 8.dp,
                                trackColor = Color.Transparent,
                            )
                        }

                        // Main Button
                        Box(
                            modifier = Modifier
                                .size(160.dp)
                                .clip(CircleShape)
                                .background(if (isSending) AccentRed.copy(alpha = 0.5f) else AccentRed),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                Icon(Icons.Default.Warning, contentDescription = "SOS", modifier = Modifier.size(48.dp), tint = TextPrimary)
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("SEND SOS", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary, fontFamily = FontFamily.Default)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("hold 2 seconds to confirm", color = TextMuted, fontSize = 12.sp, fontFamily = FontFamily.Default)
                }
                Spacer(modifier = Modifier.height(32.dp))
            }
            
            item {
                // Item 5: Stop Relay Button (only if active)
                if (isBluetoothActive.value) {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        OutlinedButton(
                            onClick = toggleBluetooth,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = TextMuted),
                            border = androidx.compose.foundation.BorderStroke(1.dp, TextMuted)
                        ) {
                            Text("Stop Relay Service", fontFamily = FontFamily.Default)
                        }
                    }
                    Spacer(modifier = Modifier.height(32.dp))
                }
            }
            
            if (sosHistory.isNotEmpty()) {
                item {
                    // Item 6: Recent Activity
                    Text("RECENT ACTIVITY", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                items(sosHistory) { item ->
                    HistoryCard(item)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                item { Spacer(modifier = Modifier.height(16.dp)) }
            }
            
            if (nearbyEmergencies.isNotEmpty()) {
                item {
                    // Item 7: Nearby Emergencies
                    Text("NEARBY EMERGENCIES", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                items(nearbyEmergencies) { item ->
                    EmergencyCard(item)
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        }
    }
}

@Composable
fun HistoryCard(message: SOSMessage) {
    val priorityColor = when(message.priority) {
        "CRITICAL" -> AccentRed
        "HIGH" -> PriorityHigh
        "MEDIUM" -> AccentYellow
        "LOW" -> AccentBlue
        else -> TextMuted
    }
    
    val statusColor = when(message.status) {
        "DELIVERED", "ACKNOWLEDGED" -> AccentGreen
        "FAILED" -> AccentRed
        else -> AccentYellow
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(message.message_id, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 14.sp, fontFamily = Mono)
                
                Surface(
                    color = statusColor.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        message.status, 
                        color = statusColor, 
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Default,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(priorityColor))
                Spacer(modifier = Modifier.width(6.dp))
                Text(message.priority, color = priorityColor, fontSize = 12.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Default)
                Spacer(modifier = Modifier.width(8.dp))
                Text("•", color = TextMuted, fontSize = 12.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(message.timestamp, color = TextMuted, fontSize = 12.sp, fontFamily = Mono)
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            Text(message.message, color = TextPrimary, fontSize = 14.sp, fontFamily = FontFamily.Default)
        }
    }
}

@Composable
fun EmergencyCard(message: SOSMessage) {
    val priorityColor = when(message.priority) {
        "CRITICAL" -> AccentRed
        "HIGH" -> PriorityHigh
        "MEDIUM" -> AccentYellow
        "LOW" -> AccentBlue
        else -> TextMuted
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Victim: ", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 14.sp, fontFamily = FontFamily.Default)
                    Text(message.source_device_id, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 14.sp, fontFamily = Mono)
                }
                
                Surface(
                    color = priorityColor.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        message.status, 
                        color = priorityColor, 
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Default,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(priorityColor))
                Spacer(modifier = Modifier.width(6.dp))
                Text(message.priority, color = priorityColor, fontSize = 12.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Default)
                Spacer(modifier = Modifier.width(8.dp))
                Text("•", color = TextMuted, fontSize = 12.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(message.timestamp, color = TextMuted, fontSize = 12.sp, fontFamily = Mono)
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            Text(message.message, color = TextPrimary, fontSize = 14.sp, fontFamily = FontFamily.Default)
            
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Lat: ${"%.4f".format(message.latitude)}, Lng: ${"%.4f".format(message.longitude)} (±${message.location_accuracy}m)", 
                    color = TextMuted, 
                    fontSize = 12.sp,
                    fontFamily = Mono
                )
                
                val context = androidx.compose.ui.platform.LocalContext.current
                Button(
                    onClick = {
                        val uri = android.net.Uri.parse("geo:${message.latitude},${message.longitude}?q=${message.latitude},${message.longitude}(Victim Location)")
                        val mapIntent = android.content.Intent(android.content.Intent.ACTION_VIEW, uri)
                        mapIntent.setPackage("com.google.android.apps.maps")
                        if (mapIntent.resolveActivity(context.packageManager) != null) {
                            context.startActivity(mapIntent)
                        } else {
                            // Fallback if Google Maps is not installed
                            context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri))
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = priorityColor),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp)
                ) {
                    Text("📍 Map", fontSize = 12.sp, color = TextPrimary, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Default)
                }
            }
        }
    }
}