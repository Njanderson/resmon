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

    constructor(config: WorkspaceConfiguration) {
        this._config = config;
    }

    public async getResourceDisplay(): Promise<string | null> {
        return (await this.isShown()) ? this.getDisplay() : null;
    }

    protected async abstract getDisplay(): Promise<string>;

    protected async abstract isShown(): Promise<boolean>;

    protected convertBytesToLargestUnit(bytes: number, precision: number = 2): string {
        let unit: Units = Units.None;
        while (bytes/unit >= 1024 && unit < Units.G) {
            unit *= 1024;
        }
        return `${(bytes/unit).toFixed(precision)} ${Units[unit]}`;
    }
}

class CpuUsage extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config);
    }

    protected async isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get("show.cpuusage", true));
    }

    async getDisplay(): Promise<string> {
        let currentLoad = await si.currentLoad();
        return `$(pulse) ${(100 - currentLoad.currentload_idle).toFixed(2)}%`;
    }

}

class CpuTemp extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config);
    }

    protected async isShown(): Promise<boolean> {
        // If the CPU temp sensor cannot retrieve a valid temperature, disallow its reporting.
        var cpuTemp = (await si.cpuTemperature()).main;
        let hasCpuTemp = cpuTemp !== -1;
        return Promise.resolve(hasCpuTemp && this._config.get("show.cputemp", true));
    }

    async getDisplay(): Promise<string> {
        let currentTemps = await si.cpuTemperature();
        return `$(flame) ${(currentTemps.main).toFixed(2)} C`;
    }
}

class CpuFreq extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config);
    }

    protected async isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get("show.cpufreq", false));
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
        return `${(speedHz / freqDivisor).toFixed(2)} ${unit}`;
    }
}

class Battery extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config);
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
        super(config);
    }
    
    protected isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get("show.mem", true));
    }
    
    async getDisplay() : Promise<string> {
        let unit = this._config.get('memunit', "GB");
        var memDivisor = MemMappings[unit];
        let memoryData = await si.mem();
        let memoryUsedWithUnits = memoryData.active/memDivisor;
        let memoryTotalWithUnits = memoryData.total/memDivisor;
        return  `$(ellipsis) ${(memoryUsedWithUnits).toFixed(2)}/${(memoryTotalWithUnits).toFixed(2)} ${unit}`;
    }
}

class DiskSpace extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config);
    }

    protected isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get("show.disk", false));
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
    private _statusBarItem: StatusBarItem;
    private _config: WorkspaceConfiguration;
    private _delimiter: string;
    private _updating: boolean;

    constructor() {
        this._config = workspace.getConfiguration('resmon');
        this._delimiter = "    ";
        this._updating = false;
        this._statusBarItem = window.createStatusBarItem(this._config.get('alignLeft') ? StatusBarAlignment.Left : StatusBarAlignment.Right);
        this._statusBarItem.color = this._getColor();
        this._statusBarItem.show();
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
