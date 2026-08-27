export interface EditorInputOwnershipState {
    isTextEditing: boolean;
    isPlaying: boolean;
    isGameView: boolean;
}

export function editorOwnsKeyboardInput(state: EditorInputOwnershipState): boolean {
    return !state.isTextEditing && !(state.isPlaying && state.isGameView);
}
