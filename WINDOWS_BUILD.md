# Billwise for Windows

## Portable folder

Open `dist\Billwise Portable` and run `Billwise-Portable.exe`. On its first run, Billwise creates a `BillwiseData` folder beside the executable and keeps the bills and history there. Close Billwise before moving or copying the folder. To use it on another computer, copy the entire `Billwise Portable` folder, including `BillwiseData`, then run the executable from the copied folder.

The portable app can copy existing Billwise data from `%APPDATA%\Billwise` into `BillwiseData` the first time it starts, if the portable data folder does not already exist.

## Build on Windows

1. Install Node.js (which includes npm).
2. Double-click `build-windows.bat` from the BillTrackerApp folder.
3. When the build completes, use the `dist\Billwise Portable` folder for a moveable copy. The installer is also available directly in `dist`.

The first build downloads Electron and packaging dependencies from npm, so it needs an internet connection. Once built, Billwise runs locally and does not need internet access for its fonts or bill data.
