/*
 ISY-JS
 
 ISY-99 REST / WebSockets based HomeBridge shim. 
 
 Supports the following Insteon devices: Lights (dimmable and non-dimmable), Fans, Outlets, Door/Window Sensors, MorningLinc locks, Inline Lincs and I/O Lincs.
 Also supports ZWave based locks. If elkEnabled is set to true then this will also expose your Elk Alarm Panel and all of your Elk Sensors. 
 
 Turns out that HomeBridge platforms can only return a maximum of 100 devices. So if you end up exposing more then 100 devices through HomeBridge the HomeKit
 software will fail adding the HomeBridge to your HomeKit network. To address this issue this platform provides an option to screen out devices based on 
 criteria specified in the config. 

 Configuration sample:
 
     "platforms": [
        {
            "platform": "isy-js",
            "name": "isy-js",         
            "host": "10.0.1.12",      
            "username": "admin",      
            "password": "password",   
            "elkEnabled": true,
            "includeAllScenes": false,
            "includedScenes": [
            	"44909"
            ],
            "ignoreDevices": [        
                { "nameContains": "ApplianceLinc", "lastAddressDigit": "", "address": ""},
                { "nameContains": "Bedroom.Side Gate", "lastAddressDigit": "", "address": ""},
                { "nameContains": "Remote", "lastAddressDigit": "", "address": "" },    
                { "nameContains": "Keypad", "lastAddressDigit": "2", "address": "" },
            ]
        }
     ]

 Fields: 
 "platform" - Must be set to isy-js
 "name" - Can be set to whatever you want
 "host" - IP address of the ISY
 "username" - Your ISY username
 "password" - Your ISY password
 "elkEnabled" - true if there is an elk alarm panel connected to your ISY
 "includeAllScenes" - Should all scenes be included and enumerated? true enables all scenes, false enables only those identified in includedScenes section
 "includedScenes" - List of scenes to include
 "ignoreDevices" - Array of objects specifying criteria for screening out devices from the network. nameContains is the only required criteria. If the other criteria
                   are blank all devices will match those criteria (providing they match the name criteria).
		"nameContains" - Specifies a substring to check against the names of the ISY devices. Required field for the criteria.
		"lastAddressDigit" - Specifies a single digit in the ISY address of a device which should be used to match the device. Example use of this is for composite 
		                     devices like keypads so you can screen out the non-main buttons. 
	    "address" - ISY address to match.		   
         
		Examples:
		
		{ "nameContains": "Keypad", "lastAddressDigit": "2", "address": "" } - Ignore all devices which have the word Keypad in their name and whose last address digit is 2.
		{ "nameContains": "Remote", "lastAddressDigit": "", "address": "" } - Ignore all devices which have the word Remote in their name
		{ "nameContains": "", "lastAddressDigit": "", "address": "15 5 3 2"} - Ignore the device with an ISY address of 15 5 3 2.
		
 TODOS: Implement identify functions (beep perhaps?) and more device types.
*/

var Service, Characteristic, types;

var isy = require('isy-js');

// Global device map. Needed to map incoming notifications to the corresponding HomeKit device for update.
var deviceMap = {};

// This function responds to changes in devices from the isy-js library. Uses the global device map to update
// the state.
// TODO: Move this to a member function of the ISYPlatform object so we don't need a global map.
function ISYChangeHandler(isy,device) {
	var deviceToUpdate = deviceMap[device.address];
	if(deviceToUpdate != null) {
		deviceToUpdate.handleExternalChange();
	}
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  types = homebridge.hapLegacyTypes;  
  homebridge.registerPlatform("homebridge-isy-js", "isy-js", ISYPlatform);
}

////////////////////////////////////////////////////////////////////////////////////////////////
// PLATFORM

// Construct the ISY platform. log = Logger, config = homebridge cofnig
function ISYPlatform(log,config) {
	this.log = log;
	this.config = config;
	this.host = config.host;
	this.username = config.username;
	this.password = config.password;
	this.elkEnabled = config.elkEnabled;
	this.debugLoggingEnabled = (config.debugLoggingEnabled==undefined) ? false : config.debugLoggingEnabled;
	this.includeAllScenes = (config.includeAllScenes==undefined) ? false : config.includeAllScenes;
	this.includedScenes = (config.includedScenes==undefined) ? [] : config.includedScenes;
	this.isy = new isy.ISY(this.host, this.username,this.password, config.elkEnabled, ISYChangeHandler, config.useHttps, true, this.debugLoggingEnabled);
}

ISYPlatform.prototype.logger = function(msg) {
	if(this.debugLoggingEnabled || (process.env.ISYJSDEBUG != undefined && process.env.IYJSDEBUG != null)) {
		this.log(msg);
	}
}

// Checks the device against the configuration to see if it should be ignored. 
ISYPlatform.prototype.shouldIgnore = function(device) {
	var deviceAddress = device.address;
	var deviceName = device.name;
	if(device.deviceType==this.isy.DEVICE_TYPE_SCENE) {
		if(this.includeAllScenes == true) {
			return false;
		} else {
			for(var index = 0; index < this.includedScenes.length; index++) {
				if(this.includedScenes[index] == deviceAddress) {
					return false;
				}
			}
			return true;
		}
	} else {
		for (var index = 0; index < this.config.ignoreDevices.length; index++) {
			var rule = this.config.ignoreDevices[index];
			if (rule.nameContains != "") {
				if (deviceName.indexOf(rule.nameContains) == -1) {
					continue;
				}
			}
			if (rule.lastAddressDigit != "") {
				if (deviceAddress.indexOf(rule.lastAddressDigit, deviceAddress.length - 2) == -1) {
					continue;
				}
			}
			if (rule.address != "") {
				if (deviceAddress != rule.address) {
					continue;
				}
			}
			this.logger("Ignoring device: " + deviceName + " [" + deviceAddress + "] because of rule [" + rule.nameContains + "] [" + rule.lastAddressDigit + "] [" + rule.address + "]");
			return true;

		}
	}
	return false;	
}

// Calls the isy-js library, retrieves the list of devices, and maps them to appropriate ISYXXXXAccessory devices.
ISYPlatform.prototype.accessories = function(callback) {
	var that = this;
	this.isy.initialize(function() {
		var results = [];		
		var deviceList = that.isy.getDeviceList();
		for(var index = 0; index < deviceList.length; index++) {
			var device = deviceList[index];
			var homeKitDevice = null;
			if(!that.shouldIgnore(device)) {
				
				if(device.deviceType == that.isy.DEVICE_TYPE_LIGHT || device.deviceType == that.isy.DEVICE_TYPE_DIMMABLE_LIGHT) {
					homeKitDevice = new ISYLightAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_LOCK || device.deviceType == that.isy.DEVICE_TYPE_SECURE_LOCK) {
					homeKitDevice = new ISYLockAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_OUTLET) {
					homeKitDevice = new ISYOutletAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_FAN) {
					homeKitDevice = new ISYFanAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_DOOR_WINDOW_SENSOR) {
					homeKitDevice = new ISYDoorWindowSensorAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_ALARM_DOOR_WINDOW_SENSOR) {
					homeKitDevice = new ISYDoorWindowSensorAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_ALARM_PANEL) {
					homeKitDevice = new ISYElkAlarmPanelAccessory(that.logger,device);
				} else if(device.deviceType == that.isy.DEVICE_TYPE_MOTION_SENSOR) {
                    homeKitDevice = new ISYMotionSensorAccessory(that.logger,device);
                } else if(device.deviceType == that.isy.DEVICE_TYPE_SCENE) {
					homeKitDevice = new ISYLightAccessory(that.logger,device);
				}
				if(homeKitDevice != null) {
					// Make sure the device is address to the global map
					deviceMap[device.address] = homeKitDevice;
					results.push(homeKitDevice);
				}
			}
		}
		if(that.isy.elkEnabled) {
			var panelDevice = that.isy.getElkAlarmPanel();
			var panelDeviceHK = new ISYElkAlarmPanelAccessory(that.log,panelDevice);
			deviceMap[panelDevice.address] = panelDeviceHK;
			results.push(panelDeviceHK);
		}
		that.logger("Filtered device has: "+results.length+" devices");
		callback(results);		
	});
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// BASE FOR ALL DEVICES

// Provides common constructor tasks
function ISYAccessoryBaseSetup(accessory,log,device) {
	accessory.log = log;
	accessory.device = device;
	accessory.address = device.address;
	accessory.name = device.name;	
	accessory.uuid_base = device.isy.address+":"+device.address;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// FANS - ISYFanAccessory 
// Implemetnts the fan service for an isy fan device. 

// Constructs a fan accessory object. device is the isy-js device object and log is the logger. 
function ISYFanAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
}

ISYFanAccessory.prototype.identify = function(callback) {
	// Do the identify action
	callback();
}

// Translates the fan speed as an isy-js string into the corresponding homekit constant level.
// Homekit doesn't have steps for the fan speed and needs to have a value from 0 to 100. We 
// split the range into 4 steps and map them to the 4 isy-js levels. 
ISYFanAccessory.prototype.translateFanSpeedToHK = function(fanSpeed) {
	if(fanSpeed == this.device.FAN_OFF) {
		return 0;
	} else if(fanSpeed == this.device.FAN_LEVEL_LOW) {
		return 32;
	} else if(fanSpeed == this.device.FAN_LEVEL_MEDIUM) {
		return 67;
	} else if(fanSpeed == this.device.FAN_LEVEL_HIGH) {
		return 100;
	} else {
		this.log("!!!! ERROR: Unknown fan speed: "+fanSpeed);
		return 0;
	}
}

// Translates the fan level from homebridge into the isy-js level. Maps from the 0-100
// to the four isy-js fan speed levels. 
ISYFanAccessory.prototype.translateHKToFanSpeed = function(fanStateHK) {
	if(fanStateHK == 0) {
		return this.device.FAN_OFF;
	} else if(fanStateHK > 0 && fanStateHK <=32) {
		return this.device.FAN_LEVEL_LOW;
	} else if(fanStateHK >= 33 && fanStateHK <= 67) {
		return this.device.FAN_LEVEL_MEDIUM;
	} else if(fanStateHK > 67) {
		return this.device.FAN_LEVEL_HIGH;
	} else {
		this.log("ERROR: Unknown fan state!");
		return this.device.FAN_OFF;
	}
}

// Returns the current state of the fan from the isy-js level to the 0-100 level of HK.
ISYFanAccessory.prototype.getFanRotationSpeed = function(callback) {
	this.log( "Getting fan rotation speed. Device says: "+this.device.getCurrentFanState()+" translation says: "+this.translateFanSpeedToHK(this.device.getCurrentFanState()))
	callback(null,this.translateFanSpeedToHK(this.device.getCurrentFanState()));
}

// Sets the current state of the fan from the 0-100 level of HK to the isy-js level.
ISYFanAccessory.prototype.setFanRotationSpeed = function(fanStateHK,callback) {
	this.log( "Sending command to set fan state(pre-translate) to: "+fanStateHK);
	var newFanState = this.translateHKToFanSpeed(fanStateHK);
	this.log("Sending command to set fan state to: "+newFanState);
	if(newFanState != this.device.getCurrentFanState()) {
		this.device.sendFanCommand(newFanState, function(result) {
			callback();		
		});
	} else {
		this.log("Fan command does not change actual speed");
		callback();
	}
}

// Returns true if the fan is on
ISYFanAccessory.prototype.getIsFanOn = function() {
	this.log( "Getting fan is on. Device says: "+this.device.getCurrentFanState()+" Code says: "+(this.device.getCurrentFanState() != "Off"));
	return (this.device.getCurrentFanState() != "Off");
}

// Returns the state of the fan to the homebridge system for the On characteristic
ISYFanAccessory.prototype.getFanOnState = function(callback) {
	callback(null,this.getIsFanOn());
}

// Sets the fan state based on the value of the On characteristic. Default to Medium for on. 
ISYFanAccessory.prototype.setFanOnState = function(onState,callback) {
	this.log( "Setting fan on state to: "+onState+" Device says: "+this.device.getCurrentFanState());
	if(onState != this.getIsFanOn()) {
		if(onState) {
			this.log( "Setting fan speed to medium");
			this.setFanRotationSpeed(this.translateFanSpeedToHK(this.device.FAN_LEVEL_MEDIUM), callback);
		} else {
			this.log( "Setting fan speed to off");
			this.setFanRotationSpeed(this.translateFanSpeedToHK(this.device.FAN_OFF), callback);
		}
	} else {
		this.log("Fan command does not change actual state");
		callback();
	} 
}

// Mirrors change in the state of the underlying isj-js device object.
ISYFanAccessory.prototype.handleExternalChange = function() {
	this.log( "Incoming external change. Device says: "+this.device.getCurrentFanState());
	this.fanService
		.setCharacteristic(Characteristic.On, this.getIsFanOn());
		
	this.fanService
		.setCharacteristic(Characteristic.RotationSpeed, this.translateFanSpeedToHK(this.device.getCurrentFanState()));		
}

// Returns the services supported by the fan device. 
ISYFanAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var fanService = new Service.Fan();
	
	this.fanService = fanService;
	this.informationService = informationService;	
    
    fanService
      .getCharacteristic(Characteristic.On)
      .on('set', this.setFanOnState.bind(this));
	  
	fanService
	  .getCharacteristic(Characteristic.On)
	  .on('get', this.getFanOnState.bind(this));
	  
	fanService
	  .addCharacteristic(Characteristic.RotationSpeed)
	  .on('get', this.getFanRotationSpeed.bind(this));	  
  
	fanService
	  .getCharacteristic(Characteristic.RotationSpeed)	
	  .on('set', this.setFanRotationSpeed.bind(this));	
    
    return [informationService, fanService];	
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// OUTLETS - ISYOutletAccessory
// Implements the Outlet service for ISY devices.

// Constructs an outlet. log = HomeBridge logger, device = isy-js device to wrap
function ISYOutletAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
}

// Handles the identify command
ISYOutletAccessory.prototype.identify = function(callback) {
	// Do the identify action
	callback();
}

// Handles a request to set the outlet state. Ignores redundant sets based on current states.
ISYOutletAccessory.prototype.setOutletState = function(outletState,callback) {
	this.log("Sending command to set outlet state to: "+outletState);
	if(outletState != this.device.getCurrentOutletState()) {
		this.device.sendOutletCommand(outletState, function(result) {
			callback();		
		});
	} else {
		callback();
	}
}

// Handles a request to get the current outlet state based on underlying isy-js device object.
ISYOutletAccessory.prototype.getOutletState = function(callback) {
	callback(null,this.device.getCurrentOutletState());
}

// Handles a request to get the current in use state of the outlet. We set this to true always as
// there is no way to deterine this through the isy.
ISYOutletAccessory.prototype.getOutletInUseState = function(callback) {
	callback(null, true);
}

// Mirrors change in the state of the underlying isj-js device object.
ISYOutletAccessory.prototype.handleExternalChange = function() {
	this.outletService
		.setCharacteristic(Characteristic.On, this.device.getCurrentOutletState());
}

// Returns the set of services supported by this object.
ISYOutletAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var outletService = new Service.Outlet();
	
	this.outletService = outletService;
	this.informationService = informationService;	
    
    outletService
      .getCharacteristic(Characteristic.On)
      .on('set', this.setOutletState.bind(this));
	  
	outletService
	  .getCharacteristic(Characteristic.On)
	  .on('get', this.getOutletState.bind(this));
	  
	outletService
	  .getCharacteristic(Characteristic.OutletInUse)
	  .on('get', this.getOutletInUseState.bind(this));
    
    return [informationService, outletService];	
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// LOCKS - ISYLockAccessory
// Implements the lock service for isy-js devices. 

// Constructs a lock accessory. log = homebridge logger, device = isy-js device object being wrapped
function ISYLockAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
}

// Handles an identify request
ISYLockAccessory.prototype.identify = function(callback) {
	callback();
}

// Handles a set to the target lock state. Will ignore redundant commands.
ISYLockAccessory.prototype.setTargetLockState = function(lockState,callback) {
	this.log(this,"Sending command to set lock state to: "+lockState);
	if(lockState != this.getDeviceCurrentStateAsHK()) {
		var targetLockValue = (lockState == 0) ? false : true;
		this.device.sendLockCommand(targetLockValue, function(result) {
			callback();		
		});
	} else {
		callback();
	}
}

// Translates underlying lock state into the corresponding homekit state
ISYLockAccessory.prototype.getDeviceCurrentStateAsHK = function() {
	return (this.device.getCurrentLockState() ? 1 : 0);
}

// Handles request to get the current lock state for homekit
ISYLockAccessory.prototype.getLockCurrentState = function(callback) {
	callback(null, this.getDeviceCurrentStateAsHK());
}

// Handles request to get the target lock state for homekit
ISYLockAccessory.prototype.getTargetLockState = function(callback) {
	this.getLockCurrentState(callback);
}

// Mirrors change in the state of the underlying isj-js device object.
ISYLockAccessory.prototype.handleExternalChange = function() {
	this.lockService
		.setCharacteristic(Characteristic.LockTargetState, this.getDeviceCurrentStateAsHK());
	this.lockService
		.setCharacteristic(Characteristic.LockCurrentState, this.getDeviceCurrentStateAsHK());
}

// Returns the set of services supported by this object.
ISYLockAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var lockMechanismService = new Service.LockMechanism();
	
	this.lockService = lockMechanismService;
	this.informationService = informationService;	
    
    lockMechanismService
      .getCharacteristic(Characteristic.LockTargetState)
      .on('set', this.setTargetLockState.bind(this));
	  
	lockMechanismService
	  .getCharacteristic(Characteristic.LockTargetState)
	  .on('get', this.getTargetLockState.bind(this));
	  
	lockMechanismService
	  .getCharacteristic(Characteristic.LockCurrentState)
	  .on('get', this.getLockCurrentState.bind(this));
    
    return [informationService, lockMechanismService];	
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
// LIGHTS
// Implements the Light service for homekit based on an underlying isy-js device. Is dimmable or not depending
// on if the underlying device is dimmable. 

// Constructs the light accessory. log = homebridge logger, device = isy-js device object being wrapped
function ISYLightAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
	this.dimmable = (this.device.deviceType == "DimmableLight");
}

// Handles the identify command
ISYLightAccessory.prototype.identify = function(callback) {
	this.device.sendLightCommand(true, function(result) {
		this.device.sendLightCommand(false, function(result) {
			callback();			
		});		
	});
}

// Handles request to set the current powerstate from homekit. Will ignore redundant commands. 
ISYLightAccessory.prototype.setPowerState = function(powerOn,callback) {
	this.log("Setting powerstate to "+powerOn);
	if(powerOn != this.device.getCurrentLightState()) {
		this.log("Changing powerstate to "+powerOn);
		this.device.sendLightCommand(powerOn, function(result) {
			callback();
		});
	} else {
		this.log("Ignoring redundant setPowerState");
		callback();
	}
}

// Mirrors change in the state of the underlying isj-js device object.
ISYLightAccessory.prototype.handleExternalChange = function() {
	this.log("Handling external change for light");
	this.lightService
		.setCharacteristic(Characteristic.On, this.device.getCurrentLightState());
	if(this.dimmable) {
		this.lightService
			.setCharacteristic(Characteristic.Brightness, this.device.getCurrentLightDimState()	);
	}
}

// Handles request to get the current on state
ISYLightAccessory.prototype.getPowerState = function(callback) { 
	callback(null,this.device.getCurrentLightState());
}

// Handles request to set the brightness level of dimmable lights. Ignore redundant commands. 
ISYLightAccessory.prototype.setBrightness = function(level,callback) {
	this.log("Setting brightness to "+level);
	if(level != this.device.getCurrentLightDimState()) {
		this.log("Changing Brightness to "+level);
		this.device.sendLightDimCommand(level, function(result) {
			callback();			
		});
	} else {
		this.log("Ignoring redundant setBrightness");
		callback();
	}
}

// Handles a request to get the current brightness level for dimmable lights.
ISYLightAccessory.prototype.getBrightness = function(callback) {
	callback(null,this.device.getCurrentLightDimState());
}

// Returns the set of services supported by this object.
ISYLightAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var lightBulbService = new Service.Lightbulb();
	
	this.informationService = informationService;
	this.lightService = lightBulbService; 	
	
    lightBulbService
      .getCharacteristic(Characteristic.On)
      .on('set', this.setPowerState.bind(this));
	  
	lightBulbService
	  .getCharacteristic(Characteristic.On)
	  .on('get', this.getPowerState.bind(this));
	  
	if(this.dimmable) {
		lightBulbService
		.addCharacteristic(Characteristic.Brightness)
		.on('get', this.getBrightness.bind(this));
		
		lightBulbService
		.getCharacteristic(Characteristic.Brightness)	  
		.on('set', this.setBrightness.bind(this));
	}
	  
    return [informationService, lightBulbService];	
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// CONTACT SENSOR - ISYDoorWindowSensorAccessory
// Implements the ContactSensor service.

// Constructs a Door Window Sensor (contact sensor) accessory. log = HomeBridge logger, device = wrapped isy-js device.
function ISYDoorWindowSensorAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
	this.doorWindowState = false;
}

// Handles the identify command.
ISYDoorWindowSensorAccessory.prototype.identify = function(callback) {
	// Do the identify action
	callback();
}

// Translates the state of the underlying device object into the corresponding homekit compatible state
ISYDoorWindowSensorAccessory.prototype.translateCurrentDoorWindowState = function() {
	return (this.device.getCurrentDoorWindowState()) ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED;	
}

// Handles the request to get he current door window state.
ISYDoorWindowSensorAccessory.prototype.getCurrentDoorWindowState = function(callback) {
	callback(null,this.translateCurrentDoorWindowState());
}

// Mirrors change in the state of the underlying isj-js device object.
ISYDoorWindowSensorAccessory.prototype.handleExternalChange = function() {
	this.sensorService
		.setCharacteristic(Characteristic.ContactSensorState, this.translateCurrentDoorWindowState());
}

// Returns the set of services supported by this object.
ISYDoorWindowSensorAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var sensorService = new Service.ContactSensor();
	
	this.sensorService = sensorService;
	this.informationService = informationService;	
    
    sensorService
      .getCharacteristic(Characteristic.ContactSensorState)
      .on('get', this.getCurrentDoorWindowState.bind(this));
    
    return [informationService, sensorService];	
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// MOTION SENSOR - ISYMotionSensorAccessory
// Implements the ContactSensor service.

// Constructs a Door Window Sensor (contact sensor) accessory. log = HomeBridge logger, device = wrapped isy-js device.
function ISYMotionSensorAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
}

// Handles the identify command.
ISYMotionSensorAccessory.prototype.identify = function(callback) {
	// Do the identify action
	callback();
}

// Handles the request to get he current motion sensor state.
ISYMotionSensorAccessory.prototype.getCurrentMotionSensorState = function(callback) {
	callback(null,this.device.getCurrentMotionSensorState());
}

// Mirrors change in the state of the underlying isj-js device object.
ISYMotionSensorAccessory.prototype.handleExternalChange = function() {
	this.sensorService
		.setCharacteristic(Characteristic.MotionDetected, this.device.getCurrentMotionSensorState());
}

// Returns the set of services supported by this object.
ISYMotionSensorAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
    var sensorService = new Service.MotionSensor();
	
    this.sensorService = sensorService;
    this.informationService = informationService;	
    
    sensorService
      .getCharacteristic(Characteristic.MotionDetected)
      .on('get', this.getCurrentMotionSensorState.bind(this));
    
    return [informationService, sensorService];	
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// ELK SENSOR PANEL - ISYElkAlarmPanelAccessory
// Implements the SecuritySystem service for an elk security panel connected to the isy system

// Constructs the alarm panel accessory. log = HomeBridge logger, device = underlying isy-js device being wrapped
function ISYElkAlarmPanelAccessory(log,device) {
	ISYAccessoryBaseSetup(this,log,device);
}

// Handles the identify command
ISYElkAlarmPanelAccessory.prototype.identify = function(callback) {
	callback();
}

// Handles the request to set the alarm target state
ISYElkAlarmPanelAccessory.prototype.setAlarmTargetState = function(targetStateHK,callback) {
	this.log("Sending command to set alarm panel state to: "+targetStateHK);
	var targetState = this.translateHKToAlarmTargetState(targetStateHK);
	this.log("Would send the target state of: "+targetState);
	if(this.device.getAlarmMode() != targetState) {
		this.device.sendSetAlarmModeCommand(targetState, function(result) {
			callback();		
		});
	} else {
		this.log("Redundant command, already in that state.");
		callback();
	}
}

// Translates from the current state of the elk alarm system into a homekit compatible state. The elk panel has a lot more
// possible states then can be directly represented by homekit so we map them. If the alarm is going off then it is tripped.
// If it is arming or armed it is considered armed. Stay maps to the state state, away to the away state, night to the night 
// state. 
ISYElkAlarmPanelAccessory.prototype.translateAlarmCurrentStateToHK = function() {
	var tripState = this.device.getAlarmTripState();
	var sourceAlarmState = this.device.getAlarmState();
	var sourceAlarmMode = this.device.getAlarmMode();
	
	if(tripState >= this.device.ALARM_TRIP_STATE_TRIPPED) {
		return Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;		
	} else if(sourceAlarmState == this.device.ALARM_STATE_NOT_READY_TO_ARM || 
	    sourceAlarmState == this.device.ALARM_STATE_READY_TO_ARM || 
	    sourceAlarmState == this.device.ALARM_STATE_READY_TO_ARM_VIOLATION) {
		return Characteristic.SecuritySystemCurrentState.DISARMED;	   
	} else {
		if(sourceAlarmMode == this.device.ALARM_MODE_STAY || sourceAlarmMode == this.device.ALARM_MODE_STAY_INSTANT ) {
			return Characteristic.SecuritySystemCurrentState.STAY_ARM;
		} else if(sourceAlarmMode == this.device.ALARM_MODE_AWAY || sourceAlarmMode == this.device.ALARM_MODE_VACATION) {
			return Characteristic.SecuritySystemCurrentState.AWAY_ARM;
		} else if(sourceAlarmMode == this.device.ALARM_MODE_NIGHT || sourceAlarmMode == this.device.ALARM_MODE_NIGHT_INSTANT) {
			return Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
		} else {
			this.log("Setting to disarmed because sourceAlarmMode is "+sourceAlarmMode);
			return Characteristic.SecuritySystemCurrentState.DISARMED;
		}
	}
}

// Translates the current target state of hthe underlying alarm into the appropriate homekit value
ISYElkAlarmPanelAccessory.prototype.translateAlarmTargetStateToHK = function() {
	var sourceAlarmState = this.device.getAlarmMode();
	if(sourceAlarmState == this.device.ALARM_MODE_STAY || sourceAlarmState == this.device.ALARM_MODE_STAY_INSTANT ) {
 		return Characteristic.SecuritySystemTargetState.STAY_ARM;
	} else if(sourceAlarmState == this.device.ALARM_MODE_AWAY || sourceAlarmState == this.device.ALARM_MODE_VACATION) {
		return Characteristic.SecuritySystemTargetState.AWAY_ARM;
	} else if(sourceAlarmState == this.device.ALARM_MODE_NIGHT || sourceAlarmState == this.device.ALARM_MODE_NIGHT_INSTANT) {
		return Characteristic.SecuritySystemTargetState.NIGHT_ARM;
	} else {
		return Characteristic.SecuritySystemTargetState.DISARM;
	}
}

// Translates the homekit version of the alarm target state into the appropriate elk alarm panel state
ISYElkAlarmPanelAccessory.prototype.translateHKToAlarmTargetState = function(state) {
	if(state == Characteristic.SecuritySystemTargetState.STAY_ARM) {
		return this.device.ALARM_MODE_STAY;
	} else if(state == Characteristic.SecuritySystemTargetState.AWAY_ARM) {
		return this.device.ALARM_MODE_AWAY;
	} else if(state == Characteristic.SecuritySystemTargetState.NIGHT_ARM) {
		return this.device.ALARM_MODE_NIGHT;
	} else {
		return this.device.ALARM_MODE_DISARMED;
	}
}

// Handles request to get the target alarm state
ISYElkAlarmPanelAccessory.prototype.getAlarmTargetState = function(callback) {
	callback(null,this.translateAlarmTargetStateToHK());
}

// Handles request to get the current alarm state
ISYElkAlarmPanelAccessory.prototype.getAlarmCurrentState = function(callback) {
	callback(null,this.translateAlarmCurrentStateToHK());
}

// Mirrors change in the state of the underlying isj-js device object.
ISYElkAlarmPanelAccessory.prototype.handleExternalChange = function() {
	this.log("Source device. Currenty state locally -"+this.device.getAlarmStatusAsText());
	this.log("Got alarm change notification. Setting HK target state to: "+this.translateAlarmTargetStateToHK()+" Setting HK Current state to: "+this.translateAlarmCurrentStateToHK());
	this.alarmPanelService
		.setCharacteristic(Characteristic.SecuritySystemTargetState, this.translateAlarmTargetStateToHK());
	this.alarmPanelService
		.setCharacteristic(Characteristic.SecuritySystemCurrentState, this.translateAlarmCurrentStateToHK());
}

// Returns the set of services supported by this object.
ISYElkAlarmPanelAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();
	
	informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, this.device.deviceFriendlyName)
      .setCharacteristic(Characteristic.SerialNumber, this.device.address);	
	  
	var alarmPanelService = new Service.SecuritySystem();
	
	this.alarmPanelService = alarmPanelService;
	this.informationService = informationService;	
    
    alarmPanelService
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('set', this.setAlarmTargetState.bind(this));
	  
	alarmPanelService
	  .getCharacteristic(Characteristic.SecuritySystemTargetState)
	  .on('get', this.getAlarmTargetState.bind(this));
	  
	alarmPanelService
	  .getCharacteristic(Characteristic.SecuritySystemCurrentState)
	  .on('get', this.getAlarmCurrentState.bind(this));
    
    return [informationService, alarmPanelService];	
}

module.exports.platform = ISYPlatform;
module.exports.ISYFanAccessory = ISYFanAccessory;
module.exports.ISYLightAccessory = ISYLightAccessory;
module.exports.ISYLockAccessory = ISYLockAccessory;
module.exports.ISYOutletAccessory = ISYOutletAccessory;
module.exports.ISYDoorWindowSensorAccessory = ISYDoorWindowSensorAccessory;
module.exports.ISYMotionSensorAccessory = ISYMotionSensorAccessory;
module.exports.ISYElkAlarmPanelAccessory = ISYElkAlarmPanelAccessory;


