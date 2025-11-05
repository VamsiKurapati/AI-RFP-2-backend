const pako = require('pako');

const normalizeBase64 = (input) => {
    // Replace URL-safe characters and pad to multiple of 4
    let normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const paddingNeeded = (4 - (normalized.length % 4)) % 4;
    return normalized + '='.repeat(paddingNeeded);
};

const decompress = (maybeCompressed) => {
    try {
        // If it's already an object, return as-is
        if (typeof maybeCompressed === 'object' && maybeCompressed !== null) {
            return maybeCompressed;
        }

        // If it's a string that is plain JSON, parse it directly
        if (typeof maybeCompressed === 'string') {
            try {
                const direct = JSON.parse(maybeCompressed);
                return direct;
            } catch (_) {
                // Not plain JSON, continue
            }
        }

        if (typeof maybeCompressed !== 'string') {
            throw new Error('Unsupported input type for decompression');
        }

        // Decode base64 using Buffer (Node)
        const b64 = normalizeBase64(maybeCompressed.trim());
        const compressedBuffer = Buffer.from(b64, 'base64');
        const compressed = new Uint8Array(compressedBuffer);

        // Detect gzip magic header
        const isGzip = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;

        let decompressedStr;
        try {
            decompressedStr = isGzip
                ? pako.ungzip(compressed, { to: 'string' })
                : pako.inflate(compressed, { to: 'string' });
        } catch (primaryError) {
            // Fallback to raw inflate
            try {
                decompressedStr = pako.inflateRaw(compressed, { to: 'string' });
            } catch (secondaryError) {
                throw primaryError;
            }
        }

        return JSON.parse(decompressedStr);
    } catch (error) {
        console.error('Decompression failed:', error);
        throw new Error('Failed to decompress data');
    }
};

module.exports = {
    decompress
};