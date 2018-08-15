# Resource Monitor README

## Features

Display CPU frequency, usage, memory consumption, and battery percentage remaining. Big thanks to the node module systeminformation.

## Requirements

Just the systeminformation node module.

## Extension Settings

* `myExtension.showcpuusage`: Show CPU Usage. In Windows, this percentage is calculated with processor time, which doesn't quite match the task manager figure.
* `myExtension.showcpufreq`: Show CPU Frequency.
* `myExtension.showmem`: Show consumed and total memory as a fraction.
* `myExtension.showbattery`: Show battery percentage remaining.
* `myExtension.updatefrequencyms`: How frequently to query systeminformation. The minimum is 200 ms as to prevent accidentally updating so fast as to freeze up your machine.

## Known Issues

A better solution for Windows CPU Usage would be great. I investigated alternatives to counting Processor Time, but none of them seemed to match the Task Manager percentage.

### 1.0.0

Initial release of Resource Monitor.
