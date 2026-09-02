import * as constants from "./constants";
import { Runtime } from "./runtime";
import { State } from "./state";

export const RETROM_WASM4_ADAPTER_ABI = "wasm4-state-v1";
export const RETROM_WASM4_CHECKPOINT_MAX_BYTES = 132144;

export type RetromWasm4Options = {
    cartBytes: Uint8Array;
    contentDigest: string;
    restorePayload: Uint8Array | null;
    target: HTMLElement;
};

export type RetromWasm4Instance = {
    canvas: HTMLCanvasElement;
    checkpoint(): Uint8Array;
    frameCount(): number;
    pause(): Promise<void>;
    resume(): Promise<void>;
    screenshot(): Promise<Blob>;
    stop(): Promise<void>;
};

const checkpointMagic = new Uint8Array([0x52, 0x54, 0x57, 0x34, 0x53, 0x31, 0x00, 0x00]);
const checkpointHeaderBytes = checkpointMagic.byteLength + 32;
const maximumGlobalsBytes = 64 * 1024;
const maximumRawStateBytes = (1 << 16) + 8 + maximumGlobalsBytes + constants.STORAGE_SIZE;
const frameDurationMs = 1000 / 60;

const keyboardButtons = new Map<string, number>([
    ["ArrowUp", constants.BUTTON_UP],
    ["ArrowDown", constants.BUTTON_DOWN],
    ["ArrowLeft", constants.BUTTON_LEFT],
    ["ArrowRight", constants.BUTTON_RIGHT],
    ["KeyX", constants.BUTTON_X],
    ["KeyV", constants.BUTTON_X],
    ["Space", constants.BUTTON_X],
    ["KeyZ", constants.BUTTON_Z],
    ["KeyC", constants.BUTTON_Z],
]);

export async function createRetromWasm4(options: RetromWasm4Options): Promise<RetromWasm4Instance> {
    validateOptions(options);
    const frameWindow = options.target.ownerDocument.defaultView;
    if (!frameWindow || frameWindow !== window) {throw new Error("WASM4_RUNTIME_UNAVAILABLE");}

    const runtime = new Runtime(`retrom-wasm4-${options.contentDigest}-disk`);
    const canvas = runtime.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "WASM-4 game");
    Object.assign(canvas.style, {
        display: "block",
        height: "100%",
        imageRendering: "pixelated",
        maxHeight: "100%",
        maxWidth: "100%",
        outline: "none",
        width: "100%",
    });
    options.target.replaceChildren(canvas);

    let stopped = false;
    let paused = false;
    let animationFrame = 0;
    let continuousFrames = 0;
    let nextFrameAt = frameWindow.performance.now();
    let keyboardMask = 0;

    const releaseKeyboard = () => {
        keyboardMask = 0;
        runtime.setGamepad(0, 0);
    };
    const onKey = (event: KeyboardEvent) => {
        const button = keyboardButtons.get(event.code);
        if (button === undefined) {return;}
        event.preventDefault();
        if (event.type === "keydown") {
            keyboardMask |= button;
            runtime.unlockAudio();
        } else {
            keyboardMask &= ~button;
        }
    };
    const focus = () => {
        canvas.focus({preventScroll: true});
        runtime.unlockAudio();
    };
    canvas.addEventListener("blur", releaseKeyboard);
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("keyup", onKey);
    canvas.addEventListener("pointerdown", focus, true);

    const onFrame = (now: number) => {
        if (stopped) {return;}
        animationFrame = frameWindow.requestAnimationFrame(onFrame);
        if (paused) {
            nextFrameAt = now;
            return;
        }
        applyGamepads(runtime, frameWindow.navigator, keyboardMask);
        if (now - nextFrameAt >= 200) {nextFrameAt = now;}
        let updates = 0;
        while (now >= nextFrameAt && updates < 12) {
            runtime.update();
            nextFrameAt += frameDurationMs;
            continuousFrames++;
            updates++;
        }
        if (updates > 0) {runtime.composite();}
    };

    try {
        await runtime.init();
        await runtime.load(options.cartBytes.slice());
        if (options.restorePayload) {
            decodeCheckpoint(options.restorePayload, options.contentDigest).write(runtime);
        } else {
            runtime.start();
        }
        runtime.composite();
        animationFrame = frameWindow.requestAnimationFrame(onFrame);
        focus();
    } catch (error) {
        canvas.removeEventListener("blur", releaseKeyboard);
        canvas.removeEventListener("keydown", onKey);
        canvas.removeEventListener("keyup", onKey);
        canvas.removeEventListener("pointerdown", focus, true);
        options.target.replaceChildren();
        await runtime.apu.audioCtx.close().catch(() => undefined);
        throw stableError(error);
    }

    return {
        canvas,
        checkpoint: () => {
            if (stopped) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
            const state = new State();
            state.read(runtime);
            return encodeCheckpoint(state, options.contentDigest);
        },
        frameCount: () => continuousFrames,
        pause: async () => {
            if (stopped || paused) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
            paused = true;
            runtime.pauseAudio();
        },
        resume: async () => {
            if (stopped || !paused) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
            paused = false;
            nextFrameAt = frameWindow.performance.now();
        },
        screenshot: () => screenshot(canvas),
        stop: async () => {
            if (stopped) {return;}
            stopped = true;
            paused = true;
            frameWindow.cancelAnimationFrame(animationFrame);
            releaseKeyboard();
            for (let player = 1; player < 4; player++) {runtime.setGamepad(player, 0);}
            canvas.removeEventListener("blur", releaseKeyboard);
            canvas.removeEventListener("keydown", onKey);
            canvas.removeEventListener("keyup", onKey);
            canvas.removeEventListener("pointerdown", focus, true);
            runtime.pauseAudio();
            runtime.compositor.gl.getExtension("WEBGL_lose_context")?.loseContext();
            await runtime.apu.audioCtx.close().catch(() => undefined);
            options.target.replaceChildren();
        },
    };
}

function validateOptions(options: RetromWasm4Options) {
    if (!options || !isUint8Array(options.cartBytes) || options.cartBytes.byteLength < 1 ||
        options.cartBytes.byteLength > 1 << 16 || !/^[0-9a-f]{64}$/u.test(options.contentDigest) ||
        !(options.target instanceof HTMLElement) || options.restorePayload !== null &&
        (!isUint8Array(options.restorePayload) || options.restorePayload.byteLength < checkpointHeaderBytes ||
        options.restorePayload.byteLength > RETROM_WASM4_CHECKPOINT_MAX_BYTES)) {
        throw new Error("WASM4_RUNTIME_CONFIG_INVALID");
    }
}

function isUint8Array(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function applyGamepads(runtime: Runtime, navigator: Navigator, keyboardMask: number) {
    const masks = [keyboardMask, 0, 0, 0];
    if (typeof navigator.getGamepads === "function") {
        for (const gamepad of navigator.getGamepads()) {
            if (!gamepad?.connected || gamepad.mapping !== "standard") {continue;}
            const player = gamepad.index % 4;
            masks[player] |= gamepadMask(gamepad);
        }
    }
    for (let player = 0; player < masks.length; player++) {runtime.setGamepad(player, masks[player]);}
}

function gamepadMask(gamepad: Gamepad) {
    const pressed = (index: number) => gamepad.buttons[index]?.pressed === true;
    const axis = (index: number) => gamepad.axes[index] ?? 0;
    let mask = 0;
    if (pressed(12) || axis(1) < -0.5) {mask |= constants.BUTTON_UP;}
    if (pressed(13) || axis(1) > 0.5) {mask |= constants.BUTTON_DOWN;}
    if (pressed(14) || axis(0) < -0.5) {mask |= constants.BUTTON_LEFT;}
    if (pressed(15) || axis(0) > 0.5) {mask |= constants.BUTTON_RIGHT;}
    if (pressed(0) || pressed(3) || pressed(5) || pressed(7)) {mask |= constants.BUTTON_X;}
    if (pressed(1) || pressed(2) || pressed(4) || pressed(6)) {mask |= constants.BUTTON_Z;}
    return mask;
}

function encodeCheckpoint(state: State, contentDigest: string) {
    const raw = state.toBytes();
    validateRawState(raw);
    const output = new Uint8Array(checkpointHeaderBytes + raw.byteLength);
    output.set(checkpointMagic);
    output.set(hexBytes(contentDigest), checkpointMagic.byteLength);
    output.set(raw, checkpointHeaderBytes);
    return output;
}

function decodeCheckpoint(payload: Uint8Array, contentDigest: string) {
    if (payload.byteLength < checkpointHeaderBytes || payload.byteLength > RETROM_WASM4_CHECKPOINT_MAX_BYTES ||
        !checkpointMagic.every((value, index) => payload[index] === value) ||
        !equalBytes(payload.subarray(checkpointMagic.byteLength, checkpointHeaderBytes), hexBytes(contentDigest))) {
        throw new Error("WASM4_CHECKPOINT_RESTORE_FAILED");
    }
    const raw = payload.subarray(checkpointHeaderBytes);
    try {
        validateRawState(raw);
        const state = new State();
        state.fromBytes(raw);
        return state;
    } catch {
        throw new Error("WASM4_CHECKPOINT_RESTORE_FAILED");
    }
}

function validateRawState(raw: Uint8Array) {
    if (raw.byteLength < (1 << 16) + 8 || raw.byteLength > maximumRawStateBytes) {
        throw new Error("WASM4_CHECKPOINT_INVALID");
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const globalsBytes = view.getUint32(1 << 16);
    const globalsStart = (1 << 16) + 4;
    const diskSizeOffset = globalsStart + globalsBytes;
    if (globalsBytes > maximumGlobalsBytes || diskSizeOffset + 4 > raw.byteLength) {
        throw new Error("WASM4_CHECKPOINT_INVALID");
    }
    const globals = JSON.parse(new TextDecoder().decode(raw.subarray(globalsStart, diskSizeOffset)));
    if (!plainStringRecord(globals)) {throw new Error("WASM4_CHECKPOINT_INVALID");}
    const diskSize = view.getUint32(diskSizeOffset);
    if (diskSize > constants.STORAGE_SIZE || diskSizeOffset + 4 + diskSize !== raw.byteLength) {
        throw new Error("WASM4_CHECKPOINT_INVALID");
    }
}

function plainStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.values(value).every((entry) => typeof entry === "string");
}

function hexBytes(value: string) {
    const output = new Uint8Array(value.length / 2);
    for (let index = 0; index < output.length; index++) {
        output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return output;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
    return left.byteLength === right.byteLength && left.every((value, index) => right[index] === value);
}

function screenshot(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("WASM4_SCREENSHOT_UNAVAILABLE")), "image/png");
    });
}

function stableError(error: unknown) {
    return error instanceof Error && /^WASM4_[A-Z0-9_]+$/u.test(error.message)
        ? error
        : new Error("WASM4_RUNTIME_FAILED");
}

Object.defineProperty(globalThis, "__RETROM_WASM4_CORE_MODULE_V1__", {
    configurable: true,
    enumerable: false,
    value: Object.freeze({
        RETROM_WASM4_ADAPTER_ABI,
        RETROM_WASM4_CHECKPOINT_MAX_BYTES,
        createRetromWasm4,
    }),
    writable: false,
});
