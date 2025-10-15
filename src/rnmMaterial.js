// Custom NodeMaterial for RNM (Radiosity Normal Mapping) with PBR workflow
import { NodeMaterial, UniformNode } from 'three/webgpu';
import {
    texture,
    add,
    mul,
    mix,
    uniform,
    normalGeometry,
    uv,
    positionWorld,
    normalWorld,
    normalMap,
    vec3,
    float as floatNode
} from 'three/tsl';

/**
 * Creates a NodeMaterial with RNM lighting integrated into PBR workflow
 */
export function createRNMMaterial(originalMaterial, directionalBasis1, directionalBasis2, directionalBasis3, directionalIntensity = 0.3, enableBasis1 = true, enableBasis2 = true, enableBasis3 = true) {
    console.log('RNM: Creating custom NodeMaterial for RNM');

    // Create a new NodeMaterial
    const material = new NodeMaterial();

    // Copy basic properties from original material with safety checks
    material.name = (originalMaterial.name || 'Material') + '_RNM';

    if (originalMaterial.color && material.color) {
        material.color.copy(originalMaterial.color);
    }

    if (originalMaterial.roughness !== undefined) {
        material.roughness = originalMaterial.roughness;
    }

    if (originalMaterial.metalness !== undefined) {
        material.metalness = originalMaterial.metalness;
    }

    if (originalMaterial.side !== undefined) {
        material.side = originalMaterial.side;
    }

    if (originalMaterial.transparent !== undefined) {
        material.transparent = originalMaterial.transparent;
    }

    if (originalMaterial.opacity !== undefined) {
        material.opacity = originalMaterial.opacity;
    }

    // Copy texture maps if they exist (but we'll use them in nodes, not as material properties)
    // Store reference to base color map for node generation
    const baseColorMap = originalMaterial.map;

    // Create uniforms for RNM control
    const intensityUniform = uniform(directionalIntensity);
    const debugModeUniform = uniform(0);

    // Store original material and basis textures so we can recreate on intensity change
    material.userData = {
        ...originalMaterial.userData,
        rnmOriginalMaterial: originalMaterial,
        rnmBasis1: directionalBasis1,
        rnmBasis2: directionalBasis2,
        rnmBasis3: directionalBasis3,
        rnmIntensity: directionalIntensity,
        rnmDebugMode: 0,
        rnmEnableBasis1: enableBasis1,
        rnmEnableBasis2: enableBasis2,
        rnmEnableBasis3: enableBasis3
    };

    // Get lightmap UV (second UV channel)
    const lightmapUV = uv(1);

    // Get normal - use normal map if available, otherwise use geometry normal
    let normal;
    if (originalMaterial.normalMap) {
        // Apply normal mapping
        normal = normalMap(texture(originalMaterial.normalMap, uv(0)));
    } else {
        // Use world-space geometry normal
        normal = normalWorld;
    }

    // Sample the three basis lightmaps (RGB lighting for each basis direction)
    const basisLightmap1 = texture(directionalBasis1, lightmapUV).rgb;
    const basisLightmap2 = texture(directionalBasis2, lightmapUV).rgb;
    const basisLightmap3 = texture(directionalBasis3, lightmapUV).rgb;

    // Sample diffuse lightmap
    const diffuseLightmap = texture(originalMaterial.lightMap, lightmapUV).rgb;

    // Constant basis vectors
    const basis1Vec = vec3(1.225, 0.0, 0.577);
    const basis2Vec = vec3(-0.408, -0.707, 0.577);
    const basis3Vec = vec3(-0.408, 0.707, 0.577);

    // Debug visualization: show average of basis lightmaps
    const avgBasis = add(add(basisLightmap1, basisLightmap2), basisLightmap3).div(3.0);
    const debugColor = avgBasis.mul(5.0);

    // RNM calculation: dot(basisVec, normal) * basisLightmap
    // Dot product each constant basis vector with the surface normal
    const dot1 = add(add(mul(basis1Vec.x, normal.x), mul(basis1Vec.y, normal.y)), mul(basis1Vec.z, normal.z));
    const dot2 = add(add(mul(basis2Vec.x, normal.x), mul(basis2Vec.y, normal.y)), mul(basis2Vec.z, normal.z));
    const dot3 = add(add(mul(basis3Vec.x, normal.x), mul(basis3Vec.y, normal.y)), mul(basis3Vec.z, normal.z));

    // Multiply each dot product by its corresponding basis lightmap (only if enabled)
    const rnmComponent1 = enableBasis1 ? mul(basisLightmap1, dot1) : vec3(0.0, 0.0, 0.0);
    const rnmComponent2 = enableBasis2 ? mul(basisLightmap2, dot2) : vec3(0.0, 0.0, 0.0);
    const rnmComponent3 = enableBasis3 ? mul(basisLightmap3, dot3) : vec3(0.0, 0.0, 0.0);
    const rnmColor = add(add(rnmComponent1, rnmComponent2), rnmComponent3);

    // Apply intensity - blend between diffuse lightmap and RNM
    // When intensity = 0: use 100% diffuse lightmap
    // When intensity = 1: use 100% RNM
    const rnmLighting = mul(rnmColor, diffuseLightmap);

    // Choose between debug and normal mode
    const rnmContribution = mix(rnmLighting, debugColor, debugModeUniform);

    // Blend between diffuse and RNM based on intensity
    // mix(diffuse, rnm, intensity) = diffuse * (1 - intensity) + rnm * intensity
    const finalLightmap = mix(diffuseLightmap, rnmContribution, intensityUniform);

    // Get base color (from texture or solid color)
    let baseColor;
    if (baseColorMap) {
        baseColor = texture(baseColorMap, uv(0)).rgb;
    } else if (originalMaterial.color) {
        baseColor = vec3(originalMaterial.color.r, originalMaterial.color.g, originalMaterial.color.b);
    } else {
        baseColor = vec3(1.0, 1.0, 1.0);
    }

    // Final color: base color modulated by lightmap
    const outputColor = mul(baseColor, finalLightmap);

    // Set the output color
    material.colorNode = outputColor;

    // Disable dynamic lighting since we're using baked lights
    material.lightsNode = null;

    console.log('RNM: Custom NodeMaterial created successfully');

    return material;
}

/**
 * Updates RNM intensity for a material
 */
export function updateRNMMaterialIntensity(mesh, intensity) {
    const material = mesh.material;
    if (material.userData.rnmOriginalMaterial) {
        console.log('RNM: Recreating material with intensity', intensity);
        const newMaterial = createRNMMaterial(
            material.userData.rnmOriginalMaterial,
            material.userData.rnmBasis1,
            material.userData.rnmBasis2,
            material.userData.rnmBasis3,
            intensity,
            material.userData.rnmEnableBasis1,
            material.userData.rnmEnableBasis2,
            material.userData.rnmEnableBasis3
        );
        // Preserve debug mode
        newMaterial.userData.rnmDebugMode = material.userData.rnmDebugMode;
        mesh.material = newMaterial;
        material.dispose();
    } else {
        console.warn('RNM: Cannot update intensity - no RNM data found on material');
    }
}

/**
 * Updates RNM debug mode for a material
 */
export function updateRNMMaterialDebugMode(mesh, enabled) {
    const material = mesh.material;
    if (material.userData.rnmOriginalMaterial) {
        console.log('RNM: Recreating material with debug mode', enabled);
        const newMaterial = createRNMMaterial(
            material.userData.rnmOriginalMaterial,
            material.userData.rnmBasis1,
            material.userData.rnmBasis2,
            material.userData.rnmBasis3,
            material.userData.rnmIntensity,
            material.userData.rnmEnableBasis1,
            material.userData.rnmEnableBasis2,
            material.userData.rnmEnableBasis3
        );
        // Set debug mode (will be used in next recreation)
        newMaterial.userData.rnmDebugMode = enabled ? 1 : 0;
        mesh.material = newMaterial;
        material.dispose();
    } else {
        console.warn('RNM: Cannot update debug mode - no RNM data found');
    }
}

/**
 * Updates basis enable/disable flags
 */
export function updateRNMBasisToggles(mesh, enableBasis1, enableBasis2, enableBasis3) {
    const material = mesh.material;
    if (material.userData.rnmOriginalMaterial) {
        console.log('RNM: Recreating material with basis toggles', enableBasis1, enableBasis2, enableBasis3);
        const newMaterial = createRNMMaterial(
            material.userData.rnmOriginalMaterial,
            material.userData.rnmBasis1,
            material.userData.rnmBasis2,
            material.userData.rnmBasis3,
            material.userData.rnmIntensity,
            enableBasis1,
            enableBasis2,
            enableBasis3
        );
        // Preserve debug mode
        newMaterial.userData.rnmDebugMode = material.userData.rnmDebugMode;
        mesh.material = newMaterial;
        material.dispose();
    } else {
        console.warn('RNM: Cannot update basis toggles - no RNM data found');
    }
}
