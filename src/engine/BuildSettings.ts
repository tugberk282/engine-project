/**
 * BuildSettings - Unity-style build configuration
 */
export class BuildSettings {
    public static scenes: string[] = ['MainScene'];
    public static platform: 'WebGL' | 'Windows' | 'Mac' | 'Linux' = 'WebGL';
    public static developmentBuild: boolean = false;
    public static compressionFormat: 'Gzip' | 'Brotli' | 'Disabled' = 'Gzip';
    public static codeOptimization: 'Debug' | 'Release' = 'Release';

    // WebGL Settings
    public static webGLTemplate: string = 'Default';
    public static webGLMemorySize: number = 256; // MB
    public static webGLExceptionSupport: 'None' | 'Explicitly Thrown' | 'Full' = 'Explicitly Thrown';

    // Build Output
    public static outputPath: string = './dist';
    public static productName: string = 'TugberkEngine Game';
    public static companyName: string = 'Tugberk Studio';
    public static version: string = '1.0.0';

    public static build(): void {
        console.log('🔨 Building project...');
        console.log(`Platform: ${this.platform}`);
        console.log(`Scenes: ${this.scenes.join(', ')}`);
        console.log(`Output: ${this.outputPath}`);

        // In a real implementation, this would trigger Vite build
        // For now, just log the settings
        console.log('✅ Build configuration ready');
        console.log('Run: npm run build');
    }

    public static save(): void {
        const settings = {
            scenes: this.scenes,
            platform: this.platform,
            developmentBuild: this.developmentBuild,
            compressionFormat: this.compressionFormat,
            productName: this.productName,
            companyName: this.companyName,
            version: this.version
        };
        localStorage.setItem('tugberkengine_build_settings', JSON.stringify(settings));
    }

    public static load(): void {
        const saved = localStorage.getItem('tugberkengine_build_settings');
        if (saved) {
            const settings = JSON.parse(saved);
            Object.assign(this, settings);
        }
    }
}
