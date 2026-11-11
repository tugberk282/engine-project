import { ScriptRegistry } from './ScriptRegistry';
import { RigidBody } from './components/RigidBody';
import { MeshRenderer } from './components/MeshRenderer';
import { EditorCameraController } from './components/EditorCameraController';
import { AudioSource } from './components/AudioSource';
import { AudioListener } from './components/AudioListener';
import { ParticleSystem } from './components/ParticleSystem';
import { Camera } from './components/Camera';
import { Light } from './components/Light';
import { Animator } from './components/Animator';
import { BoxCollider } from './components/BoxCollider';
import { CapsuleCollider } from './components/CapsuleCollider';
import { SphereCollider } from './components/SphereCollider';
import { MeshFilter } from './components/MeshFilter';
import { Canvas } from './components/Canvas';
import { CanvasGroup } from './components/CanvasGroup';
import { EventSystem } from './components/EventSystem';
import { GraphicRaycaster } from './components/GraphicRaycaster';
import { RectTransform } from './components/RectTransform';
import { UIImage } from './components/UIImage';
import { UIText } from './components/UIText';
import { UIButton } from './components/UIButton';
import { UIInputField } from './components/UIInputField';
import { UIDropdown } from './components/UIDropdown';
import { ToggleGroup } from './components/ToggleGroup';
import { UIToggle } from './components/UIToggle';
import { UISlider } from './components/UISlider';
import { UIScrollbar } from './components/UIScrollbar';
import { UIScrollRect } from './components/UIScrollRect';
import { VerticalLayoutGroup } from './components/VerticalLayoutGroup';
import { HorizontalLayoutGroup } from './components/HorizontalLayoutGroup';
import { ContentSizeFitter } from './components/ContentSizeFitter';
import { UIEventAction } from './components/UIEventAction';
import { BehaviourScript } from './components/BehaviourScript';

let registered = false;

export function registerBuiltinComponents(): void {
    if (registered) return;
    registered = true;

    const entries: Array<[string, any, 'Physics' | 'Rendering' | 'UI' | 'Audio' | 'Animation' | 'Scripting' | 'Utility']> = [
        ['MeshRenderer', MeshRenderer, 'Rendering'], ['MeshFilter', MeshFilter, 'Rendering'], ['EditorCameraController', EditorCameraController, 'Rendering'],
        ['Camera', Camera, 'Rendering'], ['Light', Light, 'Rendering'],
        ['Canvas', Canvas, 'UI'], ['CanvasGroup', CanvasGroup, 'UI'], ['GraphicRaycaster', GraphicRaycaster, 'UI'], ['EventSystem', EventSystem, 'UI'],
        ['RectTransform', RectTransform, 'UI'], ['UIImage', UIImage, 'UI'], ['UIText', UIText, 'UI'], ['UIButton', UIButton, 'UI'],
        ['UIInputField', UIInputField, 'UI'], ['UIDropdown', UIDropdown, 'UI'], ['ToggleGroup', ToggleGroup, 'UI'], ['UIToggle', UIToggle, 'UI'],
        ['UISlider', UISlider, 'UI'], ['UIScrollbar', UIScrollbar, 'UI'], ['UIScrollRect', UIScrollRect, 'UI'],
        ['VerticalLayoutGroup', VerticalLayoutGroup, 'UI'], ['HorizontalLayoutGroup', HorizontalLayoutGroup, 'UI'], ['ContentSizeFitter', ContentSizeFitter, 'UI'],
        ['UIEventAction', UIEventAction, 'Utility'],
        ['BehaviourScript', BehaviourScript, 'Scripting'],
        ['RigidBody', RigidBody, 'Physics'], ['BoxCollider', BoxCollider, 'Physics'], ['SphereCollider', SphereCollider, 'Physics'], ['CapsuleCollider', CapsuleCollider, 'Physics'],
        ['AudioSource', AudioSource, 'Audio'], ['AudioListener', AudioListener, 'Audio'],
        ['ParticleSystem', ParticleSystem, 'Animation'], ['Animator', Animator, 'Animation']
    ];

    entries.forEach(([name, componentClass, category]) => ScriptRegistry.registerWithCategory(componentClass, category, name));
}
