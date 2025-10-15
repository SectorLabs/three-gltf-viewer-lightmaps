import * as THREE from 'three';

// https://github.com/Hubs-Foundation/hubs/blob/master/src/components/gltf-model-plus.js#L635-L679
class GLTFMOZLightMapExtension {
    constructor(parser) {
        this.parser = parser;
        this.name = 'MOZ_lightmap';
    }

    // @TODO: Ideally we should use extendMaterialParams hook.
    //        But the current official glTF loader doesn't fire extendMaterialParams
    //        hook for unlit and specular-glossiness materials.
    //        So using loadMaterial hook as workaround so far.
    //        Cons is loadMaterial hook is fired as _invokeOne so
    //        if other plugins defining loadMaterial is registered
    //        there is a chance that this light map extension handler isn't called.
    //        The glTF loader should be updated to remove the limitation.
    loadMaterial(materialIndex) {
        const parser = this.parser;
        const json = parser.json;
        const materialDef = json.materials[materialIndex];

        if (!materialDef.extensions || !materialDef.extensions[this.name]) {
            return null;
        }

        const extensionDef = materialDef.extensions[this.name];

        const pending = [];

        pending.push(parser.loadMaterial(materialIndex));
        pending.push(parser.getDependency('texture', extensionDef.index));

        // Check if there's a directional extension and load those textures too
        const directionalExt = materialDef.extensions['MOZ_lightmap_directional'];
        if (directionalExt) {
            if (directionalExt.basis1) pending.push(parser.getDependency('texture', directionalExt.basis1.index));
            if (directionalExt.basis2) pending.push(parser.getDependency('texture', directionalExt.basis2.index));
            if (directionalExt.basis3) pending.push(parser.getDependency('texture', directionalExt.basis3.index));
        }

        return Promise.all(pending).then((results) => {
            const material = results[0];
            const lightMap = results[1];

            material.lightMap = lightMap;
            lightMap.channel = 1; // todo get the channel from the MOZ_lightmap data
            material.lightMapIntensity =
                extensionDef.intensity !== undefined ? extensionDef.intensity : 1;

            // See https://github.com/mrdoob/three.js/pull/23613
            if (material.isMeshStandardMaterial) {
                material.lightMapIntensity *= Math.PI;
            }

            // If directional textures were loaded, attach them to material as direct properties
            // Similar to how lightMap is stored (not in userData to avoid serialization)
            if (directionalExt && results.length > 2) {
                // Store textures as direct properties on the material
                // This prevents them from being serialized to JSON in userData
                material.directionalBasis1 = results[2];
                material.directionalBasis2 = results[3];
                material.directionalBasis3 = results[4];

                // Set UV channel for directional textures
                results[2].channel = 1;
                results[3].channel = 1;
                results[4].channel = 1;

                // Store intensities in userData (these are just numbers, safe to serialize)
                if (!material.userData) {
                    material.userData = {};
                }
                material.userData.directionalBasis1Intensity = directionalExt.basis1.intensity !== undefined ? directionalExt.basis1.intensity : 1;
                material.userData.directionalBasis2Intensity = directionalExt.basis2.intensity !== undefined ? directionalExt.basis2.intensity : 1;
                material.userData.directionalBasis3Intensity = directionalExt.basis3.intensity !== undefined ? directionalExt.basis3.intensity : 1;

                // Mark material as needing RNM shader
                material.userData.needsRNMShader = true;

                // Override the clone method to copy directional basis textures and RNM flag
                // This ensures cloned materials retain RNM data
                const originalClone = material.clone.bind(material);
                material.clone = function() {
                    const clonedMaterial = originalClone();
                    clonedMaterial.directionalBasis1 = material.directionalBasis1;
                    clonedMaterial.directionalBasis2 = material.directionalBasis2;
                    clonedMaterial.directionalBasis3 = material.directionalBasis3;
                    // userData should already be copied by Three.js clone, but ensure it
                    if (!clonedMaterial.userData) {
                        clonedMaterial.userData = {};
                    }
                    clonedMaterial.userData.directionalBasis1Intensity = material.userData.directionalBasis1Intensity;
                    clonedMaterial.userData.directionalBasis2Intensity = material.userData.directionalBasis2Intensity;
                    clonedMaterial.userData.directionalBasis3Intensity = material.userData.directionalBasis3Intensity;
                    clonedMaterial.userData.needsRNMShader = true;
                    return clonedMaterial;
                };

                console.log('RNM: Loaded directional lightmaps for material', material.name || 'unnamed', {
                    materialUUID: material.uuid,
                    basis1: material.directionalBasis1?.uuid,
                    basis2: material.directionalBasis2?.uuid,
                    basis3: material.directionalBasis3?.uuid,
                    basis1IsTexture: material.directionalBasis1?.isTexture
                });
            }

            return material;
        });
    }
}

class GLTFMozTextureRGBE {
    constructor(parser, loader) {
        this.parser = parser;
        this.loader = loader;
        this.name = 'MOZ_texture_rgbe';
    }

    loadTexture(textureIndex) {
        const parser = this.parser;
        const json = parser.json;
        const textureDef = json.textures[textureIndex];

        if (!textureDef.extensions || !textureDef.extensions[this.name]) {
            return null;
        }

        const extensionDef = textureDef.extensions[this.name];
        const source = extensionDef.source;
        const mimeType = json.images[source].mimeType;
        return parser.loadTextureImage(textureIndex, source, this.loader(mimeType)).then((t) => {
            // TODO pretty severe artifacting when using mipmaps, disable for now
            if (
                t.minFilter == THREE.NearestMipmapNearestFilter ||
                t.minFilter == THREE.NearestMipmapLinearFilter
            ) {
                t.minFilter = THREE.NearestFilter;
            } else if (
                t.minFilter == THREE.LinearMipmapNearestFilter ||
                t.minFilter == THREE.LinearMipmapLinearFilter
            ) {
                t.minFilter = THREE.LinearFilter;
            }

            if (mimeType === 'image/x-exr') {
                t.flipY = true;
            }

            return t;
        });
    }
}

export { GLTFMOZLightMapExtension, GLTFMozTextureRGBE };