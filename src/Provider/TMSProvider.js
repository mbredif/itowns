import * as THREE from 'three';
import { getColorTextureByUrl } from './OGCWebServiceHelper';
import URLBuilder from './URLBuilder';
import Extent from '../Core/Geographic/Extent';
import { is4326 } from '../Core/Geographic/Coordinates';

function preprocessDataLayer(layer) {
    if (!layer.extent) {
        // default to the full 3857 extent
        layer.extent = new Extent('EPSG:3857',
            -20037508.342789244, 20037508.342789244,
            -20037508.342789255, 20037508.342789244);
    }
    if (!(layer.extent instanceof (Extent))) {
        if (!layer.projection) {
            throw new Error(`Missing projection property for layer '${layer.id}'`);
        }
        layer.extent = new Extent(layer.projection, ...layer.extent);
    }
    layer.origin = layer.origin || (layer.protocol == 'xyz' ? 'top' : 'bottom');
    if (!layer.options.zoom) {
        layer.options.zoom = {
            min: 0,
            max: 18,
        };
    }
    layer.getCoords = function getCoords(extent) {
        // Special globe case: use the P(seudo)M(ercator) coordinates
        if (is4326(extent.crs()) &&
                (this.extent.crs() == 'EPSG:3857' || is4326(this.extent.crs()))) {
            extent.computeTileMatrixSetCoordinates('PM');
            return extent.wmtsCoords.PM;
        } else {
            return extent.computeTMSCoordinates(this.extent, this.origin);
        }
    };
}

function executeCommand(command) {
    const layer = command.layer;
    const tile = command.requester;

    const promises = [];
    for (const coordTMS of layer.getCoords(tile.extent)) {
        const coordTMSParent = (command.targetLevel < coordTMS.zoom) ?
            coordTMS.WMTS_WGS84Parent(command.targetLevel) :
            undefined;

        const urld = URLBuilder.xyz(coordTMSParent || coordTMS, layer);

        promises.push(getColorTextureByUrl(urld, layer.networkOptions).then((texture) => {
            const result = {};
            result.texture = texture;
            result.texture.coords = coordTMSParent || coordTMS;
            result.pitch = coordTMSParent ?
                coordTMS.offsetToParent(coordTMSParent) :
                new THREE.Vector4(0, 0, 1, 1);
            if (layer.transparent) {
                texture.premultiplyAlpha = true;
            }
            return result;
        }));
    }
    return Promise.all(promises);
}

function tileTextureCount(tile, layer) {
    return tileInsideLimit(tile, layer) ? 1 : 0;
}

function tileInsideLimit(tile, layer, targetLevel) {
    // assume 1 TMS texture per tile (ie: tile geometry CRS is the same as layer's CRS)
    const tmsCoord = layer.getCoords(tile.extent)[0];

    if (targetLevel < tmsCoord.zoom) {
        tmsCoord.WMTS_WGS84Parent(targetLevel, undefined, tmsCoord);
    }

    return layer.options.zoom.min <= tmsCoord.zoom &&
            tmsCoord.zoom <= layer.options.zoom.max;
}

export default {
    preprocessDataLayer,
    executeCommand,
    tileTextureCount,
    tileInsideLimit,
};
