import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPlayerSceneLoadActions, collectPlayerUiControls, collectPlayerUiText } from '../electron/build/player-ui.mjs';

test('player UI collector preserves authored control values and RectTransform layout', () => {
    const scene = {
        gameObjects: [{
            id: 'menu',
            components: [{ type: 'RectTransform', data: { sizeDelta: [320, 80], anchoredPosition: [12, -8], anchorMin: [0, 1] } },
                { type: 'UIButton', data: { label: 'Play', eventName: 'Start' } }],
            children: [{
                id: 'difficulty',
                components: [{ type: 'UIDropdown', data: { options: ['Easy', 'Hard'], selectedIndex: 1, eventName: 'Difficulty' } }]
            }]
        }]
    };
    const controls = collectPlayerUiControls(scene);
    assert.equal(controls.length, 2);
    assert.equal(controls[0].eventName, 'Start');
    assert.equal(controls[0].layout.width, 320);
    assert.equal(controls[0].layout.anchorY, 1);
    assert.deepEqual(Array.from(controls[1].options), ['Easy', 'Hard']);
    assert.equal(controls[1].selectedIndex, 1);
});

test('player UI text collector preserves authored style and layout', () => {
    const scene = {
        gameObjects: [{
            id: 'status',
            components: [
                { type: 'RectTransform', data: { sizeDelta: [200, 30], anchoredPosition: [4, 5], anchorMin: [0.5, 0.5] } },
                { type: 'UIText', data: { text: 'Ready', fontSize: 22, color: '#ffcc00', alignment: 'center' } }
            ]
        }]
    };
    const text = collectPlayerUiText(scene);
    assert.equal(text.length, 1);
    assert.equal(text[0].text, 'Ready');
    assert.equal(text[0].fontSize, 22);
    assert.equal(text[0].color, '#ffcc00');
    assert.equal(text[0].alignment, 'center');
    assert.equal(text[0].layout.width, 200);
});

test('player scene action collector finds enabled nested LoadScene actions', () => {
    const actions = collectPlayerSceneLoadActions({ gameObjects: [{
        id: 'menu', components: [{ type: 'UIEventAction', data: { action: 'SetActive', eventName: 'Ignore' } }], children: [
            { id: 'play', components: [{ type: 'UIEventAction', data: { action: 'LoadScene', eventName: 'Play', scenePath: 'Assets\\Scenes\\Level.scene.json' } }] },
            { id: 'disabled', components: [{ type: 'UIEventAction', enabled: false, data: { action: 'LoadScene', eventName: 'Bad', scenePath: '../bad' } }] }
        ]
    }] });
    assert.deepEqual(actions, [{ eventName: 'Play', scenePath: 'Assets/Scenes/Level.scene.json' }]);
});
