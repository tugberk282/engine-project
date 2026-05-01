export class PathUtils {
    public static normalize(targetPath: string): string {
        if (!targetPath) return '';
        return targetPath.replace(/[\\/]+/g, '/');
    }

    public static join(...segments: string[]): string {
        const filtered = segments.filter((segment) => typeof segment === 'string' && segment.length > 0);
        if (filtered.length === 0) return '';

        const normalized = filtered
            .map((segment, index) => index === 0 ? segment.replace(/[\\/]+$/g, '') : segment.replace(/^[\\/]+|[\\/]+$/g, ''))
            .filter((segment) => segment.length > 0);

        if (normalized.length === 0) return '';

        const first = normalized[0];
        const rest = normalized.slice(1);
        const joined = rest.length > 0 ? `${first}/${rest.join('/')}` : first;
        return joined.replace(/\//g, '\\');
    }

    public static basename(targetPath: string, suffix?: string): string {
        const normalized = this.normalize(targetPath).replace(/\/+$/g, '');
        const lastSlash = normalized.lastIndexOf('/');
        let base = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
        if (suffix && base.toLowerCase().endsWith(suffix.toLowerCase())) {
            base = base.slice(0, -suffix.length);
        }
        return base;
    }

    public static dirname(targetPath: string): string {
        const normalized = this.normalize(targetPath).replace(/\/+$/g, '');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash <= 0) {
            if (/^[A-Za-z]:/.test(normalized)) {
                return `${normalized.slice(0, 2)}\\`;
            }
            return '.';
        }
        return normalized.slice(0, lastSlash).replace(/\//g, '\\');
    }

    public static extname(targetPath: string): string {
        const base = this.basename(targetPath);
        const dotIndex = base.lastIndexOf('.');
        return dotIndex > 0 ? base.slice(dotIndex) : '';
    }

    public static relative(fromPath: string, toPath: string): string {
        const from = this.normalize(fromPath).split('/').filter(Boolean);
        const to = this.normalize(toPath).split('/').filter(Boolean);

        if (from.length > 0 && to.length > 0 && /^[A-Za-z]:$/.test(from[0]) && /^[A-Za-z]:$/.test(to[0]) && from[0].toLowerCase() !== to[0].toLowerCase()) {
            return toPath;
        }

        let commonIndex = 0;
        while (
            commonIndex < from.length &&
            commonIndex < to.length &&
            from[commonIndex].toLowerCase() === to[commonIndex].toLowerCase()
        ) {
            commonIndex++;
        }

        const up = new Array(Math.max(0, from.length - commonIndex)).fill('..');
        const down = to.slice(commonIndex);
        const parts = [...up, ...down];
        return parts.length > 0 ? parts.join('/') : '.';
    }
}
