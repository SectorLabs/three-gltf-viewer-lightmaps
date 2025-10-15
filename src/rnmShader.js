// Radiosity Normal Mapping (RNM) shader chunks
// This implements RNM similar to how Three.js handles normal mapping with environment maps
// but uses baked directional lightmaps instead of a PMREM environment map

export const rnmVertexShader = `
#ifdef USE_DIRECTIONAL_LIGHTMAP
    varying vec2 vLightmapUv;
#endif
`;

export const rnmFragmentShader = `
#ifdef USE_DIRECTIONAL_LIGHTMAP
    uniform sampler2D directionalBasis1;
    uniform sampler2D directionalBasis2;
    uniform sampler2D directionalBasis3;
    uniform float directionalBasis1Intensity;
    uniform float directionalBasis2Intensity;
    uniform float directionalBasis3Intensity;
    uniform float directionalIntensity;
    uniform float rnmDebugMode;

    varying vec2 vLightmapUv;

    vec3 getRNMLighting(vec3 worldNormal, vec2 uv) {
        // Sample the three directional basis textures
        vec3 basis1 = texture2D(directionalBasis1, uv).rgb * directionalBasis1Intensity;
        vec3 basis2 = texture2D(directionalBasis2, uv).rgb * directionalBasis2Intensity;
        vec3 basis3 = texture2D(directionalBasis3, uv).rgb * directionalBasis3Intensity;

        // Debug mode: visualize basis textures
        if (rnmDebugMode > 0.5) {
            return (basis1 + basis2 + basis3) / 3.0 * 10.0; // Brighten for visibility
        }

        // RNM: Blend the three directional basis textures based on world-space normal
        // This is similar to how environment mapping uses normals, but with baked directional data
        // The normal components weight how much each basis contributes
        vec3 rnmLighting = basis1 * abs(worldNormal.x) +
                          basis2 * abs(worldNormal.y) +
                          basis3 * abs(worldNormal.z);

        return rnmLighting * directionalIntensity;
    }
#endif
`;

// Function to patch Three.js material shaders with RNM support
export function patchMaterialWithRNM(material, directionalBasis1, directionalBasis2, directionalBasis3, directionalIntensity = 0.3) {
    if (!directionalBasis1 || !directionalBasis2 || !directionalBasis3) {
        console.warn('RNM: Missing directional basis textures');
        return; // No directional data available
    }

    console.log('RNM: Setting onBeforeCompile on material', material.uuid);

    // Save existing onBeforeCompile handler if it exists
    const existingOnBeforeCompile = material.onBeforeCompile;
    const hasExistingHandler = existingOnBeforeCompile && existingOnBeforeCompile.toString() !== 'function onBeforeCompile() {}';

    console.log('RNM: Material has existing onBeforeCompile:', hasExistingHandler);

    material.onBeforeCompile = (shader) => {
        console.log('RNM: onBeforeCompile called, directionalIntensity:', directionalIntensity);
        console.log('RNM: Material has lightMap:', !!material.lightMap);
        console.log('RNM: Material lightMapIntensity:', material.lightMapIntensity);

        // Call existing handler first if it exists
        if (hasExistingHandler) {
            console.log('RNM: Calling existing onBeforeCompile first');
            existingOnBeforeCompile.call(material, shader);
        }

        // Add uniforms for directional basis textures
        shader.uniforms.directionalBasis1 = { value: directionalBasis1 };
        shader.uniforms.directionalBasis2 = { value: directionalBasis2 };
        shader.uniforms.directionalBasis3 = { value: directionalBasis3 };
        shader.uniforms.directionalBasis1Intensity = { value: material.userData.directionalBasis1Intensity || 1.0 };
        shader.uniforms.directionalBasis2Intensity = { value: material.userData.directionalBasis2Intensity || 1.0 };
        shader.uniforms.directionalBasis3Intensity = { value: material.userData.directionalBasis3Intensity || 1.0 };
        shader.uniforms.directionalIntensity = { value: directionalIntensity };
        shader.uniforms.rnmDebugMode = { value: 0.0 };

        console.log('RNM: Textures are DataTexture:', {
            basis1: directionalBasis1.constructor.name,
            basis2: directionalBasis2.constructor.name,
            basis3: directionalBasis3.constructor.name
        });

        // Store reference to uniforms for later updates
        material.userData.rnmUniforms = shader.uniforms;

        // Add USE_DIRECTIONAL_LIGHTMAP define
        shader.defines = shader.defines || {};
        shader.defines.USE_DIRECTIONAL_LIGHTMAP = '';

        // Inject vertex shader code
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
${rnmVertexShader}`
        );

        // Pass lightmap UV to fragment shader
        shader.vertexShader = shader.vertexShader.replace(
            '#include <uv2_vertex>',
            `#include <uv2_vertex>
#ifdef USE_DIRECTIONAL_LIGHTMAP
    vLightmapUv = uv2;
#endif`
        );

        // Inject fragment shader code
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
${rnmFragmentShader}`
        );

        // Replace lightmap calculation with RNM
        // Similar to how environment mapping works but using baked directional textures
        const lightmapReplacement = `// RNM replaces standard lightmap
#ifdef USE_DIRECTIONAL_LIGHTMAP
    // Get the geometry normal (after normal mapping if present)
    vec3 geometryNormal = normal;

    // Get RNM lighting using the surface normal
    vec3 rnmLighting = getRNMLighting(geometryNormal, vLightmapUv);

    // Sample the diffuse lightmap for base illumination
    vec4 lightMapTexel = texture2D(lightMap, vLightmapUv);
    vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;

    // Combine: diffuse lightmap provides base illumination, RNM adds normal-dependent detail
    // The diffuse lightmap remains dominant (multiplied by lightMapIrradiance)
    // RNM adds directional detail that's modulated by the base illumination
    reflectedLight.indirectDiffuse += diffuseColor.rgb * (lightMapIrradiance + rnmLighting * lightMapIrradiance);
#else
    // Standard lightmap
    #include <lightmap_fragment>
#endif`;

        const beforeReplace = shader.fragmentShader.includes('#include <lightmap_fragment>');
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lightmap_fragment>',
            lightmapReplacement
        );
        const afterReplace = shader.fragmentShader.includes('USE_DIRECTIONAL_LIGHTMAP');

        console.log('RNM: Lightmap fragment replacement:', {
            foundLightmapInclude: beforeReplace,
            replacementApplied: afterReplace
        });

        // Log the modified shader for debugging
        console.log('RNM: Shader modification complete');
        console.log('RNM: Vertex shader includes USE_DIRECTIONAL_LIGHTMAP:', shader.vertexShader.includes('USE_DIRECTIONAL_LIGHTMAP'));
        console.log('RNM: Fragment shader includes USE_DIRECTIONAL_LIGHTMAP:', shader.fragmentShader.includes('USE_DIRECTIONAL_LIGHTMAP'));
        console.log('RNM: Fragment shader includes getRNMLighting:', shader.fragmentShader.includes('getRNMLighting'));

        // Save full shaders for debugging
        window.rnmDebug = {
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            uniforms: shader.uniforms
        };

        // Store shader for debugging
        material.userData.rnmShader = shader;
    };

    // Force material to recompile
    material.needsUpdate = true;
}

// Function to update the global directional intensity for all materials
export function updateDirectionalIntensity(material, intensity) {
    if (material.userData.rnmUniforms && material.userData.rnmUniforms.directionalIntensity) {
        material.userData.rnmUniforms.directionalIntensity.value = intensity;
    }
}
