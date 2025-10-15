# Radiosity Normal Mapping (RNM) Implementation

This document describes the RNM implementation for the three.js glTF viewer with lightmaps.

## Overview

Radiosity Normal Mapping (RNM) adds fine-grained normal-based lighting detail to baked lightmaps. The implementation uses the `MOZ_lightmap_directional` extension which provides three directional basis textures that are blended based on surface normals.

## Key Design Decisions

1. **Diffuse lightmap remains dominant**: The main lightmap controls overall lighting, and RNM only adds detail
2. **Multiplicative blending**: Directional detail is multiplied with the diffuse lightmap, so shadowed areas get less detail
3. **Per-scene intensity control**: A single slider controls RNM intensity for the entire scene
4. **Graceful fallback**: If directional textures are missing, standard lightmap rendering is used

## Implementation Details

### File Structure

```
src/
├── gltfExtensions.js      # GLTFMOZLightMapExtension - loads directional textures
├── rnmShader.js          # Custom shader code for RNM blending
└── viewer.js             # Integration with viewer and UI controls
```

### glTF Extension Format

The implementation expects materials with both extensions:

```json
{
  "materials": [{
    "name": "Material",
    "extensions": {
      "MOZ_lightmap": {
        "intensity": 1,
        "index": 0,
        "texCoord": {
          "type": "Fixed",
          "value": "lightmap"
        }
      },
      "MOZ_lightmap_directional": {
        "basis1": {
          "intensity": 1,
          "index": 1,
          "texCoord": {
            "type": "Fixed",
            "value": "lightmap"
          }
        },
        "basis2": {
          "intensity": 1,
          "index": 2,
          "texCoord": {
            "type": "Fixed",
            "value": "lightmap"
          }
        },
        "basis3": {
          "intensity": 1,
          "index": 3,
          "texCoord": {
            "type": "Fixed",
            "value": "lightmap"
          }
        }
      }
    }
  }]
}
```

### Shader Implementation

The RNM shader modifies Three.js materials via `onBeforeCompile`:

1. **Vertex shader**: Passes lightmap UV and world-space normal to fragment shader
2. **Fragment shader**:
   - Samples three directional basis textures
   - Blends them using surface normal components (x, y, z)
   - Multiplies result with diffuse lightmap value
   - Adds to indirect diffuse lighting

### Blending Formula

```glsl
directional = basis1 * normal.x + basis2 * normal.y + basis3 * normal.z
finalColor = lightmap * (1.0 + directional * intensity)
```

This ensures:
- Dark areas (low lightmap values) get minimal directional detail
- Bright areas get full directional detail based on surface normals
- The main lightmap always dominates the lighting

## Usage

### UI Controls

The viewer includes an "RNM Intensity" slider in the Lighting panel:
- **Range**: 0.0 to 1.0
- **Default**: 0.3
- **Effect**: Controls how much normal-based detail is added

### Texture Requirements

1. All four lightmaps (1 diffuse + 3 directional) must share the same UV channel (typically UV2)
2. Textures can be PNG or EXR format
3. Color format (RGB) is expected
4. All textures should have the same resolution

### Debugging

Console messages are logged when:
- Directional lightmaps are loaded: `"RNM: Loaded directional lightmaps for material [name]"`
- RNM shader is applied: `"RNM: Applying shader to material [name]"`

## Technical Notes

### UV Channel

All lightmap textures use `texture.channel = 1`, which corresponds to the second UV set (UV2) in the mesh geometry.

### Material Properties

Directional basis textures are stored in `material.userData`:
- `material.userData.directionalBasis1`
- `material.userData.directionalBasis2`
- `material.userData.directionalBasis3`
- `material.userData.directionalBasis1Intensity`
- `material.userData.directionalBasis2Intensity`
- `material.userData.directionalBasis3Intensity`

### Shader Uniforms

The RNM shader adds these uniforms:
- `directionalBasis1`, `directionalBasis2`, `directionalBasis3`: sampler2D
- `directionalBasis1Intensity`, `directionalBasis2Intensity`, `directionalBasis3Intensity`: float
- `directionalIntensity`: float (global control)

### Performance

- RNM adds three additional texture samples per fragment
- Shader is only applied to materials with lightmaps and directional basis textures
- No performance impact on materials without RNM

## Future Enhancements

Possible improvements:
1. Per-material intensity control
2. Different blending modes (additive, overlay, etc.)
3. Support for compressed texture formats
4. Adaptive quality based on distance
5. Custom basis vector orientations

## Troubleshooting

### RNM has no visible effect
- Check console for "RNM: Loaded directional lightmaps" messages
- Verify RNM Intensity slider is > 0
- Ensure directional textures are not black/empty
- Check that normal map (if present) is correctly oriented

### Textures not loading
- Verify glTF texture indices are correct
- Check that all three basis textures are present
- Ensure texture files are in the correct format (PNG/EXR)

### Shader compile errors
- Check browser console for WebGL errors
- Verify that UV2 channel exists in the mesh
- Ensure material is MeshStandardMaterial or compatible type
