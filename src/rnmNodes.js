// Radiosity Normal Mapping (RNM) implementation for WebGPU using Three.js TSL (Three.js Shading Language)
import { texture, add, mul, abs, mix, uniform, normalGeometry, uv } from 'three/tsl';

/**
 * Applies RNM to a material using Three.js node system for WebGPU
 * @param {Material} material - The material to apply RNM to
 * @param {Texture} directionalBasis1 - First basis texture
 * @param {Texture} directionalBasis2 - Second basis texture
 * @param {Texture} directionalBasis3 - Third basis texture
 * @param {Number} directionalIntensity - RNM intensity
 */
export function applyRNMToMaterial(material, directionalBasis1, directionalBasis2, directionalBasis3, directionalIntensity = 0.3) {
    console.log('RNM: Applying WebGPU node-based RNM to material', material.uuid);
    console.log('RNM: Material type:', material.type);
    console.log('RNM: Material has colorNode:', !!material.colorNode);
    console.log('RNM: Material has emissiveNode:', !!material.emissiveNode);
    console.log('RNM: Material has lightsNode:', !!material.lightsNode);
    console.log('RNM: Material color:', material.color);

    // Store references for later updates
    material.userData.rnmBasis1 = directionalBasis1;
    material.userData.rnmBasis2 = directionalBasis2;
    material.userData.rnmBasis3 = directionalBasis3;

    // Create or reuse uniforms for runtime control
    // IMPORTANT: We must reuse the same uniform objects, not create new ones
    if (!material.userData.rnmUniforms) {
        material.userData.rnmUniforms = {
            directionalIntensity: uniform(directionalIntensity),
            debugMode: uniform(0)
        };
    } else {
        // Update existing uniform values
        material.userData.rnmUniforms.directionalIntensity.value = directionalIntensity;
    }

    const intensityUniform = material.userData.rnmUniforms.directionalIntensity;
    const debugModeUniform = material.userData.rnmUniforms.debugMode;

    // Get lightmap UV (typically uv2 for lightmaps)
    const lightmapUV = uv(1); // UV channel 1 (second UV set)

    // Get geometry normal
    const normal = normalGeometry;

    // Sample the three basis lightmaps (RGB lighting for each basis direction)
    const basisLightmap1 = texture(directionalBasis1, lightmapUV).rgb;
    const basisLightmap2 = texture(directionalBasis2, lightmapUV).rgb;
    const basisLightmap3 = texture(directionalBasis3, lightmapUV).rgb;

    // Sample diffuse lightmap
    const diffuseLightmap = texture(material.lightMap, lightmapUV).rgb;

    // Constant basis vectors
    const basis1Vec = vec3(1.225, 0.0, 0.577);
    const basis2Vec = vec3(-0.408, -0.707, 0.577);
    const basis3Vec = vec3(-0.408, 0.707, 0.577);

    // Debug mode options:
    // 0 = normal RNM
    // 1 = show average of all basis lightmaps
    const avgBasis = add(add(basisLightmap1, basisLightmap2), basisLightmap3).div(3.0);
    const debugColor = avgBasis.mul(5.0); // Brighten for visibility

    // RNM calculation: dot(basisVec, normal) * basisLightmap
    // Dot product each constant basis vector with the surface normal
    const dot1 = add(add(mul(basis1Vec.x, normal.x), mul(basis1Vec.y, normal.y)), mul(basis1Vec.z, normal.z));
    const dot2 = add(add(mul(basis2Vec.x, normal.x), mul(basis2Vec.y, normal.y)), mul(basis2Vec.z, normal.z));
    const dot3 = add(add(mul(basis3Vec.x, normal.x), mul(basis3Vec.y, normal.y)), mul(basis3Vec.z, normal.z));

    // Multiply each dot product by its corresponding basis lightmap and sum
    const rnmComponent1 = mul(basisLightmap1, dot1);
    const rnmComponent2 = mul(basisLightmap2, dot2);
    const rnmComponent3 = mul(basisLightmap3, dot3);
    const rnmColor = add(add(rnmComponent1, rnmComponent2), rnmComponent3);

    // Apply intensity and combine with diffuse lightmap
    const rnmLighting = mul(rnmColor, diffuseLightmap).mul(intensityUniform);

    // Choose between debug and normal rendering
    const rnmContribution = mix(rnmLighting, debugColor, debugModeUniform);

    // Combine: diffuse lightmap + RNM contribution
    const finalLightmap = add(diffuseLightmap, rnmContribution);

    // For MeshStandardMaterial with lightmaps, we need to:
    // 1. Disable dynamic lights (already done in viewer.js with noLightsNode)
    // 2. Set emissive to the lightmap result
    // 3. Multiply by material base color

    // Get base color (either from colorNode or material.color)
    const baseColor = material.colorNode || uniform(material.color);

    // Set emissive to lightmap * base color
    // This makes the material self-illuminated with the baked lighting
    material.emissiveNode = mul(finalLightmap, baseColor);

    // Disable metalness and roughness for clearer lightmap visibility
    material.metalness = 0;
    material.roughness = 1;

    // Also ensure emissive intensity doesn't dampen it
    material.emissiveIntensity = 1.0;

    // Force material update
    material.needsUpdate = true;
    material.version++;

    console.log('RNM: WebGPU node-based RNM applied successfully');
    console.log('RNM: Set emissiveNode:', !!material.emissiveNode);
    console.log('RNM: Uniforms:', {
        intensity: material.userData.rnmUniforms.directionalIntensity.value,
        debug: material.userData.rnmUniforms.debugMode.value
    });
}

/**
 * Updates RNM intensity for a material
 * @param {Material} material - Material with RNM applied
 * @param {Number} intensity - New intensity value
 */
export function updateRNMIntensity(material, intensity) {
    if (material.userData.rnmUniforms && material.userData.rnmUniforms.directionalIntensity) {
        const oldValue = material.userData.rnmUniforms.directionalIntensity.value;
        material.userData.rnmUniforms.directionalIntensity.value = intensity;
        console.log('RNM: Updated intensity from', oldValue, 'to', intensity);
        console.log('RNM: Uniform object:', material.userData.rnmUniforms.directionalIntensity);
    } else {
        console.warn('RNM: Cannot update intensity - no uniforms found');
    }
}

/**
 * Updates RNM debug mode for a material
 * @param {Material} material - Material with RNM applied
 * @param {Boolean} enabled - Debug mode enabled
 */
export function updateRNMDebugMode(material, enabled) {
    if (material.userData.rnmUniforms && material.userData.rnmUniforms.debugMode) {
        material.userData.rnmUniforms.debugMode.value = enabled ? 1.0 : 0.0;
        console.log('RNM: Debug mode', enabled ? 'enabled' : 'disabled');
        console.log('RNM: Debug uniform value:', material.userData.rnmUniforms.debugMode.value);
    } else {
        console.warn('RNM: Cannot update debug mode - no uniforms found');
    }
}
