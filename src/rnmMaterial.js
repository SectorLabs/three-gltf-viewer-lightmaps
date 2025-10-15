// Custom NodeMaterial for RNM (Radiosity Normal Mapping) with PBR workflow
import { NodeMaterial, UniformNode } from 'three/webgpu';
import {
    texture,
    add,
    mul,
    dot,
    clamp,
    saturate,
    mix,
    uniform,
    normalGeometry,
    uv,
    positionWorld,
    normalWorld,
    tangentLocal,
    bitangentLocal,
    normalLocal,
    modelWorldMatrix,
    vec3,
    vec4,
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

    // Get normal - use normal map if available to add fine detail to low-res RNM
    // The normal map provides high-frequency detail that modulates the directional lighting
    let normal;
    if (originalMaterial.normalMap) {
        // Sample normal map (in tangent space, stored as [0,1])
        const normalMapSample = texture(originalMaterial.normalMap, uv(0)).xyz;
        // Convert from [0,1] to [-1,1]
        const tangentNormal = normalMapSample.mul(2.0).sub(1.0);

        // Build TBN matrix in world space (view-independent)
        // Transform tangent and bitangent to world space
        const T = modelWorldMatrix.mul(vec4(tangentLocal, 0.0)).xyz.normalize();
        const B = modelWorldMatrix.mul(vec4(bitangentLocal, 0.0)).xyz.normalize();
        const N = normalWorld;

        // Transform tangent-space normal to world space
        normal = add(add(T.mul(tangentNormal.x), B.mul(tangentNormal.y)), N.mul(tangentNormal.z)).normalize();
    } else {
        normal = normalWorld;
    }

    // Sample the three basis lightmaps (RGB lighting for each basis direction)
    const basisLightmap1 = texture(directionalBasis1, lightmapUV).rgb;
    const basisLightmap2 = texture(directionalBasis2, lightmapUV).rgb;
    const basisLightmap3 = texture(directionalBasis3, lightmapUV).rgb;

    // Sample diffuse lightmap
    const diffuseLightmap = texture(originalMaterial.lightMap, lightmapUV).rgb;

    // Constant basis vectors
    const basis1Vec = vec3(1.225, 0.0, 0.577).normalize();
    const basis2Vec = vec3(-0.408, -0.707, 0.577).normalize();
    const basis3Vec = vec3(-0.408, 0.707, 0.577).normalize();

    // Debug visualization: show average of basis lightmaps
    const avgBasis = add(add(basisLightmap1, basisLightmap2), basisLightmap3).div(3.0);
    const debugColor = avgBasis.mul(5.0);

    // RNM calculation: dot(basisVec, normal) * basisLightmap
    // Dot product each constant basis vector with the surface normal
    const dot1 = saturate(dot(basis1Vec, normal));
    const dot2 = saturate(dot(basis2Vec, normal));
    const dot3 = saturate(dot(basis3Vec, normal));

    // Scale basis lightmaps so they sum to the diffuse lightmap
    // This ensures energy comes from high-res diffuse, direction from low-res basis

    // Sum of all basis lightmaps (before dot product weighting)
    const basisSum = add(add(
        enableBasis1 ? basisLightmap1 : vec3(0.0, 0.0, 0.0),
        enableBasis2 ? basisLightmap2 : vec3(0.0, 0.0, 0.0)
    ), enableBasis3 ? basisLightmap3 : vec3(0.0, 0.0, 0.0));

    // Calculate scale factor: diffuse / basisSum (per color channel)
    // This scales basis values so they sum to the diffuse value
    const scaleFactor = diffuseLightmap.max(0.002).div(basisSum.max(0.001));

    // Scale each basis lightmap
    const scaledBasis1 = enableBasis1 ? mul(basisLightmap1, scaleFactor).max(0.05) : vec3(0.0, 0.0, 0.0);
    const scaledBasis2 = enableBasis2 ? mul(basisLightmap2, scaleFactor).max(0.05) : vec3(0.0, 0.0, 0.0);
    const scaledBasis3 = enableBasis3 ? mul(basisLightmap3, scaleFactor).max(0.05) : vec3(0.0, 0.0, 0.0);

    // Apply normal-dependent weighting (dot products)
    const rnmComponent1 = mul(scaledBasis1, dot1);
    const rnmComponent2 = mul(scaledBasis2, dot2);
    const rnmComponent3 = mul(scaledBasis3, dot3);

    // Final RNM result: sum of normal-weighted, scaled basis values
    const rnmLighting = add(add(rnmComponent1, rnmComponent2), rnmComponent3);

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
