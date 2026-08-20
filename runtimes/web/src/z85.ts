// Encodes binary data into text, like base64 but more efficient.
//
// Originally based on http://rfc.zeromq.org/spec:32 but customised to support byte strings with
// lengths not divisible by 4.
//
// 85^5 = 4,437,053,125
// 2^32 = 4,294,967,296
// 85^5 - 2^32 = 142,085,829
// 2^24 + 2^16 + 2^8 = 16,843,008
// Therefore there are more than enough states in a 5 character base 85 block to additionaly represent 3, 2, and 1 byte long blocks.

const ENCODER = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#".split("");

const DECODER_OFFSET = 33;
const DECODER: Uint8Array = (() => {
    // The lowest ascii character we use is ! with ascii encoding 33.
    // The highest ascii character we use is } with ascii encoding 125.
    // So we need an array of length 125-33+1 = 93.
    let decoder_array = new Uint8Array(93);
    for (const [i, c] of ENCODER.entries()) {
        decoder_array[c.charCodeAt(0) - DECODER_OFFSET] = i;
    }
    return decoder_array;
})();

export function encode(src: number[] | Uint8Array | Uint8ClampedArray): string {
    const size = src.length;

	let str = "";
    let byte_index;
    let temp_array = new Array(5);
	for (byte_index = 0; byte_index + 4 <= size; byte_index += 4) {
        // Accumulate 4 bytes into a number
        let value = src[byte_index];
        for (let i = byte_index + 1; i < byte_index + 4; i++) {
            value = value*256 + src[i];
        }
        
        // Express the number in 5 digits of base 85
        for (let i = 4; i >= 0; i--) {
            temp_array[i] = value % 85;
            value = Math.trunc(value / 85);
        }

        for (let i = 0; i < 5; i++) {
            str += ENCODER[temp_array[i]];
        }
	}

    // Deal with the remaining (size % 4) bytes.
    const remaining_length = size - byte_index;
    let value = 0;
    for (; byte_index < size; byte_index += 1) {
        value = 256*value + src[byte_index];
    }

    if (remaining_length == 3) {
        value += 2 ** 32;
    } else if (remaining_length == 2) {
        value += (2 ** 32) + (2 ** 24);
    } else if (remaining_length == 1) {
        value += (2 ** 32) + (2 ** 24) + (2 ** 16);
    }

    if (remaining_length != 0) {
        // Express the number in 5 digits of base 85
        for (let i = 4; i >= 0; i--) {
            temp_array[i] = value % 85;
            value = Math.trunc(value / 85);
        }

        for (let i = 0; i < 5; i++) {
            str += ENCODER[temp_array[i]];
        }
    }

	return str;
}

export function decode(string: string, dest: number[] | Uint8Array | Uint8ClampedArray): number {
    let byte_count = 0;
    const string_len = string.length;
    const dest_len = dest.length;

    if ((string_len % 5) != 0) {
        return 0;
    }

    let temp_array = new Array(4);
    for (let char_index = 0; char_index < string_len; char_index += 5) {
        let value = 0;
        for (let i = char_index; i < char_index + 5; i++) {
            const decoder_index = string.charCodeAt(i) - DECODER_OFFSET;
            let base_85_digit = DECODER[decoder_index];
            if (base_85_digit === undefined) {
                return char_index;
            }
            value = (value * 85) + base_85_digit;
        }

        // Do special things if value >= 2**32
        let chunk_byte_length;
        if (value >= 2**32) {
            value -= 2**32;
            if (value >= 2**24) {
                value -= 2**24;
                if (value >= 2**16) {
                    value -= 2**16;
                    chunk_byte_length = 1;
                } else {
                    chunk_byte_length = 2;
                }
            } else {
                chunk_byte_length = 3;
            }
        } else {
            chunk_byte_length = 4;
        }

        for (let i = chunk_byte_length-1; i >= 0; i--) {
            temp_array[i] = value % 256;
            value = Math.trunc(value / 256);
        }
        
        for (let i = 0; i < chunk_byte_length; i++) {
            if (byte_count >= dest_len) {
                return byte_count;
            }
            dest[byte_count] = temp_array[i];
            byte_count++;
        }

        if (chunk_byte_length != 4) {
            return byte_count;
        }
    }

    return byte_count;
}

// Run with: node -e 'import { test } from "./z85.ts"; test()'
export function test() {
    test_round_trip_from_bytes([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B], "HelloWorld");

    test_round_trip_from_bytes([0xCF], "%P5tE");

    test_round_trip_from_bytes([0xFF], "%P5u3");


    test_round_trip_from_bytes([], "");
    test_round_trip_from_bytes([0x00], "%P5r3");
    test_round_trip_from_bytes([0x00, 0x11]);
    test_round_trip_from_bytes([0x00, 0x11, 0x22]);
    test_round_trip_from_bytes([0x00, 0x11, 0x22, 0x33]);
    
    test_round_trip_from_bytes([0x00, 0x00, 0x00, 0x00], "00000");
    test_round_trip_from_bytes([0xFF, 0xFF, 0xFF, 0xFF], "%nSc0");
}

declare const assert: any;
function test_round_trip_from_bytes(source_bytes: number[], expected_z85?: string) {
    let encoded = encode(source_bytes);
    if (expected_z85 !== undefined) {
        assert.equal(encoded, expected_z85);
    }

    let dest: number[] = new Array(1024);
    let byte_number = decode(encoded, dest);

    // Remove extra elements from dest array, and assert they're all zero
    assert(dest.splice(byte_number).every((el) => el === 0));

    assert.deepEqual(dest, source_bytes);
}