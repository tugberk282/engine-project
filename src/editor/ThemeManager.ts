
export interface ThemeData {
    name: string;
    colors: {
        '--unity-bg-dark': string;
        '--unity-bg-main': string;
        '--unity-bg-panel': string;
        '--unity-bg-header': string;
        '--unity-bg-hover': string;
        '--unity-bg-selected': string;
        '--unity-bg-input': string;
        '--unity-border': string;
        '--unity-text': string;
        '--unity-text-dim': string;
        '--unity-accent': string;
        '--unity-input-focus': string;
    };
}

export class ThemeManager {
    private static themes: Record<string, ThemeData> = {
        'Unity Dark': {
            name: 'Unity Dark',
            colors: {
                '--unity-bg-dark': '#202020',
                '--unity-bg-main': '#383838',
                '--unity-bg-panel': '#383838',
                '--unity-bg-header': '#383838',
                '--unity-bg-hover': '#444444',
                '--unity-bg-selected': '#2c5d87',
                '--unity-bg-input': '#2a2a2a',
                '--unity-border': '#232323',
                '--unity-text': '#bdbdbd',
                '--unity-text-dim': '#969696',
                '--unity-accent': '#3a79bb',
                '--unity-input-focus': '#3a79bb'
            }
        },
        'Unity Light': {
            name: 'Unity Light',
            colors: {
                '--unity-bg-dark': '#a4a4a4',
                '--unity-bg-main': '#cbcbcb',
                '--unity-bg-panel': '#cbcbcb',
                '--unity-bg-header': '#cbcbcb',
                '--unity-bg-hover': '#b4b4b4',
                '--unity-bg-selected': '#3a79bb',
                '--unity-bg-input': '#e4e4e4',
                '--unity-border': '#919191',
                '--unity-text': '#050505',
                '--unity-text-dim': '#444444',
                '--unity-accent': '#2c5d87',
                '--unity-input-focus': '#2c5d87'
            }
        },
        'Midnight': {
            name: 'Midnight',
            colors: {
                '--unity-bg-dark': '#0b0e14',
                '--unity-bg-main': '#151921',
                '--unity-bg-panel': '#151921',
                '--unity-bg-header': '#1c212b',
                '--unity-bg-hover': '#2d3343',
                '--unity-bg-selected': '#ff7b72',
                '--unity-bg-input': '#0b0e14',
                '--unity-border': '#30363d',
                '--unity-text': '#c9d1d9',
                '--unity-text-dim': '#8b949e',
                '--unity-accent': '#ff7b72',
                '--unity-input-focus': '#ff7b72'
            }
        },
        'Oceanic': {
            name: 'Oceanic',
            colors: {
                '--unity-bg-dark': '#1b2b34',
                '--unity-bg-main': '#213038',
                '--unity-bg-panel': '#213038',
                '--unity-bg-header': '#343d46',
                '--unity-bg-hover': '#4f5b66',
                '--unity-bg-selected': '#6699cc',
                '--unity-bg-input': '#1b2b34',
                '--unity-border': '#343d46',
                '--unity-text': '#d8dee9',
                '--unity-text-dim': '#a7adba',
                '--unity-accent': '#fac863',
                '--unity-input-focus': '#fac863'
            }
        }
    };

    public static applyTheme(themeName: string) {
        const theme = this.themes[themeName];
        if (!theme) return;

        const root = document.documentElement;
        Object.entries(theme.colors).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });

        localStorage.setItem('tugberkengine_theme', themeName);
    }

    public static getThemes(): string[] {
        return Object.keys(this.themes);
    }

    public static getCurrentTheme(): string {
        return localStorage.getItem('tugberkengine_theme') || 'Unity Dark';
    }

    public static init() {
        const saved = this.getCurrentTheme();
        this.applyTheme(saved);
    }
}
