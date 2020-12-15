'use strict';
import { window, ExtensionContext, StatusBarAlignment, StatusBarItem, workspace, WorkspaceConfiguration } from 'vscode';
import { Units, DiskSpaceFormat, DiskSpaceFormatMappings, FreqMappings, MemMappings } from './constants';

var si = require('systeminformation');

export function activate(context: ExtensionContext) {
    var resourceMonitor: ResMon = new ResMon();
    resourceMonitor.StartUpdating();
    context.subscriptions.push(resourceMonitor);
}

abstract class Resource {
    protected _config: WorkspaceConfiguration;
    protected _isShownByDefault: boolean;
    protected _configKey: string;
    protected _maxWidth: number;

    constructor(config: WorkspaceConfiguration, isShownByDefault: boolean, configKey: string) {
        this._config = config;
        this._isShownByDefault = isShownByDefault;
        this._configKey = configKey;
        this._maxWidth = 0;
    }

    public async getResourceDisplay(): Promise<string | null> {
        if (await this.isShown())
        {
            let display: string = await this.getDisplay();
            this._maxWidth = Math.max(this._maxWidth, display.length);

            // Pad out to the correct length such that the length doesn't change
            return display.padEnd(this._maxWidth, ' ');
        }

        return null;
    }

    protected abstract getDisplay(): Promise<string>;

    protected async isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get(`show.${this._configKey}`, false));
    }

    public getPrecision(): number {
        return this._config.get("show.precision", 2);
    }

    protected convertBytesToLargestUnit(bytes: number, precision: number = 2): string {
        let unit: Units = Units.None;
        while (bytes/unit >= 1024 && unit < Units.G) {
            unit *= 1024;
        }
        return `${(bytes/unit).toFixed(this.getPrecision())} ${Units[unit]}`;
    }
}

class CpuUsage extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpuusage");
    }

    async getDisplay(): Promise<string> {
        let currentLoad = await si.currentLoad();
        return `$(pulse) ${(100 - currentLoad.currentload_idle).toFixed(this.getPrecision())}%`;
    }

}

class CpuTemp extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cputemp");
    }

    protected async isShown(): Promise<boolean> {
        // If the CPU temp sensor cannot retrieve a valid temperature, disallow its reporting.
        var cpuTemp = (await si.cpuTemperature()).main;
        let hasCpuTemp = cpuTemp !== -1;
        return Promise.resolve(hasCpuTemp && this._config.get("show.cputemp", true));
    }

    async getDisplay(): Promise<string> {
        let currentTemps = await si.cpuTemperature();
        let unit = this._config.get('temp.unit',"C");
        let temp = null;
        let unitWithSymbol = null;
        if (unit === "F") {
            temp = this.CelsiusToFahrenheit(parseFloat(currentTemps.main));
            unitWithSymbol = '\u2109';
        } else {
            temp = currentTemps.main;
            unitWithSymbol = '\u2103';
        }
        return `$(flame) ${(temp).toFixed(this.getPrecision())} ${unitWithSymbol}`;
    }
    
    CelsiusToFahrenheit(temp: number): number {
        return temp*(9/5) + 32;
    }
}

class CpuFreq extends Resource {
    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpufreq");
    }

    async getDisplay(): Promise<string> {
        let cpuCurrentSpeed = await si.cpuCurrentspeed();
        // systeminformation returns frequency in terms of GHz by default
        let speedHz = parseFloat(cpuCurrentSpeed.avg) * Units.G;
        let formattedWithUnits = this.getFormattedWithUnits(speedHz);
        return `$(dashboard) ${(formattedWithUnits)}`;
    }

    getFormattedWithUnits(speedHz: number): string {
        var unit = this._config.get('freq.unit', "GHz");
        var freqDivisor: number = FreqMappings[unit];
        return `${(speedHz / freqDivisor).toFixed(this.getPrecision())} ${unit}`;
    }
}

class Battery extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "battery");
    }

    protected async isShown(): Promise<boolean> {
        let hasBattery = (await si.battery()).hasbattery;
        return Promise.resolve(hasBattery && this._config.get("show.battery", false));
    }

    async getDisplay(): Promise<string> {
        let rawBattery = await si.battery();
        var percentRemaining = Math.min(Math.max(rawBattery.percent, 0), 100);
        return `$(plug) ${percentRemaining}%`;
    }
}

class Memory extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "mem");
    }
    
    async getDisplay() : Promise<string> {
        let unit = this._config.get('memunit', "GB");
        var memDivisor = MemMappings[unit];
        let memoryData = await si.mem();
        let memoryUsedWithUnits = memoryData.active / memDivisor;
        let memoryTotalWithUnits = memoryData.total / memDivisor;
        return `$(ellipsis) ${(memoryUsedWithUnits).toFixed(this.getPrecision())}/${(memoryTotalWithUnits).toFixed(this.getPrecision())} ${unit}`;
    }
}

class Network extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "net");
    
        // Network stats are requested through returning the delta between
        // multiple invocations
        this.getInterfaceStats();
    }

    async getInterfaceStats() : Promise<any> {
        let networkInterfaces = await si.networkInterfaces();
        for (let networkInterface in networkInterfaces) {
            console.log(networkInterface);
            let networkStats = await si.networkStats(networkInterface);
            console.log(networkStats);
        }
    }

    async getDisplay(): Promise<string> {
        // Not implemented
        return ""; 
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
                return `${fsSize.fs} ${(100 - fsSize.use).toFixed(this.getPrecision())}% remaining`;
            case DiskSpaceFormat.PercentUsed:
                return `${fsSize.fs} ${fsSize.use.toFixed(this.getPrecision())}% used`;
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
    private _statusBarItem: StatusBarItem;
    private _config: WorkspaceConfiguration;
    private _delimiter: string;
    private _updating: boolean;
    private _resources: Resource[];

    constructor() {
        this._config = workspace.getConfiguration('resmon');
        this._delimiter = "    ";
        this._updating = false;
        this._statusBarItem = window.createStatusBarItem(this._config.get('alignLeft') ? StatusBarAlignment.Left : StatusBarAlignment.Right);
        this._statusBarItem.color = this._getColor();
        this._statusBarItem.show();

        // Add all resources to monitor
        this._resources = [];
        this._resources.push(new CpuUsage(this._config));
        this._resources.push(new CpuFreq(this._config));
        this._resources.push(new Battery(this._config));
        this._resources.push(new Memory(this._config));
        this._resources.push(new DiskSpace(this._config));
        this._resources.push(new CpuTemp(this._config));
        this._resources.push(new Network(this._config));
    }

    public StartUpdating() {
        this._updating = true;
        this.update();
    }

    public StopUpdating() {
        this._updating = false;
    }
    
    private _getColor() : string {
        const defaultColor = "#FFFFFF";

        // Enforce #RRGGBB format
        let hexColorCodeRegex = /^#[0-9A-F]{6}$/i;
        let configColor = this._config.get('color', defaultColor);
        if (!hexColorCodeRegex.test(configColor)) {
            configColor = defaultColor;
        }

        return configColor;
    }

    private async update() {
        if (this._updating) {

            // Update the configuration in case it has changed
            this._config = workspace.getConfiguration('resmon');

            // Update the status bar item's styling
            let proposedAlignment = this._config.get('alignLeft') ? StatusBarAlignment.Left : StatusBarAlignment.Right;
            if (proposedAlignment !== this._statusBarItem.alignment) {
                this._statusBarItem.dispose();
                this._statusBarItem = window.createStatusBarItem(proposedAlignment);
                this._statusBarItem.color = this._getColor();
                this._statusBarItem.show();
            } else {
                this._statusBarItem.color = this._getColor();
            }

            // Get the display of the requested resources
            let pendingUpdates: Promise<string | null>[] = this._resources.map(resource => resource.getResourceDisplay());

            // Wait for the resources to update
            this._statusBarItem.text = await Promise.all(pendingUpdates).then(finishedUpdates => {
                // Remove nulls, join with delimiter
                return finishedUpdates.filter(update => update !== null).join(this._delimiter);
            });

            setTimeout(() => this.update(), this._config.get('updatefrequencyms', 2000));
        }
    }

    dispose() {
        this.StopUpdating();
        this._statusBarItem.dispose();
    }
}

export function deactivate() {
}
