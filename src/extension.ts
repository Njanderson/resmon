'use strict';
import { window, ExtensionContext, StatusBarAlignment, StatusBarItem, workspace, WorkspaceConfiguration } from 'vscode';
var si = require('systeminformation');

export function activate(context: ExtensionContext) {
    var resourceMonitor: ResMon = new ResMon();
    resourceMonitor.StartUpdating();
    context.subscriptions.push(resourceMonitor);
}

enum Units {
    B = 1,
    KB = 1024,
    MB = 1024 * 1024,
    GB = 1024 * 1024 * 1024
}

enum DiskSpaceFormat {
    PercentUsed,
    PercentRemaining,
    Remaining,
    UsedOutOfTotal
}

interface DiskSpaceFormatLookup {
    [unit: string]: DiskSpaceFormat;
}

var DiskSpaceFormatMappings: DiskSpaceFormatLookup = {
    "PercentUsed": DiskSpaceFormat.PercentUsed,
    "PercentRemaining": DiskSpaceFormat.PercentRemaining,
    "Remaining": DiskSpaceFormat.Remaining,
    "UsedOutOfTotal": DiskSpaceFormat.UsedOutOfTotal,
};

interface UnitLookup {
    [unit: string]: number;
}

var FreqMappings: UnitLookup = {
    "GHz": Units.GB,
    "MHz": Units.MB,
    "KHz": Units.KB,
    "Hz": Units.B,
};

abstract class Resource {
    protected _config: WorkspaceConfiguration;
    protected _isShownByDefault: boolean;
    protected _configKey: string;

    constructor(config: WorkspaceConfiguration, isShownByDefault: boolean, configKey: string) {
        this._config = config;
        this._isShownByDefault = isShownByDefault;
        this._configKey = configKey;
    }

    public async getResourceDisplay(): Promise<string | null> {
        return this.isShown() ? this.getDisplay() : null;
    }

    protected async abstract getDisplay(): Promise<string>;

    public isShown(): boolean {
        return this._config.get("show." + this._configKey, this._isShownByDefault);
    }

    protected convertBytesToLargestUnit(bytes: number, precision: number = 2): string {
        let unit: Units = Units.B;
        while (bytes/unit >= 1024 && unit < Units.GB) {
            unit *= 1024;
        }
        return `${(bytes/unit).toFixed(precision)} ${Units[unit]}`;
    }
}

class CpuUsage extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpuusage");
    }

    async getDisplay(): Promise<string> {
        let currentLoad = await si.currentLoad();
        return `$(pulse) ${(100 - currentLoad.currentload_idle).toFixed(2)}%`;
    }

}

class CpuTemp extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cputemp");
    }

    async getDisplay(): Promise<string> {
        let currentTemps = await si.cpuTemperature();
        return `$(flame) ${(currentTemps.main).toFixed(2)} C`;
    }

}

class CpuFreq extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpufreq");
    }

    async getDisplay(): Promise<string> {
        let cpuData = await si.cpu();
        // systeminformation returns frequency in terms of GHz by default
        let speedHz = parseFloat(cpuData.speed) * Units.GB;
        let formattedWithUnits = this.getFormattedWithUnits(speedHz);
        return `$(dashboard) ${(formattedWithUnits)}`;
    }

    getFormattedWithUnits(speedHz: number): string {
        var unit = this._config.get('freq.unit', "GHz");
        var freqDivisor: number = FreqMappings[unit];
        return `${(speedHz / freqDivisor).toFixed(2)} ${unit}`;
    }
}

class Battery extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "battery");
    }

    async getDisplay(): Promise<string> {
        let rawBattery = await si.battery();
        return `$(plug) ${rawBattery.percent}%`;
    }
}

class Memory extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "mem");
    }
    
    async getDisplay(): Promise<string> {
        // Index into Units array with string to grab the divisor
        var memDivisor = Units[this._config.get('mem.unit', "GB")];
        let memoryData = await si.mem();
        let memoryUsedWithUnits = memoryData.active / memDivisor;
        let memoryTotalWithUnits = memoryData.total / memDivisor;
        return `$(ellipsis) ${(memoryUsedWithUnits).toFixed(2)}/${(memoryTotalWithUnits).toFixed(2)} GB`;
    }

}

class DiskSpace extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "disk");
    }

    getFormat(): DiskSpaceFormat {
        let format: string | undefined = this._config.get<string>("disk.format");
        if (format) {
            return DiskSpaceFormatMappings[format];
        } else {
            return DiskSpaceFormat.PercentRemaining;
        }

    }

    getDrives(): string[] {
        let drives: string[] | undefined = this._config.get<string[]>("disk.drives");
        if (drives) {
            return drives;
        } else {
            return [];
        }
    }

    getFormattedDiskSpace(fsSize: any) {
        switch (this.getFormat()) {
            case DiskSpaceFormat.PercentRemaining:
                return `${fsSize.fs} ${(100 - fsSize.use).toFixed(2)}% remaining`;
            case DiskSpaceFormat.PercentUsed:
                return `${fsSize.fs} ${fsSize.use.toFixed(2)}% used`;
            case DiskSpaceFormat.Remaining:
                return `${fsSize.fs} ${this.convertBytesToLargestUnit(fsSize.size - fsSize.used)} remaining`;
            case DiskSpaceFormat.UsedOutOfTotal:
                return `${fsSize.fs} ${this.convertBytesToLargestUnit(fsSize.used)}/${this.convertBytesToLargestUnit(fsSize.size)} used`;
        }
    }

    async getDisplay(): Promise<string> {
        let fsSizes = await si.fsSize();
        let drives = this.getDrives();
        var formatted = "$(database) ";
        let formattedDrives: string[] = [];
        for (let fsSize of fsSizes) {
            // Drives were specified, check if this is an included drive
            if (drives.length === 0 || drives.indexOf(fsSize.fs) !== -1) {
                formattedDrives.push(this.getFormattedDiskSpace(fsSize));
            }
        }
        return formatted + formattedDrives.join(", ");
    }
}


class ResMon {
    private _statusBarItem: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    private _config: WorkspaceConfiguration;
    private _delimiter: string;
    private _updating: boolean;

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

    private async update(statusBarItem: StatusBarItem) {
        if (this._updating) {

            // Update the configuration in case it has changed
            this._config = workspace.getConfiguration('resmon');

            // Add all resources to monitor
            let resources: Resource[] = [];
            resources.push(new CpuUsage(this._config));
            resources.push(new CpuFreq(this._config));
            resources.push(new Battery(this._config));
            resources.push(new Memory(this._config));
            resources.push(new DiskSpace(this._config));
            resources.push(new CpuTemp(this._config));

            // Get the display of the requested resources
            let pendingUpdates: Promise<string | null>[] = resources.map(resource => resource.getResourceDisplay());

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
