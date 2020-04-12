import './utils';
import { Categories } from 'hap-nodejs';
import { ElkAlarmSensorDevice } from 'isy-js';
import { ISYAccessory } from './ISYAccessory';
export declare class ISYElkAlarmPanelAccessory extends ISYAccessory<ElkAlarmSensorDevice, Categories.ALARM_SYSTEM> {
    alarmPanelService: any;
    constructor(device: any);
    setAlarmTargetState(targetStateHK: any, callback: any): void;
    translateAlarmCurrentStateToHK(): 1 | 0 | 2 | 3 | 4;
    translateAlarmTargetStateToHK(): 1 | 0 | 2 | 3;
    translateHKToAlarmTargetState(state: any): any;
    getAlarmTargetState(callback: any): void;
    getAlarmCurrentState(callback: any): void;
    handleExternalChange(propertyName: string, value: any, formattedValue: string): void;
    setupServices(): void;
}
//# sourceMappingURL=ISYElkAlarmPanelAccessory.d.ts.map