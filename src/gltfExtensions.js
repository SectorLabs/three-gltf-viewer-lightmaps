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

        return Promise.all(pending).then(([material, lightMap]) => {
            material.lightMap = lightMap;
            lightMap.channel = 1; // todo get the channel from the MOZ_lightmap data
            material.lightMapIntensity =
                extensionDef.intensity !== undefined ? extensionDef.intensity : 1;

            // See https://github.com/mrdoob/three.js/pull/23613
            if (material.isMeshStandardMaterial) {
                material.lightMapIntensity *= Math.PI;
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