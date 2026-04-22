package com.mobile_new

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothManager
import android.content.Context
import android.util.Log
import com.facebook.react.bridge.*

class BluetoothDeviceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "BluetoothDeviceModule"

    override fun getName(): String {
        return "BluetoothDeviceModule"
    }

    @ReactMethod
    fun getConnectedDeviceName(promise: Promise) {
        try {
            val bluetoothAdapter = BluetoothAdapter.getDefaultAdapter()
            if (bluetoothAdapter == null) {
                Log.w(TAG, "BluetoothAdapter is null")
                promise.resolve(null)
                return
            }
            if (!bluetoothAdapter.isEnabled) {
                Log.w(TAG, "Bluetooth is disabled")
                promise.resolve(null)
                return
            }

            Log.d(TAG, "Requesting A2DP profile proxy...")
            bluetoothAdapter.getProfileProxy(reactApplicationContext, object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    Log.d(TAG, "A2DP Service Connected")
                    if (profile == BluetoothProfile.A2DP) {
                        val connectedDevices = proxy.connectedDevices
                        Log.d(TAG, "Connected A2DP devices: ${connectedDevices.size}")
                        if (connectedDevices.isNotEmpty()) {
                            Log.i(TAG, "Found device: ${connectedDevices[0].name}")
                            promise.resolve(connectedDevices[0].name)
                        } else {
                            Log.d(TAG, "No A2DP devices, checking HEADSET profile...")
                            bluetoothAdapter.getProfileProxy(reactApplicationContext, object : BluetoothProfile.ServiceListener {
                                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                                    Log.d(TAG, "Headset Service Connected")
                                    val headsetDevices = proxy.connectedDevices
                                    if (headsetDevices.isNotEmpty()) {
                                        Log.i(TAG, "Found Headset device: ${headsetDevices[0].name}")
                                        promise.resolve(headsetDevices[0].name)
                                    } else {
                                        Log.d(TAG, "No Headset devices found")
                                        promise.resolve(null)
                                    }
                                    bluetoothAdapter.closeProfileProxy(BluetoothProfile.HEADSET, proxy)
                                }
                                override fun onServiceDisconnected(profile: Int) {
                                    Log.d(TAG, "Headset Service Disconnected")
                                }
                            }, BluetoothProfile.HEADSET)
                        }
                    }
                    bluetoothAdapter.closeProfileProxy(BluetoothProfile.A2DP, proxy)
                }

                override fun onServiceDisconnected(profile: Int) {
                    Log.d(TAG, "A2DP Service Disconnected")
                }
            }, BluetoothProfile.A2DP)

        } catch (e: Exception) {
            Log.e(TAG, "Error in getConnectedDeviceName", e)
            promise.reject("ERROR", e.message)
        }
    }
}
