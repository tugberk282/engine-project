# Engine Project - Inspector System DetaylÄ± Analizi

**Tarih**: 2026-04-20  
**Faz**: Phase 6 (Inspector Parity) HazÄ±rlÄ±k  
**HazÄ±rlayanlar**: Component Header & Property Rendering System Analysis

---

## 1. INSPECTOR WINDOW MIMARISI

### 1.1 Genel YapÄ± (src/editor/InspectorWindow.ts)

```
InspectorWindow (EditorWindow extends)
â”œâ”€â”€ Selection System
â”‚   â”œâ”€â”€ GameObjects
â”‚   â”œâ”€â”€ Assets
â”‚   â”œâ”€â”€ ScriptableObjects
â”‚   â””â”€â”€ Materials
â”œâ”€â”€ Rendering Layers
â”‚   â”œâ”€â”€ GameObject Header
â”‚   â”œâ”€â”€ Prefab Bar (koÅŸullu)
â”‚   â”œâ”€â”€ Override Summary (koÅŸullu)
â”‚   â”œâ”€â”€ Components (loop)
â”‚   â””â”€â”€ Add Component Button
â””â”€â”€ State Management
    â”œâ”€â”€ collapsedComponents: Set<string>
    â””â”€â”€ prefabApplyTargetRootIds: Map
```

### 1.2 Rendering Pipeline

**onGUI() AkÄ±ÅŸÄ±**:
1. Selection kontrolÃ¼ (null â†’ Scene Inspector)
2. Type check (GameObject / Asset / ScriptableObject / Material)
3. Ä°lgili renderer metoduna dispatch
4. Full refresh dÃ¶ngÃ¼sÃ¼ (HTML innerHTML sÄ±fÄ±rla)

**NOT**: Her refresh'te DOM tam yeniden oluÅŸturulur â†’ performans riski var (Phase 6'da optimize edilebilir)

---

## 2. COMPONENT HEADER SISTEMI

### 2.1 Header ElemanlarÄ±

```typescript
// src/editor/InspectorWindow.ts ~ Line 520-600
Header YapÄ±sÄ±:
â”œâ”€â”€ Foldout Toggle (â–º/â–¼)
â”œâ”€â”€ Enabled Checkbox
â”œâ”€â”€ Component Name (span)
â”œâ”€â”€ Override Badge (koÅŸullu, "Added" / "Override")
â”œâ”€â”€ Spacer (flex: 1)
â””â”€â”€ Context Menu Button (â‹®)

Header Stili:
- background: var(--unity-component-header)
- border: 1px solid var(--unity-border)
- cursor: grab (draggable)
- display: flex, alignItems: center
- padding: 2px 4px
- fontSize: 11px, fontWeight: bold
```

### 2.2 Foldout DavranÄ±ÅŸÄ±

**Collapse State Tracking**:
```typescript
private collapsedComponents: Set<string> = new Set();

// Toggle Logic
header.onclick = () => {
    if (isCollapsed) 
        this.collapsedComponents.delete(compId);
    else 
        this.collapsedComponents.add(compId);
    this.refresh();
};
```

**Sorun**: 
- Set bellekte tutulur â†’ Scene kapatÄ±ldÄ±ÄŸÄ±nda kayboluyor
- EditorSettings'e persist edilmemiÅŸ

### 2.3 Override Badge Sistemi

```typescript
// src/editor/InspectorWindow.ts ~ Line 561-570
const componentOverrideStatus = window.Editor?.instance?.getPrefabComponentStatus?.(comp);

if (componentOverrideStatus !== 'default') {
    // Badge render
    badge.innerText = componentOverrideStatus === 'added' ? 'Added' : 'Override';
    badge.style.color = componentOverrideStatus === 'added' ? '#c6f6d5' : '#d6ebff';
    badge.style.background = componentOverrideStatus === 'added' 
        ? 'rgba(56, 161, 105, 0.28)' 
        : 'rgba(79, 164, 255, 0.22)';
}
```

### 2.4 Drag-Drop Component Reordering

```typescript
header.ondragstart = (e) => {
    const compIdx = go.components.indexOf(comp);
    e.dataTransfer!.setData('text/plain', 
        JSON.stringify({ type: 'component-reorder', index: compIdx })
    );
};

compContainer.ondrop = (e) => {
    const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
    CommandHistory.execute(new ReorderComponentCommand(go, fromIdx, toIdx));
};
```

---

## 3. PROPERTY FIELD RENDERING SISTEMI

### 3.1 EditorInspectors.ts - Genel Mimari

**Ä°ki Rendering Stratejisi**:

1. **Specialized Inspector** (Component-Specific)
   - `createTransformInspector()`
   - `createCameraInspector()`
   - `createLightInspector()`
   - `createAudioSourceInspector()`
   - `createMeshRendererInspector()`
   - vb.

2. **Auto Inspector** (Reflection-Based)
   ```typescript
   public createAutoInspector(parent: HTMLElement, target: any): void {
       const fields = target.constructor._serializableFields || [];
       
       fields.forEach(field => {
           const value = target[field];
           const type = typeof value;
           
           // Type-based field creation
           if (type === 'number') this.createUnityField(...);
           else if (type === 'string') this.createUnityField(...);
           else if (type === 'boolean') this.createUnityCheckbox(...);
           else if (isVector) this.createVector3Field(...);
           else if (isObject) this.createUnityObjectField(...);
       });
   }
   ```

### 3.2 Built-in Field Types

#### Vector Fields
```typescript
createVector3Field(parent, label, vector, callback, target, propertyKey)
- Position, Rotation, Scale (Transform)
- x, y, z input fields side-by-side
- Real-time change callbacks dengan undo/redo

createVector2Field(parent, label, vector2, callback, target, propertyKey)
- AnchoredPosition, SizeDelta, Pivot (RectTransform)
```

#### Color Fields
```typescript
createUnityColorField(parent, label, colorValue, onChange, target)
- Color picker input
- Hex format (#RRGGBB)
- Real-time preview
```

#### Slider Fields
```typescript
createUnitySlider(parent, label, currentValue, min, max, onChange, target, propertyKey)
- Min/Max range validation
- Real-time value display
- Used: Bloom, SSAO, Audio Volume, etc.
```

#### Dropdown Fields
```typescript
createUnityDropdown(parent, label, options[], selectedValue, onChange, target, propertyKey)
- Light Type: Directional/Point/Spot/Ambient
- Projection: Perspective/Orthographic
- Fog Mode: Linear/Exp2
```

#### Checkbox Fields
```typescript
createUnityCheckbox(parent, label, checkedValue, onChange, target, propertyKey)
- Boolean toggles
- Enabled/Disabled checkboxes
```

#### Object Reference Fields
```typescript
createUnityObjectField(parent, label, value, onChange, target, propertyKey)
- GameObject/Component references
- Drag & drop support
- Shows "None (Object)" placeholder
```

### 3.3 Inline Editing Mechanism

**Property Change Flow**:
```
User Input â†’ onChange Callback
    â†“
Store Old Value â†’ Execute Command
    â†“
CommandHistory.execute({
    name: 'Change X',
    execute: () => {
        target.property = newValue;
        recordOverride(target, propertyKey);
        notifyChange(target);
    },
    undo: () => {
        target.property = oldValue;
        notifyChange(target);
    }
})
    â†“
refreshSelected?.() â†’ Inspector refresh
```

### 3.4 Override Styling

```typescript
private setLabelOverrideStyle(labelElement, target, propertyKey) {
    let isOverridden = target.overrides?.has(propertyKey);
    
    // Editor system check
    const editor = window.Editor?.instance;
    if (editor?.isPropertyOverridden) {
        isOverridden = isOverridden || editor.isPropertyOverridden(target, propertyKey);
    }
    
    if (isOverridden) {
        labelElement.style.fontWeight = 'bold';
        labelElement.style.color = 'var(--unity-accent-light, #5cacee)';
    } else {
        labelElement.style.fontWeight = 'normal';
        labelElement.style.color = 'var(--unity-text-dim)';
    }
}
```

---

## 4. COMPONENT RENDERER MAPPING

### 4.1 Conditional Routing (InspectorWindow.ts ~ Line 600-650)

```typescript
const compName = comp.constructor.name;

// Specialized Inspectors
if (compName === 'Transform') 
    this.inspectors.createTransformInspector(sectionContent, comp);
else if (compName === 'RectTransform')
    this.inspectors.createRectTransformInspector(sectionContent, comp);
else if (compName === 'Canvas')
    this.inspectors.createCanvasInspector(sectionContent, comp);
else if (compName === 'Camera')
    this.inspectors.createCameraInspector(sectionContent, comp);
else if (compName === 'Light')
    this.inspectors.createLightInspector(sectionContent, comp);
else if (compName === 'AudioSource')
    this.inspectors.createAudioSourceInspector(sectionContent, comp);
else if (compName === 'Animator')
    this.inspectors.createAnimatorInspector(sectionContent, comp);
else if (compName === 'MeshRenderer')
    this.inspectors.createMeshRendererInspector(sectionContent, comp);
else if (compName === 'RigidBody' || compName === 'BoxCollider' || ...)
    // Various handlers
else
    // Default: Auto-inspector
    this.inspectors.createAutoInspector(sectionContent, comp);
```

### 4.2 Built-in Component Inspector Ã–rnekleri

#### Transform Inspector
- Position (Vector3 field)
- Rotation (Vector3 field)
- Scale (Vector3 field)
- No enabled checkbox (Transform always enabled)

#### Camera Inspector
- Clear Flags (dropdown)
- Background Color (color field)
- Projection (Perspective/Orthographic dropdown)
- Field of View (slider) / Orthographic Size (field)
- Near/Far Clipping Planes
- Depth
- Culling Mask (checkboxes for layers)

#### Light Inspector
- Type (dropdown)
- Color (color field)
- Intensity (slider 0-8)
- Range (slider, Point/Spot only)
- Spot Angle (slider, Spot only)
- Shadows (checkboxes)

#### Audio Source Inspector
- Audio Clip (text field, path)
- Volume (slider 0-1)
- Pitch (slider 0.5-2)
- Spatial (3D) (checkbox)
- Loop (checkbox)
- Play/Stop buttons

#### Particle System Inspector
- Emission Rate (number field)
- Start Lifetime (number field)
- Start Size (slider)
- Texture Path (text field)
- Loop (checkbox)
- Play/Stop buttons

#### Material Inspector
- Shader (dropdown)
- Alpha Mode (dropdown)
- Alpha Cutoff (slider, if Cutout mode)
- Main Maps section:
  - Albedo (color + texture slot)
  - Metallic/Smoothness (slider + texture slot)
  - Normal Map (texture slot)
- Emission section (color + intensity slider)

---

## 5. ADD COMPONENT MENU SISTEMI

### 5.1 Menu YapÄ±sÄ±

```typescript
// src/editor/InspectorWindow.ts ~ Line 800-900
showAddComponentMenu(anchor, go) {
    â”œâ”€â”€ Fixed position dropdown (anchor bottom)
    â”œâ”€â”€ Search Input
    â”‚   â””â”€â”€ oninput â†’ filterList()
    â”œâ”€â”€ Scrollable List Container
    â”‚   â”œâ”€â”€ Filter: nama.toLowerCase().includes(query.toLowerCase())
    â”‚   â”œâ”€â”€ Filter: exclude Transform/RectTransform
    â”‚   â”œâ”€â”€ Hide already present components (opacity 0.5, âœ“ mark)
    â”‚   â””â”€â”€ Click â†’ AddComponentCommand
    â””â”€â”€ "No components found" message
}
```

### 5.2 Component Discovery

```typescript
const allComponents = ScriptRegistry.getAddableComponentNames().sort();
const existingComponents = go.components.map(c => c.constructor.name);

// Render logic
filtered.forEach(name => {
    const isAlreadyPresent = existingComponents.includes(name);
    if (isAlreadyPresent) {
        item.style.opacity = '0.5';
        item.appendChild(checkmark);
    }
});
```

**Eksiklik**: 
- Kategori yok (Physics, Rendering, UI, etc.)
- Favori sistem yok
- Recently used tracking yok

---

## 6. PREFAB OVERRIDE SYSTEM

### 6.1 Prefab Bar

```typescript
// src/editor/InspectorWindow.ts ~ Line 160-200
Prefab Bar GÃ¶sterimi:
â”œâ”€â”€ Title: "Prefab: {assetLabel}"
â”œâ”€â”€ Target Node: {nodeLabel}
â”œâ”€â”€ Context Root: {contextRootLabel}
â”œâ”€â”€ Override Status: "{count} override(s)" / "No overrides"
â”œâ”€â”€ Warnings (koÅŸullu)
â”œâ”€â”€ Buttons: [Select] [Root] [Apply] [Revert]
â””â”€â”€ Apply Target Selector (koÅŸullu)
```

### 6.2 Override Summary Section

```typescript
// src/editor/InspectorWindow.ts ~ Line 273-450
if (overrideSummary.total > 0) {
    â”œâ”€â”€ Heading: "Prefab Overrides"
    â”œâ”€â”€ Bulk Toolbar
    â”‚   â”œâ”€â”€ Summary: "{count} override(s)"
    â”‚   â””â”€â”€ Buttons: [Apply Listed] [Revert Listed]
    â”œâ”€â”€ Grouped Entries
    â”‚   â”œâ”€â”€ Section Headers (Component/Child groups)
    â”‚   â”œâ”€â”€ Per-entry rows
    â”‚   â”‚   â”œâ”€â”€ Label (primary + secondary change description)
    â”‚   â”‚   â””â”€â”€ Buttons: [Apply] [Revert/Remove/Restore]
    â”‚   â””â”€â”€ Group-level Buttons: [Apply All] [Revert All]
    â””â”€â”€ Bulk status (applied/bulk action counts)
}
```

---

## 7. MEVCUT SORUNLAR & AÃ‡IK NOKTALAR

### 7.1 Inspector Rendering Performance

**Problem**: Her refresh'te full DOM yeniden oluÅŸturulur
```typescript
onGUI(): void {
    const content = this.getContentArea();
    content.innerHTML = '';  // â† FULL CLEAR
    // ... rerender everything
}
```

**Impact**: 
- Scroll position kayboluyor
- Focus state (input) kayboluyor
- Expansion state'leri set'te tutulsa da DOM kaybolur
- 50+ component'i olan GameObject'lerde gecikme

**Ã‡Ã¶zÃ¼m**: Differential rendering (Phase 6 optimization)

### 7.2 Foldout State Persistence

**Problem**: 
```typescript
private collapsedComponents: Set<string> = new Set();
```
- Only in-memory, scene unload'da silinir
- EditorSettings'e save edilmez
- Scene switch'de state kaybolur

### 7.3 Property Label Override Detection

**Dual System Mismatch**:
```typescript
// Old system
let isOverridden = target.overrides?.has(propertyKey);

// New system
const editor = window.Editor?.instance;
if (editor?.isPropertyOverridden) {
    isOverridden = isOverridden || editor.isPropertyOverridden(target, propertyKey);
}
```
- Ä°ki sistem paralel Ã§alÄ±ÅŸÄ±yor
- Hangi sistemin source of truth olduÄŸu belirsiz
- EditorInspectors'daki override tracking eksik

### 7.4 Inline Edit Devre DÄ±ÅŸÄ± Durum

**Problem**: BirÃ§ok component inspector basitleÅŸtirilmiÅŸ
```typescript
// Example: Camera Inspector
this.createUnityDropdown(parent, 'Clear Flags', [...], 'Solid Color', (_value) => {
    // Not fully implemented in engine yet, but record anyway
    this.recordOverride(camera, 'clearFlags');
});
```

**SonuÃ§**: 
- UI changes edilebilir ama engine'de etkisi yok
- User expectations unmet

### 7.5 Add Component Search UX

**Eksik Features**:
- âœ— Category filtering (Physics/Rendering/UI/etc.)
- âœ— Recently used components
- âœ— Favorites/pinned components
- âœ— Component descriptions/tooltips
- âœ— Keyboard navigation (Tab/Enter)

### 7.6 Material Property Binding

**Problem**: Material properties inline editable ama:
- Shader deÄŸiÅŸtiÄŸinde properties refresh edilmiyor
- Custom shader properties support yok
- Real-time material preview eksik

---

## 8. PHASE 6 HAZIRLIK & GELIÅTÄ°RME PLANI

### 8.1 Primary Goals (Phase 6 Roadmap)

```
Faz 6: Inspector Parity (Planli)
â”œâ”€â”€ Header actions ve standart component inspector parity
â”œâ”€â”€ Foldout/spacing/inline edit davranislarinin Unity hissine yaklastirilmasi
â””â”€â”€ Add Component arama + kategori deneyimini derinlestirme
```

### 8.2 Implementation Roadmap

#### Stage 6.1: Component Header Enhancement
- [x] Basic header structure
- [ ] **Improved toggle visual** (bigger, more obvious)
- [ ] **Copy Component button**
- [ ] **Paste Component As New button**
- [ ] **Reset to Default button**
- [ ] **Move Component Up/Down buttons**
- [ ] Foldout state persistence (EditorSettings)
- [ ] Header overflow menu for small screens

#### Stage 6.2: Property Field Improvements
- [ ] Differential rendering (only changed fields re-render)
- [ ] Preserve focus during refresh
- [ ] Preserve scroll position
- [ ] Multi-property field grouping (sections/folders)
- [ ] Rich tooltips on hover
- [ ] Undo/redo feedback visualization

#### Stage 6.3: Add Component UX
- [ ] Category filtering sidebar
- [ ] Recently used section
- [ ] Favorites/starred components
- [ ] Component preview (description + icon)
- [ ] Search suggestions/autocomplete
- [ ] Keyboard shortcut (right-click â†’ Add)

#### Stage 6.4: Inline Editing
- [ ] Color picker dialog (not just field)
- [ ] Curve editor for animatable properties
- [ ] Multi-select property editing
- [ ] Preset dropdown for common values
- [ ] Unit system (meters/pixels/degrees awareness)

#### Stage 6.5: Material & Advanced Components
- [ ] Material property binding per-shader
- [ ] ParticleSystem curve editors
- [ ] Animator state visualization
- [ ] Audio waveform display
- [ ] Collider visualization in inspector

### 8.3 Performance Optimizations

**Current Issue**: Full DOM rebuild on every refresh
```
Current Cycle: refresh() â†’ innerHTML = '' â†’ Full rebuild (50-100ms)
Target Cycle: refresh() â†’ Delta only (5-10ms)
```

**Implementation Strategy**:
1. Render target â†’ Virtual DOM representation
2. Diff against previous state
3. Only update changed elements
4. Keep input focus/scroll state

**Key Files to Modify**:
- `src/editor/InspectorWindow.ts` â†’ Diff rendering logic
- `src/editor/EditorInspectors.ts` â†’ Memoized field generators

### 8.4 Code Quality Improvements

**Current Issues**:
- Large methods (createCameraInspector ~200 lines)
- Repetitive command pattern
- No field component reusability

**Refactoring**:
```typescript
// Instead of repeating CommandHistory.execute...
// Create reusable setter:
setPropertyWithUndo(target, propertyKey, newValue, oldValue, description)

// Field creation pattern:
createField(config: FieldConfig) â†’ automatically handle undo/redo
```

---

## 9. COMPONENT INSPECTOR DETAY TABLOSU

| Component | Implemented | Inline Edit | Issues |
|-----------|-------------|------------|--------|
| Transform | âœ“ | âœ“ | None |
| RectTransform | âœ“ | âœ“ | None |
| Camera | âœ“ | ~ | Clear Flags not implemented |
| Light | âœ“ | âœ“ | Range/Angle only for Point/Spot |
| AudioSource | âœ“ | âœ“ | 3D spatial not visualized |
| AudioListener | âœ“ | N/A | Info-only |
| ParticleSystem | âœ“ | ~ | No curve editing |
| Animator | âœ“ | âœ“ | Animation list click interaction |
| MeshFilter | âœ“ | âœ“ | None |
| MeshRenderer | âœ“ | âœ“ | Material slot missing |
| RigidBody | ? | ? | Need inspection |
| Collider | âœ“ | âœ“ | No visualization |
| Canvas | âœ“ | âœ“ | None |
| UIImage | âœ“ | âœ“ | Sprite visualization missing |
| UIButton | âœ“ | âœ“ | Event binding missing |
| UIText | âœ“ | âœ“ | Text preview missing |
| Material | âœ“ | ~ | Shader-specific props missing |
| Auto (Generic) | âœ“ | âœ“ | Works via reflection |

---

## 10. IMPLEMENTATION PATTERNS

### 10.1 Specialized Inspector Pattern

```typescript
public createXyzComponentInspector(parent: HTMLElement, component: any): void {
    // 1. Group-related properties
    this.createUnityField(parent, 'Property1', 'type', component.property1, (v) => {
        const oldVal = component.property1;
        CommandHistory.execute({
            name: 'Change Property1',
            execute: () => {
                component.property1 = v;
                this.recordOverride(component, 'property1');
                this.notifyChange(component);
            },
            undo: () => {
                component.property1 = oldVal;
                this.notifyChange(component);
            }
        });
    }, component);

    // 2. Separator (if needed)
    const hr = document.createElement('hr');
    hr.style.cssText = 'border: 0; border-top: 1px solid var(--unity-border); margin: 8px 0;';
    parent.appendChild(hr);

    // 3. Next group
    ...
}
```

### 10.2 Vector Field Pattern

```typescript
this.createVector3Field(parent, 'Position', transform.position, (axis, val) => {
    const oldVal = transform.position[axis];
    CommandHistory.execute({
        name: `Move ${axis}`,
        execute: () => {
            transform.position[axis] = val;
            this.recordOverride(transform, 'position');
            this.notifyChange(transform);
        },
        undo: () => {
            transform.position[axis] = oldVal;
            this.notifyChange(transform);
        }
    });
}, transform, 'position');
```

### 10.3 Checkbox Pattern

```typescript
this.createUnityCheckbox(parent, 'Cast Shadows', renderer.castShadow, (checked: boolean) => {
    const oldVal = renderer.castShadow;
    CommandHistory.execute({
        name: 'Toggle Cast Shadows',
        execute: () => {
            renderer.castShadow = checked;
            this.recordOverride(renderer, 'castShadow');
            this.notifyChange(renderer);
        },
        undo: () => {
            renderer.castShadow = oldVal;
            this.notifyChange(renderer);
        }
    });
}, renderer, 'castShadow');
```

---

## 11. Ä°STATÄ°STÄ°KLER & METRICS

### 11.1 Code Metrics

| Metric | Value |
|--------|-------|
| InspectorWindow.ts lines | ~900 |
| EditorInspectors.ts lines | ~2400 |
| Specialized Inspectors | 15+ |
| Auto Inspector Support | Yes (Reflection) |
| Component Handlers | 18 |

### 11.2 Feature Coverage

| Category | Coverage |
|----------|----------|
| GameObject Headers | 100% |
| Component Rendering | 95% |
| Property Editing | 90% |
| Undo/Redo Integration | 100% |
| Prefab Override UI | 100% |
| Foldout State | 50% (memory only) |
| Add Component Menu | 70% (no categories) |

### 11.3 Known Missing Features (Phase 6 Target)

- [ ] Foldout state persistence (5% effort)
- [ ] Category-based Add Component (20% effort)
- [ ] Differential rendering (25% effort)
- [ ] Component header buttons (15% effort)
- [ ] Material shader sync (20% effort)
- [ ] Advanced property editors (40% effort)

---

## 12. REFERANS KODLAR

### 12.1 Key File Locations

```
src/editor/InspectorWindow.ts
â”œâ”€â”€ Line 15-60:     Constructor & State
â”œâ”€â”€ Line 27-55:     selectGameObject / selectAsset
â”œâ”€â”€ Line 57-180:    renderGameObjectInspector (GameObject Header)
â”œâ”€â”€ Line 160-450:   Prefab Bar & Overrides
â”œâ”€â”€ Line 520-650:   Component Headers & Routing
â”œâ”€â”€ Line 550-900:   Add Component Menu
â””â”€â”€ Line 900-1100:  Context Menu

src/editor/EditorInspectors.ts
â”œâ”€â”€ Line 1-55:      createTransformInspector
â”œâ”€â”€ Line 75-400:    createSceneEnvironmentInspector
â”œâ”€â”€ Line 500-700:   Audio/Particle/Animator Inspectors
â”œâ”€â”€ Line 1000-1300: Material & MeshRenderer
â”œâ”€â”€ Line 1994-2100: createAutoInspector
â””â”€â”€ Line 2100-2400: RectTransform, Canvas, UI, Helper methods
```

### 12.2 MÃ¼teveccih Classes

```typescript
// Command System
CommandHistory.execute(command)
new SetPropertyCommand(target, key, value, description, callback)
new AddComponentCommand(go, componentClass)
new RemoveComponentCommand(go, component)
new ReorderComponentCommand(go, fromIdx, toIdx)

// Prefab System (Editor integration)
window.Editor?.instance?.getPrefabComponentStatus(comp)
window.Editor?.instance?.getPrefabContextInfo(go)
window.Editor?.instance?.applyPrefabSelectionToTarget(go)
window.Editor?.instance?.revertPrefabSelectionToTarget(go)

// Registry
ScriptRegistry.getAddableComponentNames()
ScriptRegistry.getComponentClass(name)
```

---

## SONUÃ‡

Engine Project'in Inspector sistemi **Phase 5 (Serialization)** tamamlandÄ±ktan sonra **Phase 6 (Inspector Parity)** iÃ§in iyi bir temel saÄŸlÄ±yor:

### âœ… Mevcut GÃ¼Ã§lÃ¼ YÃ¶nler
1. Comprehensive component inspector coverage (15+ specialized inspectors)
2. Full undo/redo integration via CommandHistory
3. Auto-inspector fallback (reflection-based)
4. Prefab override visualization & management
5. Foldout system infrastructure

### âš ï¸ Ä°yileÅŸtirilmesi Gereken Alanlar
1. **Performance**: Full DOM rebuild â†’ differential rendering
2. **Persistence**: Foldout state â†’ EditorSettings save
3. **UX**: Add Component menu â†’ categories + search
4. **Features**: Component header buttons, copy/paste/reset
5. **Quality**: Material property binding, curve editors

### ğŸ“‹ Phase 6 BaÅŸlangÄ±Ã§ Ã–ncelikleri
1. Foldout state persistence (quick win)
2. Add Component categories (UX improvement)
3. Differential rendering (performance)
4. Component header buttons (feature parity)
5. Advanced property editors (curve/color dialog)

**Tahmini Timeline**: 2-3 ay (parallelize improvements)

