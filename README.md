# Billwise

Billwise is a desktop app for tracking monthly bills on Windows. It keeps your bill list, payment status, and monthly records locally on your computer. It does not require an online account.

## Install and open

### Installer

1. Run `Billwise-Setup-1.0.0.exe`.
2. Follow the setup prompts. You can choose where to install Billwise and whether to create shortcuts.
3. Open Billwise from the Start menu or desktop shortcut.

### Portable version

1. Open the `Billwise Portable` folder.
2. Run `Billwise-Portable.exe`.

The portable app stores its data in a `BillwiseData` folder beside the executable. To move it to another location or computer, close Billwise and copy the whole folder, including `BillwiseData` if it exists. On first launch, the portable version can copy existing data from `%APPDATA%\Billwise` if `BillwiseData` does not exist yet.

## Use Billwise

1. Choose a month with the month picker or the previous and next arrows. Select **Today** to return to the current month.
2. Select **Add a bill** to enter a bill name, amount, due day, category, and optional note. Select **Save bill**.
3. Select **List** or **Calendar** to change how bills are displayed. Use the **All bills**, **To pay**, and **Paid** filters or the search box to find bills.
4. Select **Mark paid** on a bill when you pay it. Select it again to mark the bill unpaid.
5. Select the pencil icon on a bill to edit it. You can update its amount for the selected month, or remove it from that month.

Amounts are stored by month, so changing a bill's amount for one month does not change other months. Billwise starts with a generic sample bill list that you can edit or remove.

## Your data and backups

Billwise saves data locally. For the installed version, its data is stored under `%APPDATA%\Billwise`. For the portable version, it is stored under `BillwiseData` beside the executable. To back up or move your records, close Billwise first, then copy the relevant data folder. Keep the backup somewhere safe; the app does not upload or synchronize your bills.

## Build from source

To build the Windows installer and portable app yourself:

1. Install 64-bit [Node.js](https://nodejs.org/), which includes npm.
2. Open a terminal in this project folder.
3. Run `npm install` to download the build dependencies. An internet connection is needed for this first step.
4. Run `npm run dist:win` to create the installer and portable executable in `dist`.

On Windows, you can instead double-click `build-windows.bat`; it installs dependencies if needed, builds the packages, and prepares the `dist\Billwise Portable` folder.

To run the app in development mode, run `npm install` and then `npm start` from the project folder.

## Requirements

- Windows 10 or later, 64-bit, for the packaged installer and portable app.
- Internet access is needed to install build dependencies. The built app runs locally without an internet connection.
