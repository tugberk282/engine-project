import { GameObject } from '../engine/GameObject';
import { Camera } from '../engine/components/Camera';
import { Light, LightType } from '../engine/components/Light';
import { MeshRenderer } from '../engine/components/MeshRenderer';
import { MeshFilter } from '../engine/components/MeshFilter';
import { AudioSource } from '../engine/components/AudioSource';
import { AudioListener } from '../engine/components/AudioListener';
import { Canvas } from '../engine/components/Canvas';
import { RectTransform } from '../engine/components/RectTransform';
import { UIImage } from '../engine/components/UIImage';
import { UIText } from '../engine/components/UIText';
import { UIButton } from '../engine/components/UIButton';
import { UIInputField } from '../engine/components/UIInputField';
import { UIDropdown } from '../engine/components/UIDropdown';
import { UIToggle } from '../engine/components/UIToggle';
import { UISlider } from '../engine/components/UISlider';
import { UIScrollbar } from '../engine/components/UIScrollbar';
import { UIScrollRect } from '../engine/components/UIScrollRect';

export type FallbackComponentType =
    | 'Camera'
    | 'Directional Light'
    | 'Point Light'
    | 'Spot Light'
    | 'Audio Source'
    | 'Canvas'
    | 'Image'
    | 'Text'
    | 'Button'
    | 'Input Field'
    | 'Dropdown'
    | 'Toggle'
    | 'Slider'
    | 'Scrollbar'
    | 'Scroll View';

export function createPrimitive(type: string): GameObject {
    const go = new GameObject(type);
    const meshFilter = go.addComponent(MeshFilter);
    go.addComponent(MeshRenderer);
    meshFilter.setPrimitiveType(type as any);
    return go;
}

export function createFallbackObject(type: FallbackComponentType): GameObject {
    const go = new GameObject(type);
    switch (type) {
        case 'Camera':
            go.addComponent(Camera);
            go.addComponent(AudioListener);
            break;
        case 'Directional Light': {
            const light = go.addComponent(Light);
            light.setLightType(LightType.Directional);
            break;
        }
        case 'Point Light': {
            const light = go.addComponent(Light);
            light.setLightType(LightType.Point);
            break;
        }
        case 'Spot Light': {
            const light = go.addComponent(Light);
            light.setLightType(LightType.Spot);
            light.setSpotAngle(30);
            break;
        }
        case 'Audio Source':
            go.addComponent(AudioSource);
            break;
        case 'Canvas':
            go.addComponent(Canvas);
            break;
        case 'Image':
            go.addComponent(RectTransform);
            go.addComponent(UIImage);
            break;
        case 'Text':
            go.addComponent(RectTransform);
            go.addComponent(UIText);
            break;
        case 'Button':
            go.addComponent(RectTransform);
            go.addComponent(UIButton);
            break;
        case 'Input Field':
            go.addComponent(RectTransform);
            go.addComponent(UIInputField);
            break;
        case 'Dropdown':
            go.addComponent(RectTransform);
            go.addComponent(UIDropdown);
            break;
        case 'Toggle':
            go.addComponent(RectTransform);
            go.addComponent(UIToggle);
            break;
        case 'Slider':
            go.addComponent(RectTransform);
            go.addComponent(UISlider);
            break;
        case 'Scrollbar':
            go.addComponent(RectTransform);
            go.addComponent(UIScrollbar);
            break;
        case 'Scroll View':
            go.addComponent(RectTransform);
            go.addComponent(UIScrollRect);
            break;
    }
    return go;
}
