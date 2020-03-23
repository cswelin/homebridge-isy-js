import { InsteonOutletDevice } from 'isy-js';

import { ISYDeviceAccessory } from './ISYDeviceAccessory';
import  './utils';
import { Characteristic, Service, CharacteristicEventTypes } from 'hap-nodejs'

export class ISYOutletAccessory extends ISYDeviceAccessory<InsteonOutletDevice> {
	public outletService: any;
	constructor(log: (msg: any) => void, device: InsteonOutletDevice) {
		super(log, device);
	}
	// Handles the identify command
	// Handles a request to set the outlet state. Ignores redundant sets based on current states.
	public setOutletState(outletState: boolean, callback: (...any: any[]) => any) {
		this.logger(`OUTLET: Sending command to set outlet state to: ${outletState}`);
		if (outletState !== this.device.isOn) {
			this.device
				.updateIsOn(outletState)
				.then(callback(true))
				.catch(callback(false));
		} else {
			callback();
		}
	}
	// Handles a request to get the current outlet state based on underlying isy-js device object.
	public getOutletState(callback: (...any: any[]) => void){
		callback(null, this.device.isOn);
	}
	// Handles a request to get the current in use state of the outlet. We set this to true always as
	// there is no way to deterine this through the isy.
	public getOutletInUseState(callback: (...any: any[]) => void){
		callback(null, true);
	}
	// Mirrors change in the state of the underlying isj-js device object.
	public handleExternalChange(propertyName: string, value: any, formattedValue: string) {
		super.handleExternalChange(propertyName, value, formattedValue);
		this.outletService.updateCharacteristic(Characteristic.On, this.device.isOn);
	}
	// Returns the set of services supported by this object.
	public getServices() {
		super.getServices();
		const outletService = this.addService(Service.Outlet);
		this.outletService = outletService;
		outletService.getCharacteristic(Characteristic.On).on(CharacteristicEventTypes.SET, this.setOutletState.bind(this));
		outletService.getCharacteristic(Characteristic.On).on(CharacteristicEventTypes.GET, this.getOutletState.bind(this));
		outletService.getCharacteristic(Characteristic.OutletInUse).on(CharacteristicEventTypes.GET, this.getOutletInUseState.bind(this));
		return [this.informationService, outletService];
	}
}
