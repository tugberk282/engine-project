import { Command } from './Command';
import {
    DesktopBridge,
    type ProjectAssetTransactionRequest
} from '../platform/DesktopBridge';

export class ProjectAssetCommand implements Command {
    public readonly name: string;
    private readonly bridge: DesktopBridge;
    private readonly request: Extract<ProjectAssetTransactionRequest, { action: 'apply' }>;
    private readonly onStateChanged: (state: 'applied' | 'undone') => Promise<void>;

    constructor(
        name: string,
        request: Extract<ProjectAssetTransactionRequest, { action: 'apply' }>,
        onStateChanged: (state: 'applied' | 'undone') => Promise<void>
    ) {
        this.name = name;
        this.request = request;
        this.onStateChanged = onStateChanged;
        this.bridge = new DesktopBridge();
    }

    public async execute(): Promise<void> {
        await this.bridge.transactProjectAsset(this.request);
        await this.onStateChanged('applied');
    }

    public async undo(): Promise<void> {
        await this.bridge.transactProjectAsset({
            contractVersion: 1,
            grantId: this.request.grantId,
            transactionId: this.request.transactionId,
            action: 'undo'
        });
        await this.onStateChanged('undone');
    }
}
