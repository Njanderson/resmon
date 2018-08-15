'use strict';
import {window, ExtensionContext, StatusBarAlignment, StatusBarItem, workspace} from 'vscode';
var si = require('systeminformation');
        
export function activate(context: ExtensionContext) {
    context.subscriptions.push(new ResMon());
}

enum Units {
    Kilo = 1024,
    Mega = 1024*1024,
    Giga = 1024*1024*1024
}

class ResMon {
    private _statusBarItem: StatusBarItem =  window.createStatusBarItem(StatusBarAlignment.Left);

    constructor() {
        this.update(this._statusBarItem);
        this._statusBarItem.show();
    }

    private update(statusBarItem : StatusBarItem) {
        let config = workspace.getConfiguration('resmon');
        let stats = [];
        if (config.get('showcpuusage', true)) {
            let usage = si.currentLoad().then(
                (data : any) => { return `⚡ ${(100 - data.currentload_idle).toFixed(2)}%`; }
            );
            stats.push(usage);
        }
        if (config.get('showcpufreq', true)) {
            let freq = si.cpu().then(
                (data : any) => { return `🕘 ${parseFloat(data.speed).toFixed(2)} GHz`; }
            );
            stats.push(freq);
        }
        if (config.get('showmem', true)) {
            let mem = si.mem().then(
                (data : any) => { return  `🐏 ${(data.used/Units.Giga).toFixed(2)}/${(data.total/Units.Giga).toFixed(2)} GB`; }
            );
            stats.push(mem);
        }
        if (config.get('showbattery', true)) {
            let battery = si.battery().then(
                (data : any) => { return `🔋 ${data.percent}%`; }
            );
            stats.push(battery);
        }
        Promise.all(stats).then(
            (data : any) => {
                statusBarItem.text = data.join(' ');
                setTimeout(() => this.update(statusBarItem), config.get('updatefrequencyms', 2000));
            }
        ).catch();
    }

    dispose() {
        this._statusBarItem.dispose();
    }
}

export function deactivate() {
}