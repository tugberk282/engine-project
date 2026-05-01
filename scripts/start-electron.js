const { spawn } = require('child_process');
const electronPath = require('electron');

console.log("Wrapper script launching Electron from:", electronPath);

// Forcefully delete the variable that causes Electron to run as Node
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

// Spawn the actual Electron process without the poisoned variable
const child = spawn(electronPath, ['.'], {
    env,
    stdio: 'inherit',
    windowsHide: false
});

child.on('close', (code) => {
    process.exit(code || 0);
});
