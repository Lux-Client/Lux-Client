export type SoundName = 'click' | 'notification' | 'error';

const SOUND_FILES: Record<SoundName, string> = {
    click: 'assets/sounds/click.wav',
    notification: 'assets/sounds/notification.wav',
    error: 'assets/sounds/error.wav'
};

let enabled = false;
let volume = 0.5;
const cache: Partial<Record<SoundName, HTMLAudioElement>> = {};

function getBaseAudio(name: SoundName): HTMLAudioElement {
    let audio = cache[name];
    if (!audio) {
        audio = new Audio(SOUND_FILES[name]);
        audio.preload = 'auto';
        cache[name] = audio;
    }
    return audio;
}

export function setSoundSettings(next: { enabled?: boolean; volume?: number }) {
    if (typeof next.enabled === 'boolean') enabled = next.enabled;
    if (typeof next.volume === 'number') volume = Math.min(1, Math.max(0, next.volume));
}

export function playSound(name: SoundName) {
    if (!enabled || volume <= 0) return;
    try {
        const instance = getBaseAudio(name).cloneNode(true) as HTMLAudioElement;
        instance.volume = volume;
        void instance.play().catch(() => {});
    } catch {
        // Ignore playback failures (e.g. unsupported codec, no audio device)
    }
}
