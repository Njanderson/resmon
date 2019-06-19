'use strict';
import {window, ExtensionContext, StatusBarAlignment, StatusBarItem, workspace, WorkspaceConfiguration} from 'vscode';
var si = require('systeminformation');
        
export function activate(context: ExtensionContext) {
    var resourceMonitor : ResMon = new ResMon();
    resourceMonitor.StartUpdating();
    context.subscriptions.push(resourceMonitor);
}

enum Units {
    NoSuffix = 1,
    Kilo = 1024,
    Mega = 1024*1024,
    Giga = 1024*1024*1024
}

interface UnitLookup {
    [unit: string]: number;
}  

var FreqMappings : UnitLookup = {
    "GHz": Units.Giga,
    "MHz": Units.Mega,
    "KHz": Units.Kilo,
    "Hz": Units.NoSuffix
};

var MemMappings : UnitLookup = {
    "GB": Units.Giga,
    "MB": Units.Mega,
    "KB": Units.Kilo,
    "B": Units.NoSuffix
};

abstract class Resource {
    protected _config : WorkspaceConfiguration;
    protected _isShownByDefault : boolean;
    protected _configKey : string;

    constructor(config : WorkspaceConfiguration, isShownByDefault : boolean, configKey : string) {
        this._config = config;
        this._isShownByDefault = isShownByDefault;
        this._configKey = configKey;
    }

    public async getResourceDisplay() : Promise<string | null> {
        return this.isShown() ? this.getDisplay() : null;
    }

    protected async abstract getDisplay() : Promise<string>;

    public isShown() : boolean {
        return this._config.get(this._configKey, this._isShownByDefault);
    }
}

class CpuUsage extends Resource {

    constructor(config : WorkspaceConfiguration) {
        super(config, true, "showcpuusage");
    }
    
    async getDisplay() : Promise<string> {
        let currentLoad = await si.currentLoad();
        return `$(pulse) ${(100 - currentLoad.currentload_idle).toFixed(2)}%`;
    }
    
}

class CpuFreq extends Resource {

    constructor(config : WorkspaceConfiguration) {
        super(config, true, "showcpufreq");
    }
    
    async getDisplay() : Promise<string> {    
        let cpuData = await si.cpu();
        // systeminformation returns frequency in terms of GHz by default
        let speedHz = parseFloat(cpuData.speed)*Units.Giga;
        let formattedWithUnits = this.getFormattedWithUnits(speedHz);
        return `$(dashboard) ${(formattedWithUnits)}`;
    }

    getFormattedWithUnits(speedHz : number) : string {
        var unit = this._config.get('frequnit', "GHz");
        var freqDivisor : number = FreqMappings[unit];
        return `${(speedHz/freqDivisor).toFixed(2)} ${unit}`;
    }
}

class Battery extends Resource {

    constructor(config : WorkspaceConfiguration) {
        super(config, false, "showbattery");
    }
    
    async getDisplay() : Promise<string> {
        let rawBattery = await si.battery();
        return `$(zap) ${rawBattery.percent}%`;
    }
}

class Memory extends Resource {

    constructor(config : WorkspaceConfiguration) {
        super(config, true, "showmem");
    }
    
    async getDisplay() : Promise<string> {
        let unit = this._config.get('memunit', "GB")
        var memDivisor = MemMappings[unit];
        let memoryData = await si.mem();
        let memoryUsedWithUnits = memoryData.active/memDivisor;
        let memoryTotalWithUnits = memoryData.total/memDivisor;
        return  `$(ellipsis) ${(memoryUsedWithUnits).toFixed(2)}/${(memoryTotalWithUnits).toFixed(2)} ${unit}`;
    }

}


class ResMon {
    private _statusBarItem: StatusBarItem =  window.createStatusBarItem(StatusBarAlignment.Left);
    private _config : WorkspaceConfiguration;
    private _delimiter : string;
    private _updating : boolean;

    constructor() {
        this._statusBarItem.show();
        this._config = workspace.getConfiguration('resmon');
        this._delimiter = "    ";
        this._updating = false;
    }

    public StartUpdating() {
        this._updating = true;
        this.update(this._statusBarItem);
    }

    public StopUpdating() {
        this._updating = false;
    }

    private async update(statusBarItem : StatusBarItem) {
        if (this._updating) {
            // Add all resources to monitor
            let resources : Resource[] = [];
            resources.push(new CpuUsage(this._config));
            resources.push(new CpuFreq(this._config));
            resources.push(new Battery(this._config));
            resources.push(new Memory(this._config));

            // Get the display of the requested resources
            let pendingUpdates : Promise<string | null>[] = resources.map(resource => resource.getResourceDisplay());
                
            // Wait for the resources to update
            await Promise.all(pendingUpdates).then(finishedUpdates => {
                // Remove nulls, join with delimiter
                statusBarItem.text = finishedUpdates.filter(update => update !== null).join(this._delimiter);
            });

            setTimeout(() => this.update(statusBarItem), this._config.get('updatefrequencyms', 2000));
        }
    }

    dispose() {
        this.StopUpdating();
        this._statusBarItem.dispose();
    }
}

export function deactivate() {
}
