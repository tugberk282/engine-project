'use strict';

const parameters = new URLSearchParams(window.location.search);
document.getElementById('message').textContent = parameters.get('message') || 'The player could not start.';
document.getElementById('code').textContent = parameters.get('code') || 'PLAYER_STARTUP_FAILED';
