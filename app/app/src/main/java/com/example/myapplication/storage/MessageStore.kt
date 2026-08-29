package com.example.myapplication.storage

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.example.myapplication.sos.SOSMessage
import org.json.JSONArray
import org.json.JSONObject

class MessageStore(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "sanket_messages.db"
        private const val DATABASE_VERSION = 1
        
        // Tables
        private const val TABLE_QUEUED_MESSAGES = "queued_messages"
        private const val TABLE_PROCESSED_IDS = "processed_ids"
        private const val TABLE_RECEIVED_MESSAGES = "received_messages"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $TABLE_QUEUED_MESSAGES (
                id TEXT PRIMARY KEY,
                message_json TEXT,
                status TEXT,
                created_at INTEGER
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE $TABLE_PROCESSED_IDS (
                message_id TEXT PRIMARY KEY,
                processed_at INTEGER
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE $TABLE_RECEIVED_MESSAGES (
                id TEXT PRIMARY KEY,
                message_json TEXT,
                received_at INTEGER,
                received_via TEXT
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_QUEUED_MESSAGES")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_PROCESSED_IDS")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_RECEIVED_MESSAGES")
        onCreate(db)
    }

    fun queueMessage(msg: SOSMessage) {
        val db = this.writableDatabase
        val values = ContentValues().apply {
            put("id", msg.message_id)
            put("message_json", serializeSOSMessage(msg))
            put("status", "QUEUED")
            put("created_at", System.currentTimeMillis())
        }
        db.insertWithOnConflict(TABLE_QUEUED_MESSAGES, null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getQueuedMessages(): List<SOSMessage> {
        val db = this.readableDatabase
        val cursor = db.query(TABLE_QUEUED_MESSAGES, null, null, null, null, null, "created_at ASC")
        val result = mutableListOf<SOSMessage>()
        with(cursor) {
            while (moveToNext()) {
                val jsonStr = getString(getColumnIndexOrThrow("message_json"))
                deserializeSOSMessage(jsonStr)?.let { result.add(it) }
            }
            close()
        }
        return result
    }

    fun removeFromQueue(messageId: String) {
        val db = this.writableDatabase
        db.delete(TABLE_QUEUED_MESSAGES, "id = ?", arrayOf(messageId))
    }

    fun isProcessed(messageId: String): Boolean {
        val db = this.readableDatabase
        val cursor = db.query(TABLE_PROCESSED_IDS, null, "message_id = ?", arrayOf(messageId), null, null, null)
        val exists = cursor.count > 0
        cursor.close()
        return exists
    }

    fun markProcessed(messageId: String) {
        val db = this.writableDatabase
        val values = ContentValues().apply {
            put("message_id", messageId)
            put("processed_at", System.currentTimeMillis())
        }
        db.insertWithOnConflict(TABLE_PROCESSED_IDS, null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun saveReceivedMessage(msg: SOSMessage, via: String) {
        val db = this.writableDatabase
        val values = ContentValues().apply {
            put("id", msg.message_id)
            put("message_json", serializeSOSMessage(msg))
            put("received_at", System.currentTimeMillis())
            put("received_via", via)
        }
        db.insertWithOnConflict(TABLE_RECEIVED_MESSAGES, null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getReceivedMessages(): List<SOSMessage> {
        val db = this.readableDatabase
        val cursor = db.query(TABLE_RECEIVED_MESSAGES, null, null, null, null, null, "received_at DESC")
        val result = mutableListOf<SOSMessage>()
        with(cursor) {
            while (moveToNext()) {
                val jsonStr = getString(getColumnIndexOrThrow("message_json"))
                deserializeSOSMessage(jsonStr)?.let { result.add(it) }
            }
            close()
        }
        return result
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
