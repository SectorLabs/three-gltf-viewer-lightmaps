// Custom NodeMaterial for RNM (Radiosity Normal Mapping) with PBR workflow
import { NodeMaterial, UniformNode } from 'three/webgpu';
import {
    texture,
    add,
    mul,
    dot,
    saturate,
    mix,
    uniform,
    uv,
    normalWorld,
    tangentLocal,
    bitangentLocal,
    modelWorldMatrix,
    vec3,
    vec4,
    clamp,
    pow
} from 'three/tsl';

/**
 * Creates a NodeMaterial with RNM lighting integrated into PBR workflow
 */
export function createRNMMaterial(
    originalMaterial,
    directionalBasis1,
    directionalBasis2,
    directionalBasis3,
    directionalIntensity = 0.3,
    enableBasis1 = true,
    enableBasis2 = true,
    enableBasis3 = true
) {
    console.log('RNM: Creating custom NodeMaterial for RNM');

    const material = new NodeMaterial();
    material.name = (originalMaterial.name || 'Material') + '_RNM';

    if (originalMaterial.color && material.color) material.color.copy(originalMaterial.color);
    if (originalMaterial.roughness !== undefined) material.roughness = originalMaterial.roughness;
    if (originalMaterial.metalness !== undefined) material.metalness = originalMaterial.metalness;
    if (originalMaterial.side !== undefined) material.side = originalMaterial.side;
    if (originalMaterial.transparent !== undefined) material.transparent = originalMaterial.transparent;
    if (originalMaterial.opacity !== undefined) material.opacity = originalMaterial.opacity;

    const baseColorMap = originalMaterial.map;

    // Controls
    const intensityUniform = uniform(directionalIntensity);
    const detailStrengthUniform = uniform(1.0); // optional contrast of RNM detail
    const minGainUniform = uniform(0.5);
    const maxGainUniform = uniform(2.0);

    material.userData = {
        ...originalMaterial.userData,
        rnmOriginalMaterial: originalMaterial,
        rnmBasis1: directionalBasis1,
        rnmBasis2: directionalBasis2,
        rnmBasis3: directionalBasis3,
        rnmIntensity: directionalIntensity,
        rnmEnableBasis1: enableBasis1,
        rnmEnableBasis2: enableBasis2,
        rnmEnableBasis3: enableBasis3
    };

    // UVs
    const lightmapUV = uv(1);

    // World-space normal with optional normal map detail
    let normal;
    if (originalMaterial.normalMap) {
        const normalMapSample = texture(originalMaterial.normalMap, uv(0)).xyz;
        const tangentNormal = normalMapSample.mul(2.0).sub(1.0);
        const T = modelWorldMatrix.mul(vec4(tangentLocal, 0.0)).xyz.normalize();
        const B = modelWorldMatrix.mul(vec4(bitangentLocal, 0.0)).xyz.normalize();
        const N = normalWorld;
        normal = add(add(T.mul(tangentNormal.x), B.mul(tangentNormal.y)), N.mul(tangentNormal.z)).normalize();
    } else {
        normal = normalWorld;
    }

    // Reference/baked normal: use geometric (pre-normal-map) normal to anchor energy
    const refNormal = normalWorld;

    // Lightmaps
    const basisLightmap1 = texture(directionalBasis1, lightmapUV).rgb;
    const basisLightmap2 = texture(directionalBasis2, lightmapUV).rgb;
    const basisLightmap3 = texture(directionalBasis3, lightmapUV).rgb;
    const diffuseLightmap = texture(originalMaterial.lightMap, lightmapUV).rgb;

    // Constant RNM basis (normalized)
    const basis1Vec = vec3(1.225, 0.0, 0.577).normalize();
    const basis2Vec = vec3(-0.408, -0.707, 0.577).normalize();
    const basis3Vec = vec3(-0.408, 0.707, 0.577).normalize();

    // Dot products (hemisphere clamp)
    const dot1  = saturate(dot(basis1Vec, normal));
    const dot2  = saturate(dot(basis2Vec, normal));
    const dot3  = saturate(dot(basis3Vec, normal));
    const rdot1 = saturate(dot(basis1Vec, refNormal));
    const rdot2 = saturate(dot(basis2Vec, refNormal));
    const rdot3 = saturate(dot(basis3Vec, refNormal));

    // RNM irradiance for current normal: E(n)
    const En = add(
        add(enableBasis1 ? mul(basisLightmap1, dot1)  : vec3(0.0,0.0,0.0),
            enableBasis2 ? mul(basisLightmap2, dot2)  : vec3(0.0,0.0,0.0)),
        enableBasis3 ? mul(basisLightmap3, dot3)      : vec3(0.0,0.0,0.0)
    );

    // RNM irradiance for reference normal: E(n_ref)
    const Eref = add(
        add(enableBasis1 ? mul(basisLightmap1, rdot1) : vec3(0.0,0.0,0.0),
            enableBasis2 ? mul(basisLightmap2, rdot2) : vec3(0.0,0.0,0.0)),
        enableBasis3 ? mul(basisLightmap3, rdot3)     : vec3(0.0,0.0,0.0)
    );

    // Directional gain = E(n) / E(n_ref) (per-channel), clamped and optionally exponentiated
    const eps = vec3(1e-4, 1e-4, 1e-4);
    let gain = En.add(eps).div(Eref.add(eps));
    gain = pow(gain, detailStrengthUniform);
    gain = clamp(gain, minGainUniform, maxGainUniform);

    // Final lightmap: magnitude/color from high-res diffuse; direction from RNM gain
    const directional = mix(vec3(1.0,1.0,1.0), gain, intensityUniform);
    const finalLightmap = mul(diffuseLightmap, directional);

    // Base color
    let baseColor;
    if (baseColorMap) {
        baseColor = texture(baseColorMap, uv(0)).rgb;
    } else if (originalMaterial.color) {
        baseColor = vec3(originalMaterial.color.r, originalMaterial.color.g, originalMaterial.color.b);
    } else {
        baseColor = vec3(1.0, 1.0, 1.0);
    }

    // Output
    const outputColor = mul(baseColor, finalLightmap);
    material.colorNode = outputColor;

    // Baked lighting only
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
        mesh.material = newMaterial;
        material.dispose();
    }
}

/**
 * Updates basis enable/disable flags
 */
export function updateRNMBasisToggles(mesh, enableBasis1, enableBasis2, enableBasis3) {
    const material = mesh.material;
    if (material.userData.rnmOriginalMaterial) {
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
        mesh.material = newMaterial;
        material.dispose();
    }
}

