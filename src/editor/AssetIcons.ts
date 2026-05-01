const svgIcon = (paths: string, viewBox = '0 0 24 24') =>
    `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;

export const AssetIcons = {
    Folder: svgIcon(`
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l1.5 2H19.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9Z" fill="#c9a34a"/>
        <path d="M3 9.5A1.5 1.5 0 0 1 4.5 8h15A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-7Z" fill="#d8b15a"/>
    `),
    Script: svgIcon(`
        <rect x="5" y="3.5" width="14" height="17" rx="1.5" fill="#74a4ff"/>
        <path d="M9 8h6M9 11h6M9 14h4" stroke="#112240" stroke-width="1.5" stroke-linecap="round"/>
    `),
    Scene: svgIcon(`
        <rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="#4f7db7"/>
        <path d="M7.5 15.5l3.2-3.6 2.5 2.8 2.3-2.6 1.9 3.4H7.5Z" fill="#d9ecff"/>
        <circle cx="9" cy="9" r="1.4" fill="#ffd166"/>
    `),
    Prefab: svgIcon(`
        <path d="M12 3.5 18.5 7v10L12 20.5 5.5 17V7L12 3.5Z" fill="#63a6ff"/>
        <path d="M12 3.5V12m0 0 6.5-5M12 12 5.5 7M12 12v8.5" stroke="#0c274b" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    Material: svgIcon(`
        <rect x="4" y="4" width="16" height="16" rx="3" fill="#7a63ff"/>
        <path d="M7 14.5c2.2-4.5 7.8-4.5 10 0" stroke="#f6f0ff" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="9" cy="9" r="1.2" fill="#f6f0ff"/>
        <circle cx="15" cy="9" r="1.2" fill="#f6f0ff"/>
    `),
    Image: svgIcon(`
        <rect x="4" y="4" width="16" height="16" rx="2" fill="#4ea0b8"/>
        <path d="M7 16l3.3-3.5 2.5 2.4 2.2-2.8L17 16H7Z" fill="#dff7ff"/>
        <circle cx="9" cy="8.5" r="1.4" fill="#fff4b8"/>
    `),
    Audio: svgIcon(`
        <path d="M6 10h3.2L13 6.8v10.4L9.2 14H6V10Z" fill="#5ec27f"/>
        <path d="M15.5 9.2a4.5 4.5 0 0 1 0 5.6M17.8 7.2a7.4 7.4 0 0 1 0 9.6" stroke="#e8fff0" stroke-width="1.5" stroke-linecap="round"/>
    `),
    Font: svgIcon(`
        <rect x="4" y="4" width="16" height="16" rx="2" fill="#d27a42"/>
        <path d="M8 16 12 8l4 8M9.4 13.2h5.2" stroke="#fff2e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    File: svgIcon(`
        <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z" fill="#8b94a8"/>
        <path d="M14 3.5V8h4" stroke="#e6ecff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    Unknown: svgIcon(`
        <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" fill="#707780"/>
        <path d="M11.2 14.8h1.6M10.7 10.1a1.5 1.5 0 1 1 2.6 1c-.5.5-1 .8-1.3 1.5" stroke="#eef2f6" stroke-width="1.5" stroke-linecap="round"/>
    `)
};
