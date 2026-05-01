import { Component } from '../Component';
import { serialize } from '../Decorators';

export class CanvasGroup extends Component {
    @serialize public alpha: number = 1;
    @serialize public interactable: boolean = true;
    @serialize public blocksRaycasts: boolean = true;
    @serialize public ignoreParentGroups: boolean = false;
}
