/*
 * export-timeline.jsx
 *
 * After Effects ExtendScript that extracts all animated-property
 * keyframe data from the active composition and copies the result
 * to the system clipboard as JSON.
 *
 * Usage:  File > Scripts > Run Script  (or drop into AE Scripts folder)
 *
 * Requirements:
 *   Edit > Preferences > Scripting & Expressions >
 *     "Allow Scripts to Write Files and Access Network"  must be ON.
 */

(function () {

    // ------------------------------------------------------------------
    // 1. JSON polyfill (AE runs ES3 — no native JSON)
    // ------------------------------------------------------------------

    var JSON2 = {};

    JSON2.stringify = function (value, indent) {
        if (typeof indent === "undefined") indent = 2;
        return _serialize(value, indent, 0);
    };

    function _pad(depth, indent) {
        if (!indent) return "";
        var s = "\n";
        for (var i = 0; i < depth * indent; i++) s += " ";
        return s;
    }

    function _serialize(val, indent, depth) {
        if (val === null || typeof val === "undefined") return "null";

        var t = typeof val;
        if (t === "boolean") return val ? "true" : "false";
        if (t === "number") {
            if (isNaN(val) || !isFinite(val)) return "null";
            // Round to 4 decimal places to keep output readable
            return String(Math.round(val * 10000) / 10000);
        }
        if (t === "string") return '"' + _escapeStr(val) + '"';

        // Array
        if (val instanceof Array) {
            if (val.length === 0) return "[]";
            var arrParts = [];
            for (var i = 0; i < val.length; i++) {
                arrParts.push(_pad(depth + 1, indent) + _serialize(val[i], indent, depth + 1));
            }
            return "[" + arrParts.join(",") + _pad(depth, indent) + "]";
        }

        // Object
        var keys = [];
        for (var k in val) {
            if (val.hasOwnProperty(k)) keys.push(k);
        }
        if (keys.length === 0) return "{}";
        var objParts = [];
        for (var j = 0; j < keys.length; j++) {
            objParts.push(
                _pad(depth + 1, indent) +
                '"' + _escapeStr(keys[j]) + '": ' +
                _serialize(val[keys[j]], indent, depth + 1)
            );
        }
        return "{" + objParts.join(",") + _pad(depth, indent) + "}";
    }

    function _escapeStr(s) {
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c === 0x5C) out += "\\\\";
            else if (c === 0x22) out += '\\"';
            else if (c === 0x0A) out += "\\n";
            else if (c === 0x0D) out += "\\r";
            else if (c === 0x09) out += "\\t";
            else if (c < 0x20 || c === 0x7F) {
                var hex = c.toString(16);
                while (hex.length < 4) hex = "0" + hex;
                out += "\\u" + hex;
            }
            else out += s.charAt(i);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // 2. Validate — make sure a composition is active
    // ------------------------------------------------------------------

    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        alert("uSpec Export Timeline\n\nNo active composition found.\nPlease open a composition and try again.");
        return;
    }

    // ------------------------------------------------------------------
    // 3. Interpolation-type enum → string
    // ------------------------------------------------------------------

    function interpName(typeEnum) {
        switch (typeEnum) {
            case KeyframeInterpolationType.LINEAR: return "LINEAR";
            case KeyframeInterpolationType.BEZIER: return "BEZIER";
            case KeyframeInterpolationType.HOLD:   return "HOLD";
            default: return "UNKNOWN";
        }
    }

    // ------------------------------------------------------------------
    // 4. Serialize a single keyframe
    // ------------------------------------------------------------------

    function serializeKeyframe(prop, idx) {
        var kf = {};
        kf.time = prop.keyTime(idx);
        kf.value = normalizeValue(prop.keyValue(idx));

        // Easing
        var easeIn  = prop.keyInTemporalEase(idx);
        var easeOut = prop.keyOutTemporalEase(idx);

        kf.easeIn = {
            type: interpName(prop.keyInInterpolationType(idx)),
            eases: serializeEaseArray(easeIn)
        };
        kf.easeOut = {
            type: interpName(prop.keyOutInterpolationType(idx)),
            eases: serializeEaseArray(easeOut)
        };

        return kf;
    }

    function serializeEaseArray(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            out.push({
                speed: arr[i].speed,
                influence: arr[i].influence
            });
        }
        return out;
    }

    function normalizeValue(val) {
        // AE returns arrays for multi-dimensional values (Position, Scale, etc.)
        // and plain numbers for 1D values (Opacity, Rotation).
        if (val instanceof Array) {
            var a = [];
            for (var i = 0; i < val.length; i++) a.push(val[i]);
            return a;
        }
        return val;
    }

    // ------------------------------------------------------------------
    // 5. Recursive property walker
    // ------------------------------------------------------------------

    function walkProperties(propGroup) {
        var results = [];
        for (var i = 1; i <= propGroup.numProperties; i++) {
            var p = propGroup.property(i);

            if (p.propertyType === PropertyType.PROPERTY) {
                if (p.numKeys > 0) {
                    var keyframes = [];
                    for (var k = 1; k <= p.numKeys; k++) {
                        keyframes.push(serializeKeyframe(p, k));
                    }
                    results.push({
                        name: p.name,
                        path: buildPath(p),
                        keyframes: keyframes
                    });
                }
            } else if (p.propertyType === PropertyType.INDEXED_GROUP ||
                       p.propertyType === PropertyType.NAMED_GROUP) {
                var children = walkProperties(p);
                for (var c = 0; c < children.length; c++) {
                    results.push(children[c]);
                }
            }
        }
        return results;
    }

    function buildPath(prop) {
        var parts = [];
        var current = prop;
        while (current != null && !(current instanceof Layer) && !(current instanceof CompItem)) {
            parts.push(current.name);
            current = current.parentProperty;
        }
        parts.reverse();
        return parts.join(" > ");
    }

    // ------------------------------------------------------------------
    // 6. Main extraction
    // ------------------------------------------------------------------

    var layersData = [];
    var totalProperties = 0;
    var totalKeyframes = 0;

    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        var props = walkProperties(layer);

        if (props.length === 0) continue;

        var keyCount = 0;
        for (var pi = 0; pi < props.length; pi++) {
            keyCount += props[pi].keyframes.length;
        }

        totalProperties += props.length;
        totalKeyframes += keyCount;

        layersData.push({
            index: layer.index,
            name: layer.name,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            parent: layer.parent ? layer.parent.index : null,
            properties: props
        });
    }

    // ------------------------------------------------------------------
    // 6b. Pre-compute segments, then strip raw keyframes from output
    // ------------------------------------------------------------------

    function absVal(v) { return v < 0 ? -v : v; }

    function roundTo(n, places) {
        var factor = 1;
        for (var i = 0; i < places; i++) factor *= 10;
        return Math.round(n * factor) / factor;
    }

    function stripTrailingZeros(numStr) {
        if (numStr.indexOf(".") === -1) return numStr;
        var s = numStr;
        while (s.charAt(s.length - 1) === "0") s = s.substring(0, s.length - 1);
        if (s.charAt(s.length - 1) === ".") s = s.substring(0, s.length - 1);
        return s;
    }

    function formatNum(v) {
        var frac = v - Math.floor(v);
        if (frac < 0) frac = -frac;
        if (frac < 0.01 || (1 - frac) < 0.01) return String(Math.round(v));
        return stripTrailingZeros(String(roundTo(v, 2)));
    }

    function formatTableValue(propName, val) {
        if (val instanceof Array) {
            var arr = [];
            var isScale = (propName === "Scale");
            var limit = val.length;
            if (isScale && val.length === 3 && val[2] === 100) limit = 2;
            for (var i = 0; i < limit; i++) arr.push(formatNum(val[i]));
            return arr.join(", ");
        }
        return formatNum(val);
    }

    function formatBarLabel(propName, fromVal, toVal) {
        var isScale = (propName === "Scale");
        var fromStr, toStr;
        if (isScale) {
            if (fromVal instanceof Array) {
                fromStr = formatNum(fromVal[0]);
                toStr = formatNum(toVal[0]);
                if (fromVal.length >= 2 && fromVal[0] !== fromVal[1]) {
                    fromStr = formatNum(fromVal[0]) + "%/" + formatNum(fromVal[1]) + "%";
                    toStr = formatNum(toVal[0]) + "%/" + formatNum(toVal[1]) + "%";
                    return fromStr + " -> " + toStr;
                }
            } else {
                fromStr = formatNum(fromVal);
                toStr = formatNum(toVal);
            }
            return fromStr + "% -> " + toStr + "%";
        }
        if (fromVal instanceof Array) {
            fromStr = formatNum(fromVal[0]);
            toStr = formatNum(toVal[0]);
        } else {
            fromStr = formatNum(fromVal);
            toStr = formatNum(toVal);
        }
        return fromStr + " -> " + toStr;
    }

    function valuesEqual(a, b) {
        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }
        return a === b;
    }

    function getDimValue(val, idx) {
        if (val instanceof Array) return val[idx];
        return val;
    }

    function computeCubicBezier(kfStart, kfEnd) {
        var fromVal = kfStart.value;
        var toVal = kfEnd.value;
        var dim0From = getDimValue(fromVal, 0);
        var dim0To = getDimValue(toVal, 0);
        var valueDelta = absVal(dim0To - dim0From);
        var duration = kfEnd.time - kfStart.time;
        var avgSpeed = (duration !== 0) ? valueDelta / duration : 0;

        var outEase = kfStart.easeOut.eases[0];
        var inEase = kfEnd.easeIn.eases[0];

        var outInf = outEase.influence / 100;
        var outSpeed = absVal(outEase.speed);
        var inInf = inEase.influence / 100;
        var inSpeed = absVal(inEase.speed);

        var x1 = outInf;
        var y1 = (avgSpeed !== 0) ? outInf * (outSpeed / avgSpeed) : 0;
        var x2 = 1 - inInf;
        var y2 = (avgSpeed !== 0) ? 1 - inInf * (inSpeed / avgSpeed) : 1;

        x1 = roundTo(x1, 2);
        y1 = roundTo(y1, 2);
        x2 = roundTo(x2, 2);
        y2 = roundTo(y2, 2);

        return "cubic-bezier(" +
            stripTrailingZeros(String(x1)) + ", " +
            stripTrailingZeros(String(y1)) + ", " +
            stripTrailingZeros(String(x2)) + ", " +
            stripTrailingZeros(String(y2)) + ")";
    }

    function computeSegments(prop) {
        var kfs = prop.keyframes;
        var segments = [];
        for (var i = 0; i < kfs.length - 1; i++) {
            var kfStart = kfs[i];
            var kfEnd = kfs[i + 1];

            if (valuesEqual(kfStart.value, kfEnd.value)) continue;

            var startMs = Math.round(kfStart.time * 1000);
            var endMs = Math.round(kfEnd.time * 1000);
            var easingType = kfStart.easeOut.type;
            var easing;
            if (easingType === "LINEAR") {
                easing = "linear";
            } else if (easingType === "HOLD") {
                easing = "hold";
            } else {
                easing = computeCubicBezier(kfStart, kfEnd);
            }

            segments.push({
                startMs: startMs,
                endMs: endMs,
                durationMs: endMs - startMs,
                fromValue: formatTableValue(prop.name, kfStart.value),
                toValue: formatTableValue(prop.name, kfEnd.value),
                barLabel: formatBarLabel(prop.name, kfStart.value, kfEnd.value),
                easing: easing,
                easingType: easingType
            });
        }
        return segments;
    }

    for (var si = 0; si < layersData.length; si++) {
        var layerEntry = layersData[si];
        var hasAnimated = false;
        for (var pi2 = 0; pi2 < layerEntry.properties.length; pi2++) {
            var segs = computeSegments(layerEntry.properties[pi2]);
            layerEntry.properties[pi2].segments = segs;
            delete layerEntry.properties[pi2].keyframes;
            if (segs.length > 0) hasAnimated = true;
        }
        layerEntry.hasAnimatedSegments = hasAnimated;
    }

    if (layersData.length === 0) {
        alert("uSpec Export Timeline\n\nNo animated properties found in \"" + comp.name + "\".\nMake sure your composition has keyframes.");
        return;
    }

    var output = {
        composition: {
            name: comp.name,
            duration: comp.duration,
            durationMs: Math.round(comp.duration * 1000),
            frameRate: comp.frameRate,
            width: comp.width,
            height: comp.height
        },
        layers: layersData
    };

    var jsonStr = JSON2.stringify(output, 2);

    // ------------------------------------------------------------------
    // 7. Copy to clipboard via temp file + pbcopy / clip
    // ------------------------------------------------------------------

    var isWindows = ($.os.indexOf("Windows") !== -1);
    var tmpPath;

    if (isWindows) {
        tmpPath = Folder.temp.fsName + "\\uspec_timeline.json";
    } else {
        tmpPath = Folder.temp.fsName + "/uspec_timeline.json";
    }

    var tmpFile = new File(tmpPath);
    tmpFile.encoding = "utf-8";
    tmpFile.open("w");
    tmpFile.write(jsonStr);
    tmpFile.close();

    try {
        if (isWindows) {
            system.callSystem('cmd.exe /c "type \"' + tmpPath + '\" | clip"');
        } else {
            system.callSystem('cat "' + tmpPath + '" | pbcopy');
        }
    } catch (e) {
        alert(
            "uSpec Export Timeline\n\n" +
            "Could not copy to clipboard.\n\n" +
            "Make sure \"Allow Scripts to Write Files and Access Network\"\n" +
            "is enabled in Preferences > Scripting & Expressions.\n\n" +
            "The JSON was saved to:\n" + tmpPath
        );
        return;
    }

    // Clean up
    tmpFile.remove();

    // ------------------------------------------------------------------
    // 8. Confirmation
    // ------------------------------------------------------------------

    alert(
        "uSpec Export Timeline\n\n" +
        "Copied to clipboard!\n\n" +
        "Composition: " + comp.name + "\n" +
        "Layers: " + layersData.length + "\n" +
        "Animated properties: " + totalProperties + "\n" +
        "Total keyframes: " + totalKeyframes
    );

})();
